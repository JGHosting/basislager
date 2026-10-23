/**
 * Trainings-Paces fürs Laufen (min/km) nach Jack Daniels (VDOT).
 *
 * 1) Aktuelle Form (VDOT) aus deinen Läufen der letzten 12 Wochen:
 *    – beste Abschnitte (Pace-Kurve von intervals.icu bzw. ganze Läufe) → VDOT
 *    – zusätzlich lockere Läufe (Puls ≤ 78 % HFmax) als Untergrenze, damit Tempoläufe das lockere Tempo nicht verfälschen
 * 2) Locker und lang kommen immer aus der aktuellen Form.
 * 3) Schwelle und Intervalle steigen schrittweise:
 *    – mit Laufziel/Triathlon-Ziel Richtung Zielform (+1 VDOT je ~3,5 Wochen) bis 3 Wochen vor dem Rennen
 *    – ohne Ziel leicht über die aktuelle Form (+0,25 % je Woche, höchstens +3 %)
 *    Da alles bei jedem Öffnen aus den aktuellen Läufen neu berechnet wird, laufen die Ziele der Form nie davon.
 * 4) Wettkampftempo = Zielzeit. Liegt das Ziel deutlich über dem bis zum Rennen Erreichbaren, gibt es eine Prognose.
 */
import type { Activity, Goal } from '../../core/db';
import { addDays, weekStart } from '../../core/dates';
import { TRI } from './goals';
import { effortsFromActivities, type CurveCache, type Effort } from './besttimes';

export interface Paces {
  easy: number; long: number; threshold: number; interval: number; race?: number;
  /** form = aus schnellen Abschnitten, verlauf = nur aus lockeren Läufen, standard = keine Daten. */
  source: 'form' | 'verlauf' | 'standard';
  /** Aktuelle Form und die für diese Woche angesetzte Qualitäts-Form (VDOT). */
  vdot: number; quality: number;
  /** Ziel: benötigte Form und – falls nicht erreichbar – realistische Zeit (s) über die Zieldistanz. */
  goalVdot?: number; reachable?: { secs: number; km: number };
}
export interface PaceOptions { ws?: string; curves?: CurveCache | null; hrMax?: number | null }

/* ---------- Daniels-Formeln ---------- */
const vo2 = (v: number) => -4.6 + 0.182258 * v + 0.000104 * v * v;            // v in m/min
const pctMax = (t: number) => 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t);
/** VDOT aus Strecke (m) und Zeit (s). */
export const vdotOf = (m: number, secs: number) => { const t = secs / 60; return vo2(m / t) / pctMax(t); };
/** Pace (min/km) bei Anteil f der VO2max. */
export function paceAt(vdot: number, f: number): number {
  const a = 0.000104, b = 0.182258, c = -4.6 - f * vdot;
  return 1000 / ((-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a));
}
/** Erwartete Zeit (s) über m Meter bei gegebener Form. */
export function timeFor(vdot: number, m: number): number {
  let lo = 60, hi = 60 * 60 * 12;
  for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; if (vdotOf(m, mid) > vdot) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}
// easyRun: lockere Läufe liegen meist am oberen Rand des E-Bereichs → vorsichtige Untergrenze
const F = { easy: 0.68, long: 0.66, threshold: 0.88, interval: 0.975, easyRun: 0.73 };

const WEEKLY_GOAL_STEP = 1 / 3.5;   // VDOT pro Woche Richtung Ziel
const FREE_STEP = 0.0025, FREE_MAX = 0.03;
const DEFAULT_VDOT = 39;            // ≈ locker 6:15, Schwelle 5:15
const TRI_RUN_PENALTY = 1.07;       // Laufen nach dem Rad ≈ 7 % langsamer als ein reiner Lauf

/** Beste Abschnitte der letzten 12 Wochen (Kurve „84d“, sonst 1-Jahres-Kurve mit Datum im Fenster, plus ganze Läufe). */
function recentEfforts(acts: Activity[], curves: CurveCache | null | undefined, since: string): Effort[] {
  const out: Effort[] = [];
  const recent = curves?.recent && curves.recentAt && Date.now() - curves.recentAt < 7 * 86400000 ? curves.recent : null;
  const fromCurve = recent ?? Object.fromEntries(Object.entries(curves?.year ?? {}).filter(([, e]) => e.date && e.date >= since));
  for (const [m, e] of Object.entries(fromCurve)) out.push({ ...e, m: Number(m) } as Effort & { m: number });
  for (const [m, e] of Object.entries(effortsFromActivities(acts, since))) out.push({ ...e, m: Number(m) } as Effort & { m: number });
  return out;
}

