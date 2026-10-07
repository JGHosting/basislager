/**
 * Abgleich mit intervals.icu.
 *
 * Erster Sync: Historie wird in Jahresblöcken rückwärts geladen (heute → Vergangenheit).
 *   Nach jedem Block wird der Fortschritt gespeichert. Bricht der Sync ab (App zu, offline),
 *   geht es beim nächsten Mal an derselben Stelle weiter. Nach zwei leeren Jahren in Folge ist Schluss.
 * Danach: nur noch die letzten Tage seit dem letzten Sync (mit 7 Tagen Überlappung,
 *   damit nachträglich geänderte Aktivitäten ebenfalls aktualisiert werden).
 *
 * Eigene, manuell eingetragene Morgenwerte werden nie überschrieben.
 */
import { db, getSetting, setSetting, type Activity, type MorningEntry, type MorningField } from '../../core/db';
import { addDays, today } from '../../core/dates';
import { newId } from '../../core/ids';
import { icu, type Credentials, type IcuActivity, type IcuWellness } from './client';

export interface SyncState {
  historyDone: boolean;
  historyCursor?: string;   // neuester Tag des nächsten noch zu ladenden Blocks
  emptyBlocks?: number;
  lastSyncAt?: number;      // Zeitstempel des letzten erfolgreichen Syncs
  lastSyncDate?: string;
  skippedStrava?: number;   // Aktivitäten ohne Daten (über Strava eingespielt)
}

export interface SyncProgress { phase: 'history' | 'recent'; label: string; activities: number; days: number }

const BLOCK_DAYS = 365;
const MAX_EMPTY_BLOCKS = 2;
const EARLIEST = '2005-01-01';

export async function getSyncState(): Promise<SyncState> {
  return (await getSetting<SyncState>('syncState')) ?? { historyDone: false };
}

/** Strava-Aktivitäten liefert intervals.icu nur als leere Hülle – die überspringen wir. */
function isEmptyStravaStub(a: IcuActivity) {
  return (a.source ?? '').toUpperCase() === 'STRAVA' && !a.moving_time && !a.elapsed_time;
}

async function storeActivities(list: IcuActivity[]): Promise<{ stored: number; skipped: number }> {
  let skipped = 0;
  const now = Date.now();
  const rows: Activity[] = [];
  const existing = await db.activities.where('sourceId').anyOf(list.map(a => String(a.id))).toArray();
  const byId = new Map(existing.map(e => [e.sourceId, e]));
  for (const a of list) {
    if (isEmptyStravaStub(a)) { skipped++; continue; }
    const prev = byId.get(String(a.id));
    rows.push({
      id: prev?.id ?? newId(),
      source: 'intervals',
      sourceId: String(a.id),
      sportType: a.type,
      name: a.name || undefined,
      start: a.start_date_local,
      date: a.start_date_local.slice(0, 10),
      duration: a.moving_time ?? null,
      elapsed: a.elapsed_time ?? null,
      distance: a.distance ?? null,
      elevationGain: a.total_elevation_gain ?? null,
      avgHr: a.average_heartrate ?? null,
      maxHr: a.max_heartrate ?? null,
      sourceLoad: a.icu_training_load ?? null,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now
    });
  }
  await db.activities.bulkPut(rows);
  return { stored: rows.length, skipped };
}

const FIELD_MAP: [MorningField, keyof IcuWellness][] = [
  ['hrv', 'hrv'], ['restingHr', 'restingHR'], ['sleepScore', 'sleepScore'], ['sleepSecs', 'sleepSecs'], ['weight', 'weight']
];

async function storeWellness(list: IcuWellness[]): Promise<number> {
  const now = Date.now();
  const withData = list.filter(w => FIELD_MAP.some(([, k]) => w[k] != null));
  if (!withData.length) return 0;
  const existing = await db.morning.bulkGet(withData.map(w => w.id));
  const rows: MorningEntry[] = withData.map((w, i) => {
    const prev = existing[i];
    const row: MorningEntry = prev ? { ...prev, sources: { ...prev.sources } } : {
      date: w.id, hrv: null, restingHr: null, sleepScore: null, sleepSecs: null, weight: null,
      feltRecovery: null, pain: null, sources: {}, createdAt: now, updatedAt: now
    };
    for (const [field, key] of FIELD_MAP) {
      if (row.sources[field] === 'manual') continue;        // eigene Eingabe hat Vorrang
      const v = w[key] as number | null | undefined;
      if (v == null) continue;
      row[field] = v;
      row.sources[field] = 'intervals';
    }
    row.updatedAt = now;
    return row;
  });
  await db.morning.bulkPut(rows);
  return rows.length;
}

/** Führt einen Sync aus. onProgress wird nach jedem Block aufgerufen. */
export async function runSync(onProgress: (p: SyncProgress) => void): Promise<SyncState> {
  const cred = await getSetting<Credentials>('intervals');
  if (!cred) throw new Error('Nicht mit intervals.icu verbunden.');
  const state = await getSyncState();
  const end = today();
  let acts = 0, days = 0;

  if (!state.historyDone) {
    let cursor = state.historyCursor ?? end;
    let empty = state.emptyBlocks ?? 0;
    while (empty < MAX_EMPTY_BLOCKS && cursor >= EARLIEST) {
      const oldest = addDays(cursor, -(BLOCK_DAYS - 1));
      onProgress({ phase: 'history', label: `Lade ${oldest.slice(0, 4)}–${cursor.slice(0, 4)}`, activities: acts, days });
      const [a, w] = await Promise.all([icu.activities(cred, oldest, cursor), icu.wellness(cred, oldest, cursor)]);
      const r = await storeActivities(a);
      const d = await storeWellness(w);
      acts += r.stored; days += d;
      state.skippedStrava = (state.skippedStrava ?? 0) + r.skipped;
      empty = a.length + d === 0 ? empty + 1 : 0;
      cursor = addDays(oldest, -1);
      state.historyCursor = cursor; state.emptyBlocks = empty;
      await setSetting('syncState', state);   // Fortschritt sichern → Fortsetzen nach Abbruch
    }
    state.historyDone = true;
  } else {
    const from = addDays(state.lastSyncDate ?? addDays(end, -30), -7);
    onProgress({ phase: 'recent', label: 'Gleiche neue Daten ab', activities: 0, days: 0 });
    const [a, w] = await Promise.all([icu.activities(cred, from, end), icu.wellness(cred, from, end)]);
    const r = await storeActivities(a);
    acts = r.stored; days = await storeWellness(w);
  }

  state.lastSyncAt = Date.now();
  state.lastSyncDate = end;
  await setSetting('syncState', state);
  onProgress({ phase: state.historyDone ? 'recent' : 'history', label: 'Fertig', activities: acts, days });
  return state;
}

/** Setzt den Sync zurück, damit die komplette Historie neu geladen wird (eigene Werte bleiben). */
export async function resetHistory() {
  const s = await getSyncState();
  await setSetting('syncState', { ...s, historyDone: false, historyCursor: undefined, emptyBlocks: 0, skippedStrava: 0 });
}
