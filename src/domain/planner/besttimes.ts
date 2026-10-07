/**
 * Bestzeiten & Wettkampfprognose (Laufen).
 *
 * Quelle 1 (genau): Pace-Kurve von intervals.icu – schnellste Abschnitte über 1 km, 5 km, 10 km … aus allen Läufen,
 *   auch mitten in einem längeren Lauf. Wird beim Abgleich geholt und lokal gespeichert.
 * Quelle 2 (offline/Ersatz): ganze Aktivitäten, die etwas länger als die Distanz sind, gleichmäßig hochgerechnet.
 * Prognose: Riegel-Formel T2 = T1 · (D2/D1)^k mit k = 1,06 (Marathon bei wenig Umfang 1,08),
 *   ausgehend von den Bestleistungen der letzten 12 Monate (aktuelle Form statt alter Rekorde).
 */
import { db, getSetting, setSetting, type Activity } from '../../core/db';
import { addDays, today as todayFn } from '../../core/dates';
import { icu, type Credentials } from '../../sources/intervals/client';

export const BEST_DISTANCES = [
  { m: 1000, label: '1 km' }, { m: 5000, label: '5 km' }, { m: 10000, label: '10 km' },
  { m: 21097.5, label: 'Halbmarathon' }, { m: 42195, label: 'Marathon' }
] as const;

export interface Effort { secs: number; date?: string; activityId?: string; source: 'kurve' | 'aktivitaet' }
export interface CurveCache { at: number; all: Record<string, Effort>; year: Record<string, Effort> }
export interface BestRow { m: number; label: string; all: Effort | null; year: Effort | null; predicted: { secs: number; from: string } | null }

const RUN = /^(Run|VirtualRun|TrailRun)$/;
const ROAD = /^(Run|VirtualRun)$/;

/** Ersatz ohne Kurve: ganze Läufe zwischen D und 1,15·D, gleichmäßig auf D umgerechnet. */
export function effortsFromActivities(acts: Activity[], since?: string): Record<string, Effort> {
  const out: Record<string, Effort> = {};
  for (const d of BEST_DISTANCES) {
    let best: Effort | null = null;
    for (const a of acts) {
      if (!ROAD.test(a.sportType) || !a.distance || !a.duration || (since && a.date < since)) continue;
      if (a.distance < d.m * 0.995 || a.distance > d.m * 1.15) continue;
      const secs = a.duration * d.m / a.distance;
      if (secs / (d.m / 1000) < 150) continue;                      // < 2:30 min/km → Messfehler
      if (!best || secs < best.secs) best = { secs, date: a.date, activityId: a.sourceId, source: 'aktivitaet' };
    }
    if (best) out[String(d.m)] = best;
  }
  return out;
}

/** Wert der Pace-Kurve an Distanz d (Meter → Sekunden), linear interpoliert. */
function curveAt(dist: number[], secs: number[], ids: string[] | undefined, d: number): { secs: number; activityId?: string } | null {
  for (let i = 0; i < dist.length; i++) {
    if (Math.abs(dist[i] - d) < 1) return { secs: secs[i], activityId: ids?.[i] };
    if (dist[i] > d && i > 0) {
      const f = (d - dist[i - 1]) / (dist[i] - dist[i - 1]);
      return { secs: secs[i - 1] + f * (secs[i] - secs[i - 1]), activityId: ids?.[i] };
    }
  }
  return null;
}

type IcuCurve = { label?: string; id?: string; distance?: number[]; values?: number[]; secs?: number[]; activity_id?: string[] };
/** Kurve robust lesen: Distanzen in m, Zeiten in s (Plausibilität: 2:30–15:00 min/km). */
export function parseCurve(c: IcuCurve, actDates: Map<string, string>): Record<string, Effort> {
  const dist = c.distance ?? [];
  const times = (c.values?.length === dist.length ? c.values : c.secs?.length === dist.length ? c.secs : null) ?? [];
  const out: Record<string, Effort> = {};
  if (!dist.length || !times.length) return out;
  for (const d of BEST_DISTANCES) {
    const v = curveAt(dist, times, c.activity_id, d.m);
    if (!v) continue;
    const pace = v.secs / (d.m / 1000);
    if (pace < 150 || pace > 900) continue;
    out[String(d.m)] = { secs: v.secs, activityId: v.activityId, date: v.activityId ? actDates.get(v.activityId) : undefined, source: 'kurve' };
  }
  return out;
}

