/**
 * Trainings-Paces fürs Laufen (min/km).
 * Mit Zielzeit: aus dem Wettkampftempo abgeleitet. Ohne: aus deinen Läufen der letzten 120 Tage geschätzt.
 */
import type { Activity, Goal } from '../../core/db';
import { addDays } from '../../core/dates';
import { TRI } from './goals';

export interface Paces { easy: number; long: number; threshold: number; interval: number; race?: number; source: 'ziel' | 'verlauf' | 'standard' }

export function estimatePaces(activities: Activity[], goal: Goal | null, today: string): Paces {
  // 1) Zielzeit vorhanden → Wettkampftempo als Anker
  let raceKm: number | null = null, raceTime: number | null = null;
  if (goal?.sport === 'lauf' && goal.targetTime && goal.distanceKm) { raceKm = goal.distanceKm; raceTime = goal.targetTime; }
  if (goal?.sport === 'triathlon' && goal.targetTimes?.run) { raceKm = TRI[goal.triDistance ?? 'olympisch'].run; raceTime = goal.targetTimes.run; }
  if (raceKm && raceTime) {
    const race = raceTime / 60 / raceKm;
    // Abstand Wettkampftempo ↔ Schwellentempo je Distanz (Faustwerte)
    const off = raceKm <= 6 ? 0.25 : raceKm <= 12 ? 0.08 : raceKm <= 25 ? -0.08 : -0.33;
    const threshold = race + off;
    // Triathlon: Laufen nach dem Radfahren ist langsamer → Training etwas schneller als Wettkampftempo-Anker
    const t = goal?.sport === 'triathlon' ? threshold - 0.15 : threshold;
    return { race, threshold: t, interval: t - 0.25, easy: t + 1.0, long: t + 1.15, source: 'ziel' };
  }
  // 2) Aus dem Verlauf: Median-Pace normaler Läufe ≈ lockeres Tempo
  const since = addDays(today, -120);
  const paces = activities.filter(a => a.sportType === 'Run' && a.date >= since && (a.distance ?? 0) > 3000 && (a.duration ?? 0) > 900)
    .map(a => a.duration! / 60 / (a.distance! / 1000)).filter(p => p > 3 && p < 9).sort((x, y) => x - y);
  if (paces.length >= 3) {
    const easy = paces[Math.floor(paces.length / 2)];
    const t = easy - 0.9;
    return { easy, long: easy + 0.15, threshold: t, interval: t - 0.25, source: 'verlauf' };
  }
  return { easy: 6.25, long: 6.4, threshold: 5.25, interval: 5.0, source: 'standard' };
}
