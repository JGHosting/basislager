/**
 * Progression pro Übung.
 *
 * - Jede Übung hat eine Stufe 0–4. Pro Stufe steigt die Haltezeit um 25 % (max. doppelt) bzw.
 *   die Wiederholungen um 2.
 * - Nach STEP_AFTER bestätigten Durchgängen („passt“ oder kein Feedback) geht es eine Stufe hoch;
 *   „zu leicht“ hebt sofort an, „zu schwer“ senkt (auf Stufe 0: Übung wird seltener gewählt).
 * - Eine Übung „sitzt“ ab Stufe 1. Schwerere Varianten (Schwierigkeit 1/2) sind gesperrt, bis ein
 *   Vorgänger aus ihrer Varianten-Kette sitzt (bzw. ohne Kette: eine leichtere Übung derselben Region).
 *   Die Selbsttest-Stufe (settings.level) schaltet Schwierigkeit ≤ level pauschal frei.
 */
import { db, type MobilityProgress } from '../../core/db';
import { today } from '../../core/dates';
import { LIBRARY, byId, type MobilityExercise } from './library';

export const MAX_STEP = 4;
export const STEP_AFTER = 3;
export type Feedback = 'leicht' | 'passt' | 'schwer';
export type ProgressMap = Map<string, MobilityProgress>;

/** Varianten-Ketten, leicht → schwer. Eine Übung kann in mehreren Ketten stehen (ein sitzender Vorgänger reicht). */
export const CHAINS: string[][] = [
  // Hüfte
  ['hueftbeuger-stand', 'kneeling-hip-flexor-stretch', 'half-kneeling-hip-flexor-rock', 'low-lunge', 'lizard-stretch'],
  ['squat-hold', 'deep-squat-hold'],
  ['figur-vier-liegend', '90-90-hold', 'pigeon-stretch'],
  ['quad-dehnung-seitlage', 'quad-dehnung-vierfuss'],
  ['hueftkreisen-stand', 'hueftkreisen-vierfuss', 'worlds-greatest-stretch'],
  ['butterfly-stretch', 'adduktoren-seitlage', 'adduktoren-einrollen', 'seated-straddle-stretch'],
  ['faszienrolle-adduktoren', 'faszienrolle-oberschenkel-vorne', 'faszienrolle-oberschenkel-aussen', 'faszienrolle-gesaess'],
  ['hueftbeuger-stand', 'ausfallschritt-rotation'],
  // Rückseite
  ['standing-forward-fold', 'seated-forward-fold', 'head-to-knee-pose', 'wide-legged-forward-fold'],
  ['beinstrecken-9090', 'laeufer-dehnung', 'downward-dog', 'downward-dog-pedal'],
  ['standing-forward-fold', 'inchworm'],
  ['oberschenkel-umarmen', 'wide-legged-forward-fold'],
  // Sprunggelenk
  ['wadendehnung-sitzend', 'wadendehnung-wand', 'soleus-dehnung', 'deep-squat-hold'],
  ['standing-calf-stretch', 'soleus-dehnung'],
  ['faszienrolle-wade', 'faszienrolle-wade-aussen'],
  // BWS / Schultern
  ['cat-cow', 'thread-the-needle', 'puppy-pose'],
  ['doorway-chest-stretch', 'cow-face-pose'],
  ['rumpfdrehung-stand', 'drehsitz', 'worlds-greatest-stretch'],
  ['lat-dehnung-wand', 'seitdehnung-liegend'],
  ['faszienrolle-latissimus', 'faszienrolle-bws'],
  // Rumpf / Becken
  ['glute-bridge', 'beckenkippen-bruecke', 'single-leg-glute-bridge'],
  ['dead-bug', 'plank', 'side-plank'],
  ['cobra-stretch', 'superman', 'thoracic-bridge'],
  ['supine-spinal-twist', 'seated-spinal-twist', 'windmuehle'],
  ['knie-ueber-koerper', 'skorpion'],
  ['glute-bridge', 'clamshells'], ['becken-aufrichten', 'bird-dog'], ['squat-hold', 'wall-sit']
];