/** Form aus den schnellsten Abschnitten. 1 km nur, wenn nichts Längeres da ist (und dann 3 % vorsichtiger). */
function effortVdot(efforts: Effort[]): number | null {
  const withM = efforts as (Effort & { m: number })[];
  const long = withM.filter(e => e.m >= 3000), pool = long.length ? long : withM;
  let best: number | null = null;
  for (const e of pool) {
    const v = vdotOf(e.m, e.secs) * (e.m < 3000 ? 0.97 : 1);
    if (v > 20 && v < 85 && (best == null || v > best)) best = v;
  }
  return best;
}

/** Form-Untergrenze aus lockeren Läufen (Median-Pace ≈ lockeres Tempo). */
function easyVdot(acts: Activity[], since: string, hrMax: number | null | undefined): number | null {
  const runs = acts.filter(a => a.sportType === 'Run' && a.date >= since && (a.distance ?? 0) > 3000 && (a.duration ?? 0) > 900);
  const calm = hrMax ? runs.filter(a => a.avgHr != null && a.avgHr <= hrMax * 0.78) : [];
  const use = calm.length >= 3 ? calm : runs;
  const paces = use.map(a => a.duration! / 60 / (a.distance! / 1000)).filter(p => p > 3 && p < 9).sort((x, y) => x - y);
  if (paces.length < 3) return null;
  // Ohne Pulsfilter die langsamere Hälfte nehmen (Tempoläufe raus)
  const p = calm.length >= 3 ? paces[Math.floor(paces.length / 2)] : paces[Math.floor(paces.length * 0.65)];
  return vo2(1000 / p) / F.easyRun;
}

/** Zielform aus Laufziel bzw. Triathlon-Laufzeit. */
function goalTarget(goal: Goal | null): { vdot: number; km: number; race: number } | null {
  if (goal?.sport === 'lauf' && goal.targetTime && goal.distanceKm) {
    return { vdot: vdotOf(goal.distanceKm * 1000, goal.targetTime), km: goal.distanceKm, race: goal.targetTime / 60 / goal.distanceKm };
  }
  if (goal?.sport === 'triathlon' && goal.targetTimes?.run) {
    const km = TRI[goal.triDistance ?? 'olympisch'].run, t = goal.targetTimes.run;
    return { vdot: vdotOf(km * 1000, t / TRI_RUN_PENALTY), km, race: t / 60 / km };
  }
  return null;
}

const weeksBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 604800000);

export function estimatePaces(activities: Activity[], goal: Goal | null, today: string, o: PaceOptions = {}): Paces {
  const since = addDays(today, -84);
  const eff = effortVdot(recentEfforts(activities, o.curves, since));
  const easy = easyVdot(activities, since, o.hrMax);
  const v0 = Math.max(eff ?? 0, easy ?? 0) || DEFAULT_VDOT;
  const source: Paces['source'] = eff != null && (easy == null || eff >= easy) ? 'form' : easy != null ? 'verlauf' : 'standard';

  const cw = weekStart(today), ws = o.ws ?? cw;
  const ahead = Math.max(0, weeksBetween(cw, ws));
  const tgt = goalTarget(goal);
  let quality: number, reachable: Paces['reachable'];
  if (tgt) {
    const peak = addDays(weekStart(goal!.date), -21);
    const toPeak = Math.max(0, weeksBetween(cw, peak));
    const n = Math.min(ahead, toPeak) + 1;
    quality = Math.min(Math.max(tgt.vdot, v0), v0 + WEEKLY_GOAL_STEP * n);
    const vPeak = v0 + WEEKLY_GOAL_STEP * (toPeak + 1);
    if (tgt.vdot > vPeak + 0.3) {
      const secs = timeFor(vPeak, tgt.km * 1000) * (goal!.sport === 'triathlon' ? TRI_RUN_PENALTY : 1);
      reachable = { secs, km: tgt.km };
    }
  } else {
    quality = v0 * (1 + Math.min(FREE_MAX, FREE_STEP * (ahead + 1)));
  }

  const threshold = paceAt(quality, F.threshold);
  return {
    easy: paceAt(v0, F.easy), long: paceAt(v0, F.long), threshold, interval: paceAt(quality, F.interval),
    ...(tgt ? { race: tgt.race, goalVdot: tgt.vdot } : {}), reachable,
    source, vdot: v0, quality
  };
}
