/**
 * Trainings-Paces fürs Laufen (min/km) nach Jack Daniels (VDOT).
 *
 * 1) Aktuelle Form (VDOT) aus deinen Läufen der letzten 12 Wochen (nach einer Pause: die 12 Wochen davor,
 *    abgeschwächt je nach Pausenlänge – auch Pausen mitten im Fenster, z. B. Verletzung):
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
  /** Aktuelle Laufpause in Wochen (≥ 2) – Form ist entsprechend abgeschwächt. */
  pauseWeeks?: number;
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

const RUNNING = /^(Run|VirtualRun|TrailRun)$/;
const GAP_DAYS = 10;                // ab so vielen Tagen ohne Lauf zählt es als Pause

/**
 * Formverlust durch Pausen (Verletzung, keine Läufe). Grob nach Daniels:
 * die erste Woche kostet nichts, danach ≈ 1,8 % pro Woche, höchstens 20 %.
 */
export const detrain = (weeksOff: number) => (weeksOff <= 1 ? 1 : Math.max(0.8, 1 - 0.018 * (weeksOff - 1)));

/** Pausen (≥ 10 Tage ohne Lauf) zwischen den Läufen und seit dem letzten Lauf. */
function pauses(acts: Activity[], today: string): { from: string; days: number }[] {
  const dates = [...new Set(acts.filter(a => RUNNING.test(a.sportType) && a.date <= today).map(a => a.date))].sort();
  const out: { from: string; days: number }[] = [];
  const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
  for (let i = 1; i < dates.length; i++) { const d = days(dates[i - 1], dates[i]); if (d >= GAP_DAYS) out.push({ from: dates[i - 1], days: d }); }
  if (dates.length) { const d = days(dates[dates.length - 1], today); if (d >= GAP_DAYS) out.push({ from: dates[dates.length - 1], days: d }); }
  return out;
}
/** Abschwächungsfaktor für eine Leistung an Datum d: alle Pausen danach zusammengezählt. */
const decayFor = (gaps: { from: string; days: number }[], d: string | undefined) =>
  detrain(gaps.filter(g => !d || g.from >= d).reduce((s, g) => s + g.days, 0) / 7);

type DatedEffort = Effort & { m: number };
/** Beste Abschnitte im Fenster (Kurve „84d“ und 1-Jahres-Kurve mit Datum im Fenster, plus ganze Läufe). */
function windowEfforts(acts: Activity[], curves: CurveCache | null | undefined, since: string): DatedEffort[] {
  const out: DatedEffort[] = [];
  const fresh = curves?.recentAt && Date.now() - curves.recentAt < 7 * 86400000;
  const add = (src: Record<string, Effort> | undefined, needDate: boolean) => {
    for (const [m, e] of Object.entries(src ?? {})) if (e.date ? e.date >= since : !needDate) out.push({ ...e, m: Number(m) });
  };
  if (fresh) add(curves!.recent, false);
  add(curves?.year, true);
  add(effortsFromActivities(acts, since), true);
  return out;
}

/** Form aus den schnellsten Abschnitten (je nach Pausen danach abgeschwächt). 1 km nur ohne Längeres (×0,97). */
function effortVdot(efforts: DatedEffort[], gaps: { from: string; days: number }[]): number | null {
  const long = efforts.filter(e => e.m >= 3000), pool = long.length ? long : efforts;
  let best: number | null = null;
  for (const e of pool) {
    const raw = vdotOf(e.m, e.secs);
    if (!(raw > 20 && raw < 85)) continue;
    const v = raw * (e.m < 3000 ? 0.97 : 1) * decayFor(gaps, e.date);
    if (best == null || v > best) best = v;
  }
  return best;
}

/** Form-Untergrenze aus lockeren Läufen (Median ≈ lockeres Tempo), je Lauf mit Pausen danach abgeschwächt. */
function easyVdot(acts: Activity[], since: string, hrMax: number | null | undefined, gaps: { from: string; days: number }[]): number | null {
  const runs = acts.filter(a => a.sportType === 'Run' && a.date >= since && (a.distance ?? 0) > 3000 && (a.duration ?? 0) > 900)
    .map(a => ({ a, p: a.duration! / 60 / (a.distance! / 1000) })).filter(x => x.p > 3 && x.p < 9);
  const calm = hrMax ? runs.filter(x => x.a.avgHr != null && x.a.avgHr <= hrMax * 0.78) : [];
  const use = calm.length >= 3 ? calm : runs;
  if (use.length < 3) return null;
  // Ohne Pulsfilter eher die langsameren Läufe nehmen (Tempoläufe raus)
  const vs = use.map(x => (vo2(1000 / x.p) / F.easyRun) * decayFor(gaps, x.a.date)).sort((x, y) => y - x);
  return vs[Math.floor(vs.length * (calm.length >= 3 ? 0.5 : 0.65))];
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
  // Fenster: 12 Wochen bis zum letzten Lauf (höchstens 1 Jahr zurück) – nach einer Pause zählen die Läufe davor, abgeschwächt
  const lastRun = activities.filter(a => RUNNING.test(a.sportType) && a.date <= today && a.date >= addDays(today, -365)).reduce((m, a) => (a.date > m ? a.date : m), '');
  const since = addDays(lastRun || today, -84);
  const gaps = pauses(activities, today);
  const eff = effortVdot(windowEfforts(activities, o.curves, since), gaps);
  const easy = easyVdot(activities, since, o.hrMax, gaps);
  const cur = gaps.find(g => g.from === lastRun);
  const pauseWeeks = cur ? Math.round(cur.days / 7) : 0;
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
    source, vdot: v0, quality, ...(pauseWeeks >= 2 ? { pauseWeeks } : {})
  };
}
