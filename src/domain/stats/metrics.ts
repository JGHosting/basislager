/**
 * Statistik-Kennzahlen: reine Funktionen, die aus Aktivitäten/Morgenwerten Zeitreihen bauen.
 * Zeiträume werden in "Eimer" (Tag/Woche/Monat) gruppiert. Fehlende Werte bleiben null (keine 0!).
 */
import type { Activity, MorningEntry, StrengthSession, FoodLogEntry, NutritionDay, Injury, Vacation } from '../../core/db';
import { scale } from '../nutrition/calc';
import { CORE_GROUPS, groupLabel } from '../strength/strength';
import type { MuscleGroup } from '../../core/db';
import { addDays, weekStart, today } from '../../core/dates';
import { activityLoad, loadSeries, ownElevation, type HrProfile, type LoadDay } from '../load/load';

export type Period = 'woche' | 'monat' | 'saison' | 'jahr' | 'alles';
export type Bucket = 'day' | 'week' | 'month';
export const PERIODS: { id: Period; label: string }[] = [
  { id: 'woche', label: 'Woche' }, { id: 'monat', label: 'Monat' }, { id: 'saison', label: 'Saison' },
  { id: 'jahr', label: 'Jahr' }, { id: 'alles', label: 'Alles' }
];

export interface Range { from: string; to: string; bucket: Bucket }
export function rangeFor(p: Period, earliest: string | undefined, t = today()): Range {
  switch (p) {
    case 'woche': return { from: addDays(t, -6), to: t, bucket: 'day' };
    case 'monat': return { from: addDays(t, -29), to: t, bucket: 'day' };
    case 'saison': return { from: weekStart(addDays(t, -7 * 25)), to: t, bucket: 'week' };
    case 'jahr': return { from: weekStart(addDays(t, -7 * 51)), to: t, bucket: 'week' };
    case 'alles': return { from: (earliest ?? addDays(t, -365)).slice(0, 8) + '01', to: t, bucket: 'month' };
  }
}
/** Vorheriger Zeitraum gleicher Länge (für Vergleich "zum Vorzeitraum"). */
export function previousRange(r: Range): Range {
  const days = Math.round((Date.parse(r.to) - Date.parse(r.from)) / 86400000) + 1;
  return { from: addDays(r.from, -days), to: addDays(r.from, -1), bucket: r.bucket };
}

