/**
 * Globaler UI-Zustand: Verbindung, Sync-Fortschritt, Speicherstatus.
 * Die eigentliche Logik liegt in sources/intervals/sync.ts.
 */
import { getSetting, setSetting, deleteSetting, requestPersistence, persistState, type PersistState } from '../core/db';
import { icu, IcuError, normalizeAthleteId, type Credentials } from '../sources/intervals/client';
import { today } from '../core/dates';
import { vacationToday } from '../domain/vacation/vacation';
import { db, type Meal, type FoodLogEntry, type MorningEntry } from '../core/db';
import { addDays } from '../core/dates';
import { weightSince } from '../domain/morning/morning';
import { runSync, getSyncState, resetHistory, type SyncState } from '../sources/intervals/sync';
import { pushPlan, type PushResult } from '../domain/planner/garmin';
import { refreshCurves } from '../domain/planner/besttimes';
import { resetRoutes } from '../domain/activity/route';
import { ensureBuiltinSplits, dedupeStrength } from '../domain/strength/repo';
import { liveQuery } from 'dexie';

const AUTO_SYNC_AFTER_MS = 10 * 60 * 1000;

export const app = $state({
  ready: false,
  connected: false,
  athleteName: '',
  syncing: false,
  syncLabel: '',
  syncCount: { activities: 0, days: 0 },
  syncError: '',
  syncState: { historyDone: false } as SyncState,
  persist: 'denied' as PersistState,
  lastBackupAt: 0,
  showMorning: false,
  strengthEdit: null as null | { activityId?: string; sessionId?: string; date?: string; fresh?: boolean },
  foodSheet: null as null | { mode: 'add'; date: string; meal: Meal } | { mode: 'edit'; entry: FoodLogEntry },
  injurySheet: null as null | { id?: string },
  goalSheet: null as null | { id?: string },
  activitySheet: null as null | { id: string },
  garmin: { busy: false, error: '', last: null as PushResult | null }
});

/* ---------- Plan → Garmin (über intervals.icu) ---------- */
let pushTimer: ReturnType<typeof setTimeout> | undefined;
/** Planänderungen gesammelt nach kurzer Pause an intervals.icu schicken. */
export function schedulePush(delay = 4000) {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { void pushNow(); }, delay);
}
export async function pushNow(): Promise<PushResult | null> {
  if (!app.connected || !navigator.onLine) return null;
  app.garmin.busy = true; app.garmin.error = '';
  try {
    const r = await pushPlan();
    if (r) app.garmin.last = r;
    return r;
  } catch (e) {
    app.garmin.error = e instanceof Error ? e.message : String(e);
    return null;
  } finally { app.garmin.busy = false; }
}
function watchPlanChanges() {
  let first = true;
  liveQuery(() => Promise.all([
    db.planEdits.toArray(), db.goals.toArray(), db.injuries.toArray(), db.vacations.toArray(), db.fixedEvents.toArray(),
    db.strength.count(), db.settings.where('key').anyOf('runsPerWeek', 'strengthPerWeek', 'activeSplit', 'garmin', 'hrMax').toArray()
  ])).subscribe(() => { if (first) { first = false; return; } schedulePush(); });
}

export async function initApp() {
  await weightSince();
  await ensureBuiltinSplits();
  await dedupeStrength();
  void resetRoutes();
  const cred = await getSetting<Credentials>('intervals');
  app.connected = !!cred;
  app.athleteName = (await getSetting<string>('athleteName')) ?? '';
  app.syncState = await getSyncState();
  app.persist = await persistState();
  app.lastBackupAt = (await getSetting<number>('lastBackupAt')) ?? 0;
  app.garmin.last = (await getSetting<PushResult>('garminLast')) ?? null;
  app.ready = true;
  watchPlanChanges();
  const stale = !app.syncState.lastSyncAt || Date.now() - app.syncState.lastSyncAt > AUTO_SYNC_AFTER_MS;
  if (app.connected && navigator.onLine && (stale || !app.syncState.historyDone)) void sync();
  void maybeShowMorning();
  // Beim Zurückkehren in die App ebenfalls abgleichen, wenn es länger her ist
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !app.connected) return;
    void maybeShowMorning();
    if (app.syncing) return;
    const last = app.syncState.lastSyncAt ?? 0;
    if (Date.now() - last > AUTO_SYNC_AFTER_MS) void sync();
  });
}

/* ---------- Morgenpopup ---------- */

