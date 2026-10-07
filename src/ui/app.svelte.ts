/**
 * Globaler UI-Zustand: Verbindung, Sync-Fortschritt, Speicherstatus.
 * Die eigentliche Logik liegt in sources/intervals/sync.ts.
 */
import { getSetting, setSetting, deleteSetting, requestPersistence, persistState, type PersistState } from '../core/db';
import { icu, IcuError, normalizeAthleteId, type Credentials } from '../sources/intervals/client';
import { today } from '../core/dates';
import type { Meal, FoodLogEntry } from '../core/db';
import { weightSince } from '../domain/morning/morning';
import { runSync, getSyncState, resetHistory, type SyncState } from '../sources/intervals/sync';

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
  strengthEdit: null as null | { activityId?: string; sessionId?: string; date?: string },
  foodSheet: null as null | { mode: 'add'; date: string; meal: Meal } | { mode: 'edit'; entry: FoodLogEntry },
  injurySheet: null as null | { id?: string }
});

export async function initApp() {
  await weightSince();
  const cred = await getSetting<Credentials>('intervals');
  app.connected = !!cred;
  app.athleteName = (await getSetting<string>('athleteName')) ?? '';
  app.syncState = await getSyncState();
  app.persist = await persistState();
  app.lastBackupAt = (await getSetting<number>('lastBackupAt')) ?? 0;
  app.ready = true;
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
  if (done !== today()) app.showMorning = true;
}
/** done=true: für heute erledigt. done=false ("Später"): beim nächsten Öffnen wieder. */
export async function closeMorning(done: boolean) {
  app.showMorning = false;
  if (done) await setSetting('morningDone', today());
}
export function openMorning() { app.showMorning = true; }

/* ---------- Kraft-Zuordnung ---------- */
export function openStrength(target: { activityId?: string; sessionId?: string; date?: string }) { app.strengthEdit = target; }
export function closeStrength() { app.strengthEdit = null; }

/* ---------- Ernährung ---------- */
export function openFood(t: NonNullable<typeof app.foodSheet>) { app.foodSheet = t; }
export function closeFood() { app.foodSheet = null; }

/* ---------- Verletzung ---------- */
export function openInjury(t: { id?: string } = {}) { app.injurySheet = t; }
export function closeInjury() { app.injurySheet = null; }

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
  app.syncState = await getSyncState();
  app.athleteName = (await getSetting<string>('athleteName')) ?? app.athleteName;
  app.lastBackupAt = (await getSetting<number>('lastBackupAt')) ?? 0;
}
