/**
 * Globaler UI-Zustand: Verbindung, Sync-Fortschritt, Speicherstatus.
 * Die eigentliche Logik liegt in sources/intervals/sync.ts.
 */
import { getSetting, setSetting, deleteSetting, requestPersistence, persistState, type PersistState } from '../core/db';
import { icu, IcuError, normalizeAthleteId, type Credentials } from '../sources/intervals/client';
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
  persist: 'denied' as PersistState
});

export async function initApp() {
  const cred = await getSetting<Credentials>('intervals');
  app.connected = !!cred;
  app.athleteName = (await getSetting<string>('athleteName')) ?? '';
  app.syncState = await getSyncState();
  app.persist = await persistState();
  app.ready = true;
  const stale = !app.syncState.lastSyncAt || Date.now() - app.syncState.lastSyncAt > AUTO_SYNC_AFTER_MS;
  if (app.connected && navigator.onLine && (stale || !app.syncState.historyDone)) void sync();
  // Beim Zurückkehren in die App ebenfalls abgleichen, wenn es länger her ist
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !app.connected || app.syncing) return;
    const last = app.syncState.lastSyncAt ?? 0;
    if (Date.now() - last > AUTO_SYNC_AFTER_MS) void sync();
  });
}

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