/** Zeigt das Popup beim ersten Öffnen des Tages, solange es heute nicht mit "Fertig" geschlossen wurde. */
async function maybeShowMorning() {
  if (!app.connected || app.showMorning) return;
  const done = await getSetting<string>('morningDone');
  if (done === today()) return;
  if (await vacationToday()) return;          // Urlaub: kein automatisches Popup
  if (!(await nightDataReady())) return;      // erst wenn Garmin die Schlafwerte von heute geliefert hat
  if (app.showMorning || app.strengthEdit || app.foodSheet || app.injurySheet || app.goalSheet || app.activitySheet) return;
  app.showMorning = true;
}
/**
 * Schlafwerte von heute vorhanden? Erst dann ist "Guten Morgen" sinnvoll (nicht schon um Mitternacht).
 * Fallback für Nächte ohne Uhr: Gab es 7 Tage lang gar keine Schlafwerte, kommt das Popup ab 7 Uhr.
 */
async function nightDataReady(): Promise<boolean> {
  const t = today();
  const has = (m?: MorningEntry) => !!m && (m.sleepSecs != null || m.sleepScore != null || m.hrv != null);
  if (has(await db.morning.get(t))) return true;
  const recent = await db.morning.where('date').between(addDays(t, -7), t, true, false).toArray();
  return !recent.some(has) && new Date().getHours() >= 7;
}
/** done=true: für heute erledigt. done=false ("Später"): beim nächsten Öffnen wieder. */
export async function closeMorning(done: boolean) {
  app.showMorning = false;
  if (done) await setSetting('morningDone', today());
}
export function openMorning() { app.showMorning = true; }

/* ---------- Kraft-Zuordnung ---------- */
export function openStrength(target: { activityId?: string; sessionId?: string; date?: string; fresh?: boolean }) { app.strengthEdit = target; }
export function closeStrength() { app.strengthEdit = null; }

/* ---------- Ernährung ---------- */
export function openFood(t: NonNullable<typeof app.foodSheet>) { app.foodSheet = t; }
export function closeFood() { app.foodSheet = null; }

/* ---------- Verletzung ---------- */
export function openInjury(t: { id?: string } = {}) { app.injurySheet = t; }
export function closeInjury() { app.injurySheet = null; }

/* ---------- Planer ---------- */
export function openGoal(t: { id?: string } = {}) { app.goalSheet = t; }
export function closeGoal() { app.goalSheet = null; }

/* ---------- Aktivitäts-Details ---------- */
export function openActivity(id: string) { app.activitySheet = { id }; }
export function closeActivity() { app.activitySheet = null; }

export async function connect(athleteInput: string, apiKey: string): Promise<string | null> {
  const c: Credentials = { athleteId: normalizeAthleteId(athleteInput), apiKey: apiKey.trim() };
  try {
    const a = await icu.athlete(c);
    await setSetting('intervals', c);
    app.athleteName = a.firstname || a.name || a.id;
    await setSetting('athleteName', app.athleteName);
    app.connected = true;
    void sync(true);
    return null;
  } catch (e) {
    return e instanceof IcuError ? e.message : 'Unbekannter Fehler: ' + String(e);
  }
}

/** Trennt die Verbindung. Gespeicherte Aktivitäten und Morgenwerte bleiben erhalten. */
export async function disconnect() {
  await deleteSetting('intervals');
  app.connected = false;
}

export async function sync(userTriggered = false) {
  if (app.syncing) return;
  app.syncing = true; app.syncError = ''; app.syncLabel = 'Verbinde …';
  // Nach einem Tipp gewährt Safari dauerhaften Speicher eher → bei jedem Sync erneut fragen
  if (userTriggered || app.persist !== 'granted') app.persist = await requestPersistence();
  try {
    app.syncState = await runSync(p => {
      app.syncLabel = p.label;
      app.syncCount = { activities: p.activities, days: p.days };
    });
  } catch (e) {
    app.syncError = e instanceof Error ? e.message : String(e);
    app.syncState = await getSyncState();
  } finally {
    app.syncing = false;
    void maybeShowMorning();
    if (!app.syncError) { schedulePush(500); refreshCurves().catch(() => { /* Bestzeiten notfalls aus ganzen Aktivitäten */ }); }
  }
}

export async function reloadHistory() {
  await resetHistory();
  app.syncState = await getSyncState();
  await sync(true);
}

export async function askPersist() {
  app.persist = await requestPersistence();
}

/** Nach jedem Import/Backup aufrufen, damit Anzeige und Sync-Status stimmen. */
export async function refreshAfterImport() {
  await ensureBuiltinSplits();
  await dedupeStrength();
  void resetRoutes();
  app.syncState = await getSyncState();
  app.athleteName = (await getSetting<string>('athleteName')) ?? app.athleteName;
  app.lastBackupAt = (await getSetting<number>('lastBackupAt')) ?? 0;
}