/** Vorgänger je Übung (aus allen Ketten). */
const PREREQ = new Map<string, Set<string>>();
for (const c of CHAINS) for (let i = 1; i < c.length; i++) {
  if (!PREREQ.has(c[i])) PREREQ.set(c[i], new Set());
  PREREQ.get(c[i])!.add(c[i - 1]);
}
export const prereqsOf = (id: string): string[] => [...(PREREQ.get(id) ?? [])].filter(p => !!byId(p));
/** Direkte Nachfolger (für „schaltet frei“-Anzeige). */
export const successorsOf = (id: string): string[] => [...PREREQ.entries()].filter(([, s]) => s.has(id)).map(([k]) => k).filter(k => !!byId(k));

export const stepOf = (p: ProgressMap, id: string) => p.get(id)?.step ?? 0;
export const isMastered = (p: ProgressMap, id: string) => stepOf(p, id) >= 1;

export function isUnlocked(e: MobilityExercise, p: ProgressMap, level: number): boolean {
  if (e.difficulty === 0 || e.difficulty <= level) return true;
  const pre = prereqsOf(e.id);
  if (pre.length) return pre.some(id => isMastered(p, id));
  // ohne Kette: eine leichtere Übung derselben Region sitzt
  return LIBRARY.some(o => o.difficulty < e.difficulty && o.regions.some(r => e.regions.includes(r)) && isMastered(p, o.id));
}

/** Haltezeit/Wiederholungen für die Stufe der Übung. */
export function holdFor(e: MobilityExercise, step: number): number | undefined {
  return e.holdSec == null ? undefined : Math.round((e.holdSec * (1 + 0.25 * Math.min(step, MAX_STEP))) / 5) * 5;
}
export function repsFor(e: MobilityExercise, step: number): number | undefined {
  return e.reps == null ? undefined : e.reps + 2 * Math.min(step, MAX_STEP);
}

export async function loadProgress(): Promise<ProgressMap> {
  return new Map((await db.mobilityProgress.toArray()).map(r => [r.exerciseId, r]));
}

/** Reine Funktion: neuer Fortschritt nach einem Durchgang. sameDay = heute schon gezählt (nur Feedback wirkt). */
export function applyFeedback(cur: MobilityProgress | undefined, id: string, fb: Feedback, date: string): MobilityProgress {
  const p: MobilityProgress = cur ? { ...cur } : { exerciseId: id, step: 0, count: 0, total: 0, updatedAt: 0 };
  const sameDay = p.lastDate === date;
  if (!sameDay) p.total++;
  if (fb === 'leicht') { p.step = Math.min(MAX_STEP, p.step + 1); p.count = 0; p.hard = false; }
  else if (fb === 'schwer') {
    if (p.step > 0) p.step--; else p.hard = true;
    p.count = 0;
  } else if (!sameDay) {
    p.hard = false;
    p.count++;
    if (p.count >= STEP_AFTER && p.step < MAX_STEP) { p.step++; p.count = 0; }
  }
  p.lastDate = date; p.lastFb = fb; p.updatedAt = Date.now();
  return p;
}

/**
 * Speichert einen Durchgang samt Feedback. Gibt die Übungen zurück, die dadurch neu freigeschaltet wurden.
 * Auf demselben Tag zählt eine Übung nur einmal; ein späteres Feedback ersetzt das frühere nicht rückwirkend,
 * „zu leicht/zu schwer“ wirkt aber auch beim zweiten Durchgang noch.
 */
export async function recordExercise(id: string, fb: Feedback, level: number): Promise<MobilityExercise[]> {
  const before = await loadProgress();
  const cur = before.get(id);
  if (cur?.lastDate === today() && cur.lastFb === fb && fb !== 'passt') return [];
  const next = applyFeedback(cur, id, fb, today());
  const after = new Map(before); after.set(id, next);
  const unlocked = LIBRARY.filter(e => !isUnlocked(e, before, level) && isUnlocked(e, after, level));
  await db.mobilityProgress.put(next);
  for (const e of unlocked) {
    const r = after.get(e.id) ?? { exerciseId: e.id, step: 0, count: 0, total: 0, updatedAt: 0 };
    await db.mobilityProgress.put({ ...r, unlockedAt: today(), updatedAt: Date.now() });
  }
  return unlocked;
}
