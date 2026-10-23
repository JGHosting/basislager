/**
 * Baut die tägliche Routine: eine Hälfte rotiert durch alle Körperregionen (Ziel "beweglicher im
 * ganzen Körper"), die andere Hälfte kommt gewichtet aus den gewählten Zielen. Abwechslung über die
 * letzten Tage, Fortschritt über die Haltezeit/Wiederholungen, Verletzungsfilter zum Schluss.
 */
import { LIBRARY, REGIONS, scaledHold, scaledReps, type MobilityExercise, type Region } from './library';
import type { MobilitySettings } from './settings';
import type { Injury } from '../../core/db';
import { regionScore, regionWeightBoost } from './tests';
import { db } from '../../core/db';
import { addDays, today } from '../../core/dates';
import { isExcluded } from './injury';

export interface RoutineItem {
  exerciseId: string;
  holdSec?: number; reps?: number; sides: boolean;
}
export interface Routine { date: string; minutes: number; items: RoutineItem[] }

const STOP = new Set(['mehr', 'besser', 'beweglicher', 'beweglichkeit', 'werden', 'wieder', 'ohne', 'mein', 'meine', 'können', 'schaffen']);
const keywords = (label: string) => label.toLowerCase().split(/[^a-zäöüß]+/).filter(w => w.length >= 4 && !STOP.has(w)).map(w => w.slice(0, Math.max(4, w.length - 2)));
const haystack = (e: MobilityExercise) => (e.name + ' ' + e.instructions + ' ' + (e.cue ?? '') + ' ' + e.regions.map(r => REGIONS.find(x => x.id === r)?.label ?? '').join(' ')).toLowerCase();

const SLOTS: Record<MobilitySettings['minutes'], number> = { 5: 4, 10: 8, 15: 12 };

/**
 * Ersatz für eine Übung, die (wegen Verletzung oder per "Tauschen") nicht gemacht werden soll:
 * bevorzugt gleiche Region, gleiche Art; nie eine bereits enthaltene oder verletzungsbedingt ausgeschlossene.
 */
export function pickReplacement(oldId: string, injury: Injury | null, usedIds: string[], level: MobilitySettings['level'], rnd: () => number = Math.random): RoutineItem | null {
  const old = LIBRARY.find(e => e.id === oldId);
  const pool = LIBRARY.filter(e => e.id !== oldId && !usedIds.includes(e.id) && !isExcluded(e, injury));
  if (!pool.length) return null;
  const weighted = pool.map(e => {
    const sameRegion = !!old && e.regions.some(r => old.regions.includes(r));
    const sameCat = !!old && e.category === old.category;
    return { item: e, weight: (sameRegion ? 6 : 1) * (sameCat ? 2 : 1) };
  });
  const e = weightedPick(weighted, rnd);
  return e ? { exerciseId: e.id, sides: e.sides, holdSec: scaledHold(e, level), reps: scaledReps(e, level) } : null;
}

function weightedPick<T>(pool: { item: T; weight: number }[], rnd: () => number): T | null {
  const total = pool.reduce((s, p) => s + p.weight, 0);
  if (total <= 0) return null;
  let r = rnd() * total;
  for (const p of pool) { r -= p.weight; if (r <= 0) return p.item; }
  return pool[pool.length - 1]?.item ?? null;
}

export interface SelectContext {
  settings: MobilitySettings;
  injury: Injury | null;
  recentIds: string[];          // Übungen der letzten ~2 Tage (Abwechslung)
  testScores: Partial<Record<Region, number>>;
}

/** Holt Einstellungen, Verletzung und Verlauf aus der DB und baut die Routine für heute. */
export async function buildTodayRoutine(settings: MobilitySettings, injury: Injury | null): Promise<Routine> {
  const since = addDays(today(), -2);
  const recent = await db.mobilityLog.where('date').between(since, today(), true, false).toArray();
  const recentIds = recent.flatMap(l => l.items.filter(i => i.done).map(i => i.exerciseId));
  const last = await db.mobilityTests.orderBy('date').last();
  const testScores = last ? regionScore(last.results) : {};
  return buildRoutine({ settings, injury, recentIds, testScores });
}

