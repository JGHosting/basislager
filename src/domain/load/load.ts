/**
 * Gemeinsame Belastung aller Sportarten (auch Spaßsport).
 *
 * 1) Pro Aktivität ein TRIMP-Wert (Banister):
 *      TRIMP = Dauer[min] × HRr × 0,64 × e^(1,92 × HRr)
 *      HRr   = (Ø-Puls − Ruhepuls) / (Maximalpuls − Ruhepuls)
 *    Ohne Puls → Ersatz: Dauer[min] × Sportfaktor (+ Höhenmeter bei Berg-/Trailsport).
 * 2) Tageslast = Summe aller TRIMPs des Tages.
 * 3) Ermüdung (akut, ATL)  = exponentieller Schnitt über 7 Tage.
 *    Fitness  (chronisch, CTL) = exponentieller Schnitt über 42 Tage.
 *    Form (TSB) = Fitness − Ermüdung.   Verhältnis (ACWR) = Ermüdung / Fitness.
 * Reine Funktionen ohne Datenbankzugriff → später 1:1 in eine native App übertragbar.
 */
import type { Activity } from '../../core/db';
import { addDays } from '../../core/dates';

export interface HrProfile { max: number; rest: number; maxSource: 'auto' | 'manual' | 'default'; restSource: 'auto' | 'manual' | 'default' }
export interface ActivityLoad { load: number; method: 'trimp' | 'estimated'; minutes: number }

/** Belastung pro Minute ohne Puls, grob kalibriert auf TRIMP bei mittlerer Intensität. */
export const SPORT_FACTOR: Record<string, number> = {
  Run: 1.3, VirtualRun: 1.3, TrailRun: 1.5, Ride: 1.0, VirtualRide: 1.1, GravelRide: 1.0, MountainBikeRide: 1.2, EBikeRide: 0.5,
  Swim: 1.1, OpenWaterSwim: 1.2, WeightTraining: 0.9, Workout: 1.0, Hike: 0.8, Walk: 0.4,
  AlpineSki: 0.7, BackcountrySki: 1.3, NordicSki: 1.3, Snowboard: 0.6, RockClimbing: 0.8, Yoga: 0.3, Rowing: 1.2, Elliptical: 1.0
};
const DEFAULT_FACTOR = 0.8;
/** Sportarten, bei denen Höhenmeter die Ersatzbelastung erhöhen (pro 100 hm). */
const ELEVATION_SPORTS = new Set(['Hike', 'TrailRun', 'BackcountrySki', 'MountainBikeRide', 'RockClimbing']);
const LOAD_PER_100HM = 1.5;

/** Selbst erarbeitete Höhenmeter. Bei Ski alpin und Snowboard kommen sie vom Lift → zählen nicht. */
const LIFT_SPORTS = /^(AlpineSki|Snowboard)$/;
export const ownElevation = (a: Activity): number | null => (LIFT_SPORTS.test(a.sportType) ? null : a.elevationGain);

/** intensity (1–10, aus dem Kraft-Split) skaliert die Schätzung ohne Puls: 5 = Standard. */
export function activityLoad(a: Activity, hr: HrProfile, intensity?: number | null): ActivityLoad {
  const minutes = (a.duration ?? a.elapsed ?? 0) / 60;
  if (minutes <= 0) return { load: 0, method: 'estimated', minutes: 0 };
  if (a.avgHr && a.avgHr > hr.rest && hr.max > hr.rest) {
    const hrr = Math.min(1, (a.avgHr - hr.rest) / (hr.max - hr.rest));
    return { load: minutes * hrr * 0.64 * Math.exp(1.92 * hrr), method: 'trimp', minutes };
  }
  let load = minutes * (SPORT_FACTOR[a.sportType] ?? DEFAULT_FACTOR);
  if (intensity != null) load *= 0.5 + intensity / 10;
  if (ELEVATION_SPORTS.has(a.sportType) && a.elevationGain) load += (a.elevationGain / 100) * LOAD_PER_100HM;
  return { load, method: 'estimated', minutes };
}

