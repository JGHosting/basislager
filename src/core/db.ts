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
  /** Zusatzdaten, beim ersten Öffnen der Detailansicht von intervals.icu geladen und gespeichert. */
  extra?: ActivityExtra;
  createdAt: number;
  updatedAt: number;
}

export interface ActivityExtra {
  calories?: number | null; avgSpeed?: number | null; maxSpeed?: number | null; cadence?: number | null;
  avgWatts?: number | null; npWatts?: number | null; elevLoss?: number | null; altMin?: number | null; altMax?: number | null;
  avgTemp?: number | null; hrZoneTimes?: number[] | null; hrZones?: number[] | null; intensity?: number | null;
  rpe?: number | null; feel?: number | null; device?: string | null; laps?: number | null; description?: string | null;
  fetchedAt: number;
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

/* ---------- Ernährung ---------- */
export type Meal = 'fruehstueck' | 'mittag' | 'abend' | 'snack';
export type FoodSource = 'bls' | 'off' | 'custom';
/** Nährwerte pro 100 g bzw. 100 ml. null = unbekannt (nie als 0 behandeln). */
export interface Nutrients {
  kcal: number | null; protein: number | null; carbs: number | null; fat: number | null;
  fiber: number | null; sugar: number | null; salt: number | null;
}
/** Lokaler Lebensmittel-Cache: genutzte BLS-/OFF-Produkte und eigene Lebensmittel. */
export interface Food extends Nutrients {
  id: string;                  // "bls:C133000", "off:4012345678901", "custom:<uuid>"
  source: FoodSource; sourceId: string;
  barcode?: string; name: string; brand?: string; category?: string;
  per: 'g' | 'ml';
  servingSize?: number | null; servingLabel?: string | null;   // Portion in g/ml
  pieceGrams?: number | null;  // Gewicht für "Stück"
  imageUrl?: string | null;
  /** Eigenes Gericht: Zutaten (Snapshot), Gesamtgewicht und Portionen; Nährwerte oben = pro 100 g. */
  recipe?: { ingredients: { foodId: string; name: string; grams: number; n: Nutrients }[]; totalGrams: number; portions: number };
  fav: 0 | 1; useCount: number; lastUsedAt?: number;
  lastUpdated: number; createdAt: number; updatedAt: number;
}
export type FoodUnit = 'g' | 'kg' | 'ml' | 'l' | 'stk' | 'portion';
/** Eintrag im Ernährungstagebuch. Snapshot der Nährwerte → vergangene Tage bleiben unverändert. */
export interface FoodLogEntry {
  id: string; date: string; meal: Meal;
  foodId: string;
  snapshot: Nutrients & { name: string; brand?: string; source: FoodSource; per: 'g' | 'ml' };
  amount: number; unit: FoodUnit; grams: number;   // grams = aufgelöste Menge in g bzw. ml
  createdAt: number; updatedAt: number;
}
/** Nur vorhanden, wenn ein Tag bewusst NICHT getrackt wird. */
export interface NutritionDay { date: string; tracked: boolean; updatedAt: number }

/* ---------- Verletzung ---------- */
export type Movement = 'gehen' | 'laufen' | 'bergab' | 'springen' | 'rad' | 'schwimmen' | 'beinkraft' | 'oberkoerper';
export type MoveStatus = 'geht' | 'eingeschraenkt' | 'nicht';
export interface Injury {
  id: string;
  region: string; side: 'links' | 'rechts' | 'beidseitig' | 'keine';
  severity: 'leicht' | 'mittel' | 'schwer';
  startDate: string; endDate?: string;          // endDate gesetzt = abgeschlossen
  medicalNote?: string;
  movement: Record<Movement, MoveStatus>;
  /** 'stufen' = Rückkehr in Stufen; 'ausfall' = ernste Verletzung (z. B. Bruch, Bänderriss): nur erlaubte Bewegungen, Ende per Knopf. */
  mode?: 'stufen' | 'ausfall';
  stage: number;                                 // Rückkehrstufe 0–7 (siehe domain/injury)
  stageHistory: { date: string; stage: number }[];
  createdAt: number; updatedAt: number;
}

/* ---------- Planer ---------- */
export type GoalSport = 'lauf' | 'trailrun' | 'rad' | 'schwimmen' | 'triathlon';
export type TriDistance = 'sprint' | 'olympisch' | '70.3' | 'lang';
/** Wettkampfziel. Zielzeiten in Sekunden; null = "egal". */
export interface Goal {
  id: string; name?: string;
  sport: GoalSport; date: string; planStart: string;
  distanceKm?: number | null; elevation?: number | null;
  triDistance?: TriDistance | null;
  targetTime?: number | null;
  targetTimes?: { swim: number | null; bike: number | null; run: number | null } | null;
  archived?: boolean;
  createdAt: number; updatedAt: number;
}
/** Eigene Änderung an einer geplanten Einheit (verschoben, erledigt, ausgelassen). */
export interface PlanEdit { key: string; movedTo?: string; status?: 'erledigt' | 'ausgelassen'; updatedAt: number }
/** Fixtermin: an diesen Tagen wird nichts geplant (Skiwochenende, Hochtour, Urlaub …). */
export interface FixedEvent { id: string; type: 'ski' | 'hochtour' | 'urlaub' | 'sonstiges'; title?: string; start: string; end: string; createdAt: number; updatedAt: number }

/** Urlaub: App-weit – kein Gewicht/Ernährung nötig, Kraft entfällt, Ausdauer voll/weniger/keine. */
export interface Vacation { id: string; title?: string; start: string; end: string; training: 'voll' | 'weniger' | 'keine'; createdAt: number; updatedAt: number }

/** Interne Sicherheitskopie vor einem Import (wird selbst nicht exportiert). */
export interface Snapshot { seq?: number; createdAt: number; reason: string; data: unknown }

export class BasislagerDB extends Dexie {
  settings!: Table<SettingRow, string>;
  activities!: Table<Activity, string>;
  morning!: Table<MorningEntry, string>;
  snapshots!: Table<Snapshot, number>;
  strength!: Table<StrengthSession, string>;
  splits!: Table<SplitTemplate, string>;
  foods!: Table<Food, string>;
  foodlog!: Table<FoodLogEntry, string>;
  nutritionDays!: Table<NutritionDay, string>;
  injuries!: Table<Injury, string>;
  goals!: Table<Goal, string>;
  planEdits!: Table<PlanEdit, string>;
  fixedEvents!: Table<FixedEvent, string>;
  vacations!: Table<Vacation, string>;
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
    // v6: Ernährung
    this.version(6).stores({ foods: 'id, barcode, name, fav, lastUsedAt', foodlog: 'id, date, foodId', nutritionDays: 'date' });
    // v7: Verletzungsmodus
    this.version(7).stores({ injuries: 'id, startDate' });
    // v8: Planer
    this.version(8).stores({ goals: 'id, date', planEdits: 'key', fixedEvents: 'id, start' });
    // v9: Urlaub als eigener Modus; bisherige Fixtermine vom Typ "Urlaub" werden übernommen
    this.version(9).stores({ vacations: 'id, start' }).upgrade(async tx => {
      const all = (await tx.table('fixedEvents').toArray()).filter((e: FixedEvent) => e.type === 'urlaub');
      for (const e of all) {
        await tx.table('vacations').put({ id: e.id, title: e.title, start: e.start, end: e.end, training: 'weniger', createdAt: e.createdAt, updatedAt: Date.now() });
        await tx.table('fixedEvents').delete(e.id);
      }
    });
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