export function buildRoutine(ctx: SelectContext, rnd: () => number = Math.random): Routine {
  const { settings, injury, recentIds } = ctx;
  const slots = SLOTS[settings.minutes];
  const rotationSlots = Math.ceil(slots / 2);
  const goalSlots = slots - rotationSlots;
  const pool = LIBRARY.filter(e => !isExcluded(e, injury));
  const chosen: MobilityExercise[] = [];
  const used = new Set<string>();

  // 1) Rotation: eine Übung je Region, fortlaufend ab rotationIdx (deckt über mehrere Tage alle Regionen ab)
  const order = REGIONS.map((r, i) => REGIONS[(i + settings.rotationIdx) % REGIONS.length].id);
  for (const region of order) {
    if (chosen.length >= rotationSlots) break;
    const candidates = pool.filter(e => e.regions.includes(region) && !used.has(e.id));
    if (!candidates.length) continue;
    const fresh = candidates.filter(e => !recentIds.includes(e.id));
    const picked = weightedPick((fresh.length ? fresh : candidates).map(e => ({ item: e, weight: 1 })), rnd);
    if (picked) { chosen.push(picked); used.add(picked.id); }
  }

  // 2) Ziele, gewichtet. Eigene Ziele: Stichwörter im Zieltext gegen Name, Anleitung und Region der Übungen
  const goalPool: { item: MobilityExercise; weight: number }[] = [];
  let unmatchedCustom = 0;
  for (const g of settings.goals) {
    const custom = settings.customGoals.find(c => c.id === g.id);
    const words = custom ? keywords(custom.label) : [];
    let matched = 0;
    for (const e of pool) {
      if (used.has(e.id)) continue;
      let factor = 0;
      if (custom) factor = words.some(w => haystack(e).includes(w)) ? 1.5 : 0;
      else factor = e.goals.includes(g.id as any) ? 1.5 : e.regions.includes(g.id as Region) ? 1 : 0;
      if (!factor) continue;
      matched++;
      let weight = g.weight * factor;
      for (const r of e.regions) weight *= regionWeightBoost(ctx.testScores, r);
      if (recentIds.includes(e.id)) weight *= 0.4;
      const existing = goalPool.find(p => p.item.id === e.id);
      if (existing) existing.weight = Math.max(existing.weight, weight); else goalPool.push({ item: e, weight });
    }
    if (custom && !matched) unmatchedCustom++;
  }
  // Eigene Ziele ohne passende Übung: Platz geht an die allgemeine Rotation (ganzer Körper)
  const customExtra = unmatchedCustom ? Math.round(goalSlots * 0.3) : 0;
  let goalCount = Math.max(0, goalSlots - customExtra);
  for (let i = 0; i < goalCount && goalPool.length; i++) {
    const avail = goalPool.filter(p => !used.has(p.item.id));
    if (!avail.length) break;
    const picked = weightedPick(avail, rnd);
    if (picked) used.add(picked.id), chosen.push(picked);
  }
  // Rest (durch eigene Ziele "verdiente" Slots sowie nicht gefüllte Ziel-Slots) aus der allgemeinen Rotation auffüllen
  while (chosen.length < slots) {
    const avail = pool.filter(e => !used.has(e.id));
    if (!avail.length) break;
    const fresh = avail.filter(e => !recentIds.includes(e.id));
    const picked = weightedPick((fresh.length ? fresh : avail).map(e => ({ item: e, weight: 1 })), rnd);
    if (!picked) break;
    used.add(picked.id); chosen.push(picked);
  }

  const items: RoutineItem[] = chosen.map(e => ({
    exerciseId: e.id, sides: e.sides,
    holdSec: scaledHold(e, settings.level), reps: scaledReps(e, settings.level)
  }));
  return { date: today(), minutes: settings.minutes, items };
}
