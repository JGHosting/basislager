/**
 * Trainingsbonus: Ausdauereinheiten geben zusätzliche Kalorien zum Tagesbudget.
 * Summe der aktiven Workout-Kalorien (Garmin, über intervals.icu) eines Tages → abflachende Kurve mit Obergrenze:
 *   raw = factor × kcal,  bonus = max × (1 − e^(−raw / max))
 * Der Garmin-Wert selbst wird nicht verändert, die Abschwächung läuft nur über factor und die Kurve.
 */
import { db, getSetting, setSetting, type Activity } from '../../core/db';

export interface BonusSettings { enabled: boolean; maxBonus: number; factor: number }
export const BONUS_DEFAULTS: BonusSettings = { enabled: true, maxBonus: 600, factor: 0.5 };

export async function getBonusSettings(): Promise<BonusSettings> {
  return { ...BONUS_DEFAULTS, ...((await getSetting<Partial<BonusSettings>>('trainingBonus')) ?? {}) };
}
export const setBonusSettings = (s: BonusSettings) => setSetting('trainingBonus', { ...s });

/** Nur Ausdauer zählt (Laufen, Rad, Schwimmen, Rudern, Langlauf …) – nicht Kraft, Yoga, Gehen, Ski alpin usw. */
const ENDURANCE = /Run|Ride|Swim|Rowing|NordicSki|BackcountrySki|RollerSki|Elliptical|Kayaking|Canoeing|StandUpPaddling|InlineSkate|Handcycle|Velomobile/;
export const isEndurance = (sportType: string) => ENDURANCE.test(sportType);

/** Aktive Kalorien einer Einheit (aus der Liste, sonst aus geladenen Details). null = unbekannt. */
export const activeKcal = (a: Activity): number | null => a.calories ?? a.extra?.calories ?? null;

export function bonusFor(kcal: number, s: Pick<BonusSettings, 'maxBonus' | 'factor'>): number {
  if (!(kcal > 0) || !(s.maxBonus > 0) || !(s.factor > 0)) return 0;
  const raw = s.factor * kcal;
  return Math.max(0, Math.round(s.maxBonus * (1 - Math.exp(-raw / s.maxBonus))));
}

export interface DayBudget { base: number; bonus: number; total: number; workoutKcal: number; workouts: number }

/** Tagesbudget = eigenes Basisziel + Trainingsbonus. null, wenn kein Basisziel gesetzt ist. */
export async function dayBudget(date: string, base: number | null): Promise<DayBudget | null> {
  if (base == null) return null;
  const s = await getBonusSettings();
  if (!s.enabled) return { base, bonus: 0, total: base, workoutKcal: 0, workouts: 0 };
  const acts = (await db.activities.where('date').equals(date).toArray()).filter(a => isEndurance(a.sportType));
  let kcal = 0, n = 0;
  for (const a of acts) { const k = activeKcal(a); if (k != null && k > 0) { kcal += k; n++; } }
  const bonus = bonusFor(kcal, s);
  return { base, bonus, total: base + bonus, workoutKcal: Math.round(kcal), workouts: n };
}