/** Pace-Kurven von intervals.icu holen (alle Zeit + letzte 12 Monate) und speichern. Höchstens 1× pro Tag. */
export async function refreshCurves(force = false): Promise<CurveCache | null> {
  const prev = await getSetting<CurveCache>('bestCurves');
  if (!force && prev && Date.now() - prev.at < 20 * 3600 * 1000) return prev;
  const c = await getSetting<Credentials>('intervals');
  if (!c) return prev ?? null;
  const res = await icu.paceCurves(c, ['all', '1y']);
  const acts = await db.activities.toArray();
  const dates = new Map(acts.map(a => [a.sourceId, a.date]));
  for (const [id, a] of Object.entries(res?.activities ?? {})) { const d = (a as { start_date_local?: string }).start_date_local; if (d && !dates.has(id)) dates.set(id, d.slice(0, 10)); }
  const list = res?.list ?? [];
  const find = (k: string) => list.find(x => x.id === k || x.label === k) ?? null;
  const all = find('all') ?? list[0]; const year = find('1y') ?? list[1];
  const cache: CurveCache = { at: Date.now(), all: all ? parseCurve(all, dates) : {}, year: year ? parseCurve(year, dates) : {} };
  await setSetting('bestCurves', cache);
  return cache;
}

const better = (a: Effort | undefined, b: Effort | undefined) => (!a ? b ?? null : !b ? a : a.secs <= b.secs ? a : b);

/** Laufkilometer pro Woche (Schnitt der letzten 8 Wochen). */
export function weeklyKm(acts: Activity[], t: string) {
  const from = addDays(t, -56);
  return acts.filter(a => RUN.test(a.sportType) && a.date >= from && a.date <= t).reduce((s, a) => s + (a.distance ?? 0) / 1000, 0) / 8;
}

/** Riegel-Prognose für Distanz d (m) aus den Bestleistungen. Referenz: nächstgelegene Distanz (≥ 3 km bevorzugt). */
export function predict(d: number, efforts: Record<string, Effort>, weekKm: number): { secs: number; from: string } | null {
  const refs = BEST_DISTANCES.filter(x => efforts[String(x.m)] && Math.abs(x.m - d) > 1).map(x => ({ ...x, e: efforts[String(x.m)] }));
  if (!refs.length) return null;
  // 1 km nur, wenn nichts Längeres da ist; sonst die Distanz mit dem kleinsten Abstand (logarithmisch)
  const pool = refs.some(r => r.m >= 3000) ? refs.filter(r => r.m >= 3000) : refs;
  pool.sort((a, b) => Math.abs(Math.log(a.m / d)) - Math.abs(Math.log(b.m / d)));
  const r = pool[0];
  const k = d >= 40000 && weekKm < 40 ? 1.08 : d >= 40000 && weekKm < 55 ? 1.07 : 1.06;
  return { secs: r.e.secs * Math.pow(d / r.m, k), from: r.label };
}

/** Tabelle: Bestzeit gesamt, letzte 12 Monate, Prognose. */
export function bestTable(acts: Activity[], cache: CurveCache | null, t = todayFn()): BestRow[] {
  const yearFrom = addDays(t, -365);
  const actAll = effortsFromActivities(acts), actYear = effortsFromActivities(acts, yearFrom);
  const all: Record<string, Effort> = {}, year: Record<string, Effort> = {};
  for (const d of BEST_DISTANCES) {
    const k = String(d.m);
    const a = better(cache?.all[k], actAll[k]); if (a) all[k] = a;
    // Kurve "1y" ist relativ zum Abrufzeitpunkt – Einträge mit Datum vor dem 12-Monats-Fenster verwerfen
    const cy = cache?.year[k] && (!cache.year[k].date || cache.year[k].date! >= yearFrom) ? cache.year[k] : undefined;
    const y = better(cy, actYear[k]); if (y) year[k] = y;
  }
  const wk = weeklyKm(acts, t);
  return BEST_DISTANCES.map(d => ({ m: d.m, label: d.label, all: all[String(d.m)] ?? null, year: year[String(d.m)] ?? null, predicted: d.m >= 5000 ? predict(d.m, year, wk) : null }));
}

/** Prognose für ein Laufziel (beliebige Distanz in km) – für den Wettkampf-Dialog. */
export async function predictFor(km: number): Promise<{ secs: number; from: string; weekKm: number } | null> {
  const [acts, cache] = await Promise.all([db.activities.toArray(), getSetting<CurveCache>('bestCurves')]);
  const rows = bestTable(acts, cache ?? null);
  const year: Record<string, Effort> = {};
  for (const r of rows) if (r.year) year[String(r.m)] = r.year;
  const wk = weeklyKm(acts, todayFn());
  const p = predict(km * 1000, year, wk);
  // Eigene Bestzeit über genau diese Distanz (letzte 12 Monate) zählt mit, wenn sie schneller ist
  const own = year[String(BEST_DISTANCES.find(d => Math.abs(d.m / 1000 - km) < 0.05)?.m)];
  if (own && (!p || own.secs < p.secs)) return { secs: own.secs, from: 'eigene Bestzeit', weekKm: wk };
  return p ? { ...p, weekKm: wk } : null;
}
