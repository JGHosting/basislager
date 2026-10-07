/**
 * Geplante Einheiten über den intervals.icu-Kalender auf die Garmin-Uhr.
 * Basislager legt für die nächsten Tage strukturierte Workouts in intervals.icu an;
 * intervals.icu schickt sie (bei aktivierter Option) an Garmin Connect.
 * Änderungen am Plan werden nachgezogen, weggefallene Einheiten wieder gelöscht.
 */
import { getSetting, setSetting } from '../../core/db';
import { today, addDays, weekStart } from '../../core/dates';
import { icu, type Credentials, type IcuEventIn } from '../../sources/intervals/client';
import { planWeeks } from './repo';
import { workoutText, ICU_TYPE } from './workout';

export interface GarminCfg { enabled: boolean; kraft: boolean; days: number }
export interface SentInfo { id?: number | string; hash: string; date: string }
export interface PushResult { created: number; updated: number; removed: number; total: number; at: number }

export const PREFIX = 'basislager:';
const MARK = '(geplant mit Basislager)';
export const DEFAULT_CFG: GarminCfg = { enabled: false, kraft: false, days: 7 };
export const getCfg = async () => ({ ...DEFAULT_CFG, ...(await getSetting<GarminCfg>('garmin')) });
export const setCfg = (c: GarminCfg) => setSetting('garmin', { ...c });

/** Gewünschte Kalendereinträge für die nächsten Tage. keep = erledigte Einheiten, die drüben bleiben sollen. */
export async function desiredEvents(cfg: GarminCfg, t = today()) {
  const end = addDays(t, cfg.days - 1);
  const ws = weekStart(t);
  const { weeks } = await planWeeks(ws, Math.ceil((Date.parse(end) - Date.parse(ws)) / 604800000) + 1);
  const want = new Map<string, IcuEventIn>(); const keep = new Set<string>();
  for (const w of weeks) for (const s of w.sessions) {
    if (s.date < t || s.date > end) continue;
    const type = ICU_TYPE[s.sport];
    if (!type || s.minutes <= 0 || (s.sport === 'kraft' && !cfg.kraft)) continue;
    const ext = PREFIX + s.key;
    if (s.status === 'erledigt') { keep.add(ext); continue; }
    if (s.status !== 'offen') continue;
    want.set(ext, {
      category: 'WORKOUT', start_date_local: s.date + 'T00:00:00', type, name: s.title,
      description: workoutText(s, w.paces) + '\n\n' + MARK, moving_time: s.minutes * 60, external_id: ext
    });
  }
  return { want, keep, end };
}

const hash = (e: IcuEventIn) => { let h = 0; const s = JSON.stringify(e); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return String(h); };

let running: Promise<PushResult | null> | null = null;
/** Abgleich ausführen. Gibt null zurück, wenn nicht aktiviert oder nicht verbunden. */
export function pushPlan(): Promise<PushResult | null> {
  if (!running) running = doPush().finally(() => { running = null; });
  return running;
}

async function doPush(): Promise<PushResult | null> {
  const cfg = await getCfg();
  const cred = await getSetting<Credentials>('intervals');
  if (!cfg.enabled || !cred) return null;
  const t = today();
  const { want, keep, end } = await desiredEvents(cfg, t);
  const sent: Record<string, SentInfo> = { ...(await getSetting<Record<string, SentInfo>>('garminSent')) };

  // Stand drüben (auch falls lokal etwas verloren ging, z. B. nach Neuinstallation)
  const remote = await icu.events(cred, t, addDays(end, 14));
  const remoteBy = new Map(remote.filter(e => e.external_id?.startsWith(PREFIX)).map(e => [e.external_id!, e]));
  const remoteIds = new Set(remote.map(e => String(e.id)));

  const create: IcuEventIn[] = []; let updated = 0;
  for (const [ext, ev] of want) {
    const h = hash(ev); const prev = sent[ext];
    const id = remoteBy.get(ext)?.id ?? (prev?.id != null && remoteIds.has(String(prev.id)) ? prev.id : undefined);
    if (id != null && prev?.hash === h) { sent[ext] = { ...prev, id }; continue; }
    if (id != null) { await icu.updateEvent(cred, id, ev); sent[ext] = { id, hash: h, date: ev.start_date_local.slice(0, 10) }; updated++; }
    else create.push(ev);
  }
  if (create.length) {
    const res = (await icu.upsertEvents(cred, create)) ?? [];
    for (const ev of create) {
      const r = res.find(x => x.external_id === ev.external_id);
      sent[ev.external_id] = { id: r?.id, hash: hash(ev), date: ev.start_date_local.slice(0, 10) };
    }
  }

  // Weggefallene Einheiten (ab heute) entfernen – erledigte bleiben stehen
  const gone = new Map<string, number | string | undefined>();
  for (const [ext, info] of Object.entries(sent)) if (info.date >= t && !want.has(ext) && !keep.has(ext)) gone.set(ext, info.id);
  for (const [ext, e] of remoteBy) if (e.start_date_local.slice(0, 10) >= t && !want.has(ext) && !keep.has(ext)) gone.set(ext, e.id);
  // Verwaiste eigene Einträge (z. B. nach Neuinstallation ohne Backup), erkennbar am Vermerk in der Beschreibung
  const known = new Set(Object.values(sent).map(i => String(i.id)));
  for (const e of remote) if (e.description?.includes(MARK) && !e.external_id?.startsWith(PREFIX) && !known.has(String(e.id)) && e.start_date_local.slice(0, 10) >= t) gone.set('orphan:' + e.id, e.id);
  if (gone.size) {
    await icu.deleteEvents(cred, [...gone].map(([ext, id]) => (id != null ? { id } : { external_id: ext })));
    for (const ext of gone.keys()) delete sent[ext];
  }
  // Alte Einträge lokal aufräumen
  for (const [ext, info] of Object.entries(sent)) if (info.date < addDays(t, -14)) delete sent[ext];
  await setSetting('garminSent', sent);
  const result: PushResult = { created: create.length, updated, removed: gone.size, total: want.size, at: Date.now() };
  await setSetting('garminLast', result);
  return result;
}

/** Beim Ausschalten: alle zukünftigen Basislager-Workouts aus dem Kalender nehmen. */
export async function removeAll(): Promise<number> {
  const cred = await getSetting<Credentials>('intervals');
  if (!cred) return 0;
  const t = today();
  const sent = (await getSetting<Record<string, SentInfo>>('garminSent')) ?? {};
  const remote = await icu.events(cred, t, addDays(t, 60));
  const refs = new Map<string, { id: number | string } | { external_id: string }>();
  for (const e of remote) if (e.external_id?.startsWith(PREFIX) || e.description?.includes(MARK)) refs.set(e.external_id ?? 'id:' + e.id, { id: e.id });
  for (const [ext, info] of Object.entries(sent)) if (info.date >= t && !refs.has(ext)) refs.set(ext, info.id != null ? { id: info.id } : { external_id: ext });
  if (refs.size) await icu.deleteEvents(cred, [...refs.values()]);
  await setSetting('garminSent', {});
  return refs.size;
}
