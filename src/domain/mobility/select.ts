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

  // 2) Ziele, gewichtet (Ziel-Tag zählt stärker als nur passende Region)
  const goalPool: { item: MobilityExercise; weight: number }[] = [];
  for (const g of settings.goals) {
    for (const e of pool) {
      if (used.has(e.id)) continue;
      const factor = e.goals.includes(g.id) ? 1.5 : e.regions.includes(g.id as Region) ? 1 : 0;
      if (!factor) continue;
      let weight = g.weight * factor;
      for (const r of e.regions) weight *= regionWeightBoost(ctx.testScores, r);
      if (recentIds.includes(e.id)) weight *= 0.4;
      const existing = goalPool.find(p => p.item.id === e.id);
      if (existing) existing.weight = Math.max(existing.weight, weight); else goalPool.push({ item: e, weight });
    }
  }
  for (let i = 0; i < goalSlots && goalPool.length; i++) {
    const avail = goalPool.filter(p => !used.has(p.item.id));
    if (!avail.length) break;
    const picked = weightedPick(avail, rnd);
    if (picked) used.add(picked.id), chosen.push(picked);
  }
  // Nicht gefüllte Ziel-Slots aus der allgemeinen Rotation auffüllen
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
