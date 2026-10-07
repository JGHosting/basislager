/**
 * Lokale Datenbank (IndexedDB über Dexie).
 * Jede Schema-Änderung bekommt eine neue version(n); Dexie migriert alte Stände automatisch.
 * REGEL: Jede neue Tabelle muss auch in Export/Import (backup/) aufgenommen werden.
 */
import Dexie, { type Table } from 'dexie';

export interface SettingRow { key: string; value: unknown }

/** Eine Trainingsaktivität. Quelle aktuell intervals.icu (Garmin). */
export interface Activity {
  id: string;                 // eigene UUID
  source: 'intervals';
  sourceId: string;           // ID bei intervals.icu – eindeutig
  sportType: string;          // z. B. Run, TrailRun, WeightTraining
  name?: string;
  start: string;              // lokale Startzeit "YYYY-MM-DDTHH:mm:ss"
  date: string;               // "YYYY-MM-DD" (für Abfragen)
  duration: number | null;    // Sekunden (Bewegungszeit)
  elapsed: number | null;     // Sekunden (Gesamtzeit)
  distance: number | null;    // Meter
  elevationGain: number | null;
  avgHr: number | null;
  maxHr: number | null;
  sourceLoad: number | null;  // Belastungswert von intervals.icu (nur zur Info)
  createdAt: number;
  updatedAt: number;
}

export type MorningField = 'hrv' | 'restingHr' | 'sleepScore' | 'sleepSecs' | 'weight';

/** Morgenwerte eines Tages. Werte aus intervals.icu oder manuell; manuell hat Vorrang. */
export interface MorningEntry {
  date: string;               // Schlüssel "YYYY-MM-DD"
  hrv: number | null;
  restingHr: number | null;
  sleepScore: number | null;
  sleepSecs: number | null;
  weight: number | null;
  feltRecovery: number | null; // 1–5, nur manuell
  pain: number | null;         // 0–10, nur manuell
  sources: Partial<Record<MorningField, 'intervals' | 'manual'>>;
  createdAt: number;
  updatedAt: number;
}

export class BasislagerDB extends Dexie {
  settings!: Table<SettingRow, string>;
  activities!: Table<Activity, string>;
  morning!: Table<MorningEntry, string>;
  constructor() {
    super('basislager');
    this.version(1).stores({ settings: 'key' });
    this.version(2).stores({
      settings: 'key',
      activities: 'id, &sourceId, date, sportType',
      morning: 'date'
    });
  }
}

export const db = new BasislagerDB();

export async function getSetting<T>(key: string): Promise<T | undefined> {
  return (await db.settings.get(key))?.value as T | undefined;
}
export async function setSetting(key: string, value: unknown) {
  await db.settings.put({ key, value });
}
export async function deleteSetting(key: string) {
  await db.settings.delete(key);
}

export type PersistState = 'granted' | 'denied' | 'unsupported';
/** Bittet den Browser, die Daten nicht automatisch zu löschen. Wirkt am besten nach einem Tipp. */
export async function requestPersistence(): Promise<PersistState> {
  if (!navigator.storage?.persist) return 'unsupported';
  if (await navigator.storage.persisted()) return 'granted';
  return (await navigator.storage.persist()) ? 'granted' : 'denied';
}
export async function persistState(): Promise<PersistState> {
  if (!navigator.storage?.persisted) return 'unsupported';
  return (await navigator.storage.persisted()) ? 'granted' : 'denied';
}
