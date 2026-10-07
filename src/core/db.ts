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

export type MuscleGroup = 'push' | 'pull' | 'beine' | 'rumpf' | 'ganzkoerper';

/** Krafteinheit: nur Muskelgruppen + gefühlte Intensität, keine einzelnen Übungen. */
export interface StrengthSession {
  id: string;
  activityId?: string;        // verknüpfte Aktivität (fehlt bei manuell erfasster Einheit)
  date: string;
  muscleGroups: MuscleGroup[]; // leer = bewusst übersprungen
  intensity: number | null;    // 1–10
  skipped?: boolean;           // "nicht zuordnen" (z. B. kein echtes Krafttraining)
  createdAt: number;
  updatedAt: number;
}

/** Split-Vorlage: Liste von Trainingstagen, jeder Tag = Muskelgruppen. */
export interface SplitTemplate { id: string; name: string; days: MuscleGroup[][]; builtin?: boolean; createdAt: number; updatedAt: number }

export const BUILTIN_SPLITS: SplitTemplate[] = [
  { id: 'split-ppl', name: 'Push / Pull / Beine', days: [['push'], ['pull'], ['beine']], builtin: true, createdAt: 0, updatedAt: 0 },
  { id: 'split-ou', name: 'Ober- / Unterkörper', days: [['push', 'pull'], ['beine', 'rumpf']], builtin: true, createdAt: 0, updatedAt: 0 },
  { id: 'split-gk', name: 'Ganzkörper', days: [['ganzkoerper']], builtin: true, createdAt: 0, updatedAt: 0 }
];

/** Interne Sicherheitskopie vor einem Import (wird selbst nicht exportiert). */
export interface Snapshot { seq?: number; createdAt: number; reason: string; data: unknown }

export class BasislagerDB extends Dexie {
  settings!: Table<SettingRow, string>;
  activities!: Table<Activity, string>;
  morning!: Table<MorningEntry, string>;
  snapshots!: Table<Snapshot, number>;
  strength!: Table<StrengthSession, string>;
  splits!: Table<SplitTemplate, string>;
  /** name nur für die Backup-Prüfroutine abweichend (separate Test-Datenbank). */
  constructor(name = 'basislager') {
    super(name);
    this.version(1).stores({ settings: 'key' });
    this.version(2).stores({
      settings: 'key',
      activities: 'id, &sourceId, date, sportType',
      morning: 'date'
    });
    this.version(3).stores({ snapshots: '++seq, createdAt' });
    // v4: alte Garmin-Gewichte (vor 07.09.2026) entfernen; eigene Eingaben bleiben
    this.version(4).stores({}).upgrade(tx => tx.table('morning').toCollection().modify((m: MorningEntry) => {
      if (m.date < '2026-09-07' && m.weight != null && m.sources?.weight !== 'manual') { m.weight = null; delete m.sources.weight; }
    }));
    // v5: Kraft-Split
    this.version(5).stores({ strength: 'id, &activityId, date', splits: 'id' })
      .upgrade(tx => tx.table('splits').bulkPut(BUILTIN_SPLITS));
    this.on('populate', tx => { tx.table('splits').bulkPut(BUILTIN_SPLITS); });
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