/**
 * Pulsprofil: manuelle Werte haben Vorrang.
 * Auto-Maximalpuls = zweithöchster Maximalpuls der letzten 2 Jahre (ein einzelner Messfehler zählt nicht).
 * Auto-Ruhepuls = Median der letzten 30 Ruhepulswerte.
 */
export function hrProfile(activities: Activity[], restingValues: number[], manual: { max?: number | null; rest?: number | null }, today: string): HrProfile {
  const since = addDays(today, -730);
  const maxes = activities.filter(a => a.date >= since && a.maxHr && a.maxHr < 230).map(a => a.maxHr!).sort((x, y) => y - x);
  const autoMax = maxes.length >= 2 ? maxes[1] : maxes[0];
  const rs = restingValues.slice(-30).sort((x, y) => x - y);
  const autoRest = rs.length ? rs[Math.floor(rs.length / 2)] : undefined;
  return {
    max: manual.max ?? autoMax ?? 190,
    maxSource: manual.max ? 'manual' : autoMax ? 'auto' : 'default',
    rest: manual.rest ?? autoRest ?? 60,
    restSource: manual.rest ? 'manual' : autoRest ? 'auto' : 'default'
  };
}

export interface LoadDay { date: string; load: number; atl: number; ctl: number; tsb: number }

/** Tagesreihe von der ersten Aktivität bis 'to'. ATL/CTL als exponentiell gewichtete Mittel. */
export function loadSeries(activities: Activity[], hr: HrProfile, to: string, intensities: Map<string, number | null> = new Map()): LoadDay[] {
  if (!activities.length) return [];
  const perDay = new Map<string, number>();
  for (const a of activities) perDay.set(a.date, (perDay.get(a.date) ?? 0) + activityLoad(a, hr, intensities.get(a.id)).load);
  const first = activities.reduce((m, a) => (a.date < m ? a.date : m), activities[0].date);
  const kA = 1 - Math.exp(-1 / 7), kC = 1 - Math.exp(-1 / 42);
  const out: LoadDay[] = [];
  let atl = 0, ctl = 0;
  for (let d = first; d <= to; d = addDays(d, 1)) {
    const l = perDay.get(d) ?? 0;
    const tsb = ctl - atl;                 // Form = Stand VOR dem heutigen Training
    atl += (l - atl) * kA;
    ctl += (l - ctl) * kC;
    out.push({ date: d, load: l, atl, ctl, tsb });
  }
  return out;
}

export type LoadState = 'frisch' | 'ausgeglichen' | 'produktiv' | 'hoch' | 'aufbau';
/** Einordnung in Worten (Schwellen bewusst einfach gehalten). */
export function describeLoad(day: LoadDay, daysOfHistory: number): { state: LoadState; text: string; acwr: number | null } {
  const acwr = day.ctl > 5 ? day.atl / day.ctl : null;
  if (daysOfHistory < 42) return { state: 'aufbau', text: 'Fitnesswert baut sich noch auf (braucht ca. 6 Wochen Daten).', acwr };
  if (acwr != null && acwr > 1.5) return { state: 'hoch', text: 'Deutlich mehr Belastung als gewohnt. Erhöhtes Überlastungsrisiko.', acwr };
  if (day.tsb < -25) return { state: 'hoch', text: 'Hohe Ermüdung. Erholung einplanen.', acwr };
  if (day.tsb < -10) return { state: 'produktiv', text: 'Im Trainingsreiz. Fitness steigt, Ermüdung ist spürbar.', acwr };
  if (day.tsb <= 5) return { state: 'ausgeglichen', text: 'Belastung und Erholung im Gleichgewicht.', acwr };
  return { state: 'frisch', text: 'Ausgeruht. Gute Basis für eine harte Einheit oder einen Wettkampf.', acwr };
}