export function bucketKey(date: string, b: Bucket): string {
  return b === 'day' ? date : b === 'week' ? weekStart(date) : date.slice(0, 8) + '01';
}
export function bucketsOf(r: Range): string[] {
  const out: string[] = [];
  let d = bucketKey(r.from, r.bucket);
  while (d <= r.to) {
    out.push(d);
    if (r.bucket === 'day') d = addDays(d, 1);
    else if (r.bucket === 'week') d = addDays(d, 7);
    else { const [y, m] = d.split('-').map(Number); d = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`; }
  }
  return out;
}

/* ---------- Sportfamilien ---------- */
export const FAMILIES = [
  { id: 'rad', label: 'Rad', color: '--c-ride', test: /Ride/ },
  { id: 'lauf', label: 'Laufen', color: '--c-run', test: /Run/ },
  { id: 'schwimm', label: 'Schwimmen', color: '--c-swim', test: /Swim/ },
  { id: 'kraft', label: 'Kraft', color: '--c-strength', test: /Weight|Workout|Yoga|Elliptical|Pilates/ },
  { id: 'schnee', label: 'Schnee', color: '--c-snow', test: /Ski|Snowboard|Snowshoe/ },
  { id: 'berg', label: 'Berg', color: '--c-mountain', test: /Hike|Climb|Walk/ },
  { id: 'sonst', label: 'Sonstiges', color: '--c-other', test: /.*/ }
] as const;
export const familyOf = (sport: string) => FAMILIES.find(f => f.test.test(sport))!.id;
const SNOW_DAY = /AlpineSki|BackcountrySki|Snowboard/;

/* ---------- Kennzahlen ---------- */

export interface Series { label: string; values: (number | null)[]; color: string; kind: 'bar' | 'line' | 'points' }
export interface MetricResult {
  x: string[];                 // Eimer-Start (YYYY-MM-DD)
  series: Series[];
  stacked?: boolean;
  goal?: number | null;        // Ziellinie (z. B. Zielgewicht)
  summary: { label: string; value: number | null; prev: number | null; better: 1 | -1 | 0; note?: string };
}
export interface MetricDef {
  id: string; title: string; unit: string; digits: number; group: 'training' | 'erholung' | 'koerper' | 'ernaehrung';
  /** Als Raster (Gruppe × Zeit) statt Balken anzeigen – sinnvoll bei 0/1-Werten wie Muskelgruppen. */
  heatmap?: boolean;
  compute: (ctx: StatsContext, r: Range) => MetricResult;
}
export interface StatsContext {
  activities: Activity[]; morning: MorningEntry[]; hr: HrProfile; load: LoadDay[];
  strength: StrengthSession[]; goalWeight: number | null;
  foodlog: FoodLogEntry[]; untracked: Set<string>; kcalGoal: number | null;
  injuries: Injury[]; vacations: Vacation[];
}

const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);
const mean = (v: number[]) => (v.length ? sum(v) / v.length : null);
const inRange = (d: string, r: Range) => d >= r.from && d <= r.to;

/** Summe pro Eimer aus Aktivitäten. Eimer ohne Aktivität = 0 (echte Null: nicht trainiert). */
function actSum(ctx: StatsContext, r: Range, f: (a: Activity) => number | null, filter: (a: Activity) => boolean = () => true) {
  const x = bucketsOf(r); const m = new Map(x.map(k => [k, 0]));
  for (const a of ctx.activities) {
    if (!inRange(a.date, r) || !filter(a)) continue;
    const v = f(a); if (v == null) continue;
    const k = bucketKey(a.date, r.bucket); m.set(k, (m.get(k) ?? 0) + v);
  }
  return { x, values: x.map(k => m.get(k) ?? 0) };
}
function actTotal(ctx: StatsContext, r: Range, f: (a: Activity) => number | null) {
  return sum(ctx.activities.filter(a => inRange(a.date, r)).map(f).filter((v): v is number => v != null));
}
/** Mittelwert pro Eimer aus Morgenwerten. Eimer ohne Messung = null (Lücke, nicht 0). */
function morningMean(ctx: StatsContext, r: Range, key: 'hrv' | 'restingHr' | 'sleepScore' | 'sleepSecs' | 'weight' | 'pain', scale = 1) {
  const x = bucketsOf(r); const m = new Map<string, number[]>();
  for (const e of ctx.morning) {
    if (!inRange(e.date, r) || e[key] == null) continue;
    const k = bucketKey(e.date, r.bucket); (m.get(k) ?? m.set(k, []).get(k)!).push(e[key]! * scale);
  }
  return { x, values: x.map(k => mean(m.get(k) ?? [])) };
}
function morningPeriodMean(ctx: StatsContext, r: Range, key: 'hrv' | 'restingHr' | 'sleepScore' | 'sleepSecs' | 'weight' | 'pain', scale = 1) {
  return mean(ctx.morning.filter(e => inRange(e.date, r) && e[key] != null).map(e => e[key]! * scale));
}
/** Gleitender 7-Tage-Schnitt nur aus vorhandenen Messungen (Lücken werden nicht aufgefüllt). */
function rolling7(ctx: StatsContext, x: string[], key: 'hrv' | 'restingHr' | 'weight' | 'sleepScore' | 'sleepSecs' | 'pain', scale = 1) {
  const byDate = new Map(ctx.morning.filter(e => e[key] != null).map(e => [e.date, e[key]! * scale]));
  return x.map(d => {
    const v: number[] = [];
    for (let i = 0; i < 7; i++) { const n = byDate.get(addDays(d, -i)); if (n != null) v.push(n); }
    return v.length ? mean(v) : null;
  });
}

function morningMetric(id: string, title: string, unit: string, digits: number, key: 'hrv' | 'restingHr' | 'sleepScore' | 'sleepSecs' | 'weight' | 'pain',
  better: 1 | -1 | 0, group: MetricDef['group'], scale = 1): MetricDef {
  return {
    id, title, unit, digits, group,
    compute: (ctx, r) => {
      const { x, values } = morningMean(ctx, r, key, scale);
      const series: Series[] = r.bucket === 'day'
        ? [{ label: 'Messung', values, color: '--accent', kind: 'points' }, { label: 'Ø 7 Tage', values: rolling7(ctx, x, key, scale), color: '--accent', kind: 'line' }]
        : [{ label: r.bucket === 'week' ? 'Wochenschnitt' : 'Monatsschnitt', values, color: '--accent', kind: 'line' }];
      return { x, series, summary: { label: 'Ø im Zeitraum', value: morningPeriodMean(ctx, r, key, scale), prev: morningPeriodMean(ctx, previousRange(r), key, scale), better } };
    }
  };
}

function sumMetric(id: string, title: string, unit: string, digits: number, f: (a: Activity) => number | null, group: MetricDef['group'] = 'training'): MetricDef {
  return {
    id, title, unit, digits, group,
    compute: (ctx, r) => {
      const { x, values } = actSum(ctx, r, f);
      return { x, series: [{ label: title, values, color: '--accent', kind: 'bar' }],
        summary: { label: 'Summe', value: actTotal(ctx, r, f), prev: actTotal(ctx, previousRange(r), f), better: 0 } };
    }
  };
}

const isRun = (a: Activity) => /Run/.test(a.sportType) && !!a.distance && !!a.duration;

export const METRICS: MetricDef[] = [
  sumMetric('belastung', 'Belastung', '', 0, a => a.load ?? null),
  sumMetric('zeit', 'Trainingszeit', 'h', 1, a => (a.duration ?? a.elapsed ?? 0) / 3600),
  sumMetric('distanz', 'Distanz', 'km', 0, a => (a.distance ? a.distance / 1000 : null)),
  sumMetric('hoehe', 'Höhenmeter', 'm', 0, a => ownElevation(a)),
  {
    id: 'pace', title: 'Lauf-Pace', unit: 'min/km', digits: 2, group: 'training',
    compute: (ctx, r) => {
      const t = actSum(ctx, r, a => a.duration, isRun), d = actSum(ctx, r, a => a.distance, isRun);
      const values = t.x.map((_, i) => (d.values[i]! > 0 ? t.values[i]! / 60 / (d.values[i]! / 1000) : null));
      const tot = (rr: Range) => { const tt = actTotal({ ...ctx, activities: ctx.activities.filter(isRun) }, rr, a => a.duration), dd = actTotal({ ...ctx, activities: ctx.activities.filter(isRun) }, rr, a => a.distance); return dd ? tt / 60 / (dd / 1000) : null; };
      return { x: t.x, series: [{ label: 'Ø Pace', values, color: '--c-run', kind: r.bucket === 'day' ? 'points' : 'line' }],
        summary: { label: 'Ø Pace', value: tot(r), prev: tot(previousRange(r)), better: -1 } };
    }
  },
  {
    id: 'verteilung', title: 'Sportarten', unit: 'h', digits: 1, group: 'training',
    compute: (ctx, r) => {
      const x = bucketsOf(r);
      const series: Series[] = FAMILIES.map(f => ({
        label: f.label, color: f.color, kind: 'bar' as const,
        values: actSum(ctx, r, a => (a.duration ?? a.elapsed ?? 0) / 3600, a => familyOf(a.sportType) === f.id).values
      })).filter(s => s.values.some(v => v! > 0));
      return { x, series, stacked: true, summary: { label: 'Summe', value: actTotal(ctx, r, a => (a.duration ?? a.elapsed ?? 0) / 3600), prev: null, better: 0 } };
    }
  },
  morningMetric('hrv', 'HRV', 'ms', 0, 'hrv', 1, 'erholung'),
  morningMetric('ruhepuls', 'Ruhepuls', 'bpm', 0, 'restingHr', -1, 'erholung'),
  morningMetric('sleepscore', 'Sleep Score', '', 0, 'sleepScore', 1, 'erholung'),
  morningMetric('schlaf', 'Schlafdauer', 'h', 1, 'sleepSecs', 1, 'erholung', 1 / 3600),
  withGoal(morningMetric('gewicht', 'Gewicht', 'kg', 1, 'weight', 0, 'koerper')),
  morningMetric('schmerz', 'Schmerz', '/10', 1, 'pain', -1, 'koerper'),
  nutritionMetric('kalorien', 'Kalorien', 'kcal', 'kcal'),
  nutritionMetric('protein', 'Protein', 'g', 'protein'),
  nutritionMetric('kh', 'Kohlenhydrate', 'g', 'carbs'),
  nutritionMetric('fett', 'Fett', 'g', 'fat'),
  {
    id: 'muskeln', title: 'Muskelgruppen', unit: '×', digits: 0, group: 'training', heatmap: true,
    compute: (ctx, r) => {
      const x = bucketsOf(r);
      const done = ctx.strength.filter(s => !s.skipped && s.muscleGroups.length && inRange(s.date, r));
      // Ganzkörper ist eine eigene Säule – eine Ganzkörper-Einheit zählt einmal, nicht in jeder Gruppe.
      // Nur Gruppen zeigen, die auch vorkommen, damit z. B. "Arme" ohne Nutzung nicht auftaucht.
      const chart: MuscleGroup[] = [...CORE_GROUPS, 'ganzkoerper'];
      const colors: Record<string, string> = { push: '--c-ride', pull: '--c-run', arme: '--c-snow', beine: '--c-swim', rumpf: '--c-strength', ganzkoerper: '--c-other' };
      const series: Series[] = chart.filter(g => done.some(s => s.muscleGroups.includes(g))).map(g => {
        const m = new Map(x.map(k => [k, 0]));
        for (const s of done) if (s.muscleGroups.includes(g)) { const k = bucketKey(s.date, r.bucket); m.set(k, (m.get(k) ?? 0) + 1); }
        return { label: groupLabel(g), values: x.map(k => m.get(k) ?? 0), color: colors[g], kind: 'bar' as const };
      });
      return { x, series, stacked: true, summary: { label: 'Krafteinheiten', value: done.length, prev: ctx.strength.filter(s => !s.skipped && s.muscleGroups.length && inRange(s.date, previousRange(r))).length, better: 0 } };
    }
  }
];

/**
 * Ernährung je Tag: nur getrackte Tage mit Einträgen zählen. Nicht getrackt / keine Einträge = Lücke (nie 0 kcal).
 * Wochen/Monate: Ø über die getrackten Tage.
 */
function nutritionMetric(id: string, title: string, unit: string, key: 'kcal' | 'protein' | 'carbs' | 'fat'): MetricDef {
  return {
    id, title, unit, digits: 0, group: 'ernaehrung',
    compute: (ctx, r) => {
      const perDay = new Map<string, number>();
      for (const e of ctx.foodlog) {
        if (!inRange(e.date, r) && !inRange(e.date, previousRange(r))) continue;
        if (ctx.untracked.has(e.date)) continue;
        const v = scale(e.snapshot, e.grams)[key];
        if (v != null) perDay.set(e.date, (perDay.get(e.date) ?? 0) + v);
      }
      const x = bucketsOf(r); const b = new Map<string, number[]>();
      for (const [d, v] of perDay) if (inRange(d, r)) (b.get(bucketKey(d, r.bucket)) ?? b.set(bucketKey(d, r.bucket), []).get(bucketKey(d, r.bucket))!).push(v);
      const values = x.map(k => mean(b.get(k) ?? []));
      const periodMean = (rr: Range) => mean([...perDay].filter(([d]) => inRange(d, rr)).map(([, v]) => v));
      const days = [...perDay.keys()].filter(d => inRange(d, r)).length;
      return {
        x, series: [{ label: r.bucket === 'day' ? 'Tag' : 'Ø pro Tag', values, color: '--accent', kind: r.bucket === 'day' ? 'bar' : 'line' }],
        goal: key === 'kcal' ? ctx.kcalGoal : null,
        summary: { label: 'Ø pro getracktem Tag', value: periodMean(r), prev: periodMean(previousRange(r)), better: 0, note: `${days} ${days === 1 ? 'Tag' : 'Tage'} getrackt` }
      };
    }
  };
}

function withGoal(def: MetricDef): MetricDef {
  return { ...def, compute: (ctx, r) => {
    const res = def.compute(ctx, r);
    if (ctx.goalWeight == null) return res;
    const cur = rolling7(ctx, [r.to], 'weight')[0];
    return { ...res, goal: ctx.goalWeight, summary: cur != null ? { label: 'Ø 7 Tage', value: cur, prev: null, better: 0, note: `noch ${Math.abs(cur - ctx.goalWeight).toLocaleString('de-DE', { maximumFractionDigits: 1 })} kg bis Ziel (${ctx.goalWeight.toLocaleString('de-DE')} kg)` } : res.summary };
  } };
}

/** Aktivitäten mit vorab berechneter Belastung (einmal pro Datenstand). */
export function buildContext(activities: Activity[], morning: MorningEntry[], hr: HrProfile, strength: StrengthSession[] = [], goalWeight: number | null = null,
  foodlog: FoodLogEntry[] = [], nutritionDays: NutritionDay[] = [], kcalGoal: number | null = null, injuries: Injury[] = [], vacations: Vacation[] = []): StatsContext {
  const tracked = new Set(nutritionDays.filter(d => d.tracked).map(d => d.date));
  const untracked = new Set(nutritionDays.filter(d => !d.tracked).map(d => d.date));
  for (const v of vacations) for (let d = v.start; d <= v.end; d = addDays(d, 1)) if (!tracked.has(d)) untracked.add(d);
  const intens = new Map(strength.filter(s => s.activityId).map(s => [s.activityId!, s.intensity]));
  const withLoad = activities.map(a => Object.assign({}, a, { load: activityLoad(a, hr, intens.get(a.id)).load }));
  return { activities: withLoad as (Activity & { load: number })[], morning, hr, load: loadSeries(activities, hr, today(), intens), strength, goalWeight,
    foodlog, untracked, kcalGoal, injuries, vacations };
}

/** Tage mit aktiver Verletzung (Start bis Ende bzw. heute). */
export function injuryDays(ctx: StatsContext, r: Range): string[] {
  const out: string[] = [];
  for (const i of ctx.injuries) {
    const end = i.endDate ?? today();
    for (let d = i.startDate > r.from ? i.startDate : r.from; d <= end && d <= r.to; d = addDays(d, 1)) out.push(d);
  }
  return out;
}

/** Urlaubstage im Zeitraum. */
export function vacationDays(ctx: StatsContext, r: Range): string[] {
  const out: string[] = [];
  for (const v of ctx.vacations) for (let d = v.start > r.from ? v.start : r.from; d <= v.end && d <= r.to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Schneetage (Ski/Snowboard/Skitour) als Markierungen im Diagramm. */
export function snowDays(ctx: StatsContext, r: Range): string[] {
  return [...new Set(ctx.activities.filter(a => inRange(a.date, r) && SNOW_DAY.test(a.sportType)).map(a => a.date))];
}

declare module '../../core/db' { interface Activity { load?: number } }
