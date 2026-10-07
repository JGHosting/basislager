/**
 * Trainingsplaner.
 *
 * Standardwoche (ohne Wettkampf): 3× Kraft nach deinem Split, 2–3× Laufen.
 *   Laufumfang = Schnitt deiner letzten 4 Wochen + 8 %, für jede weitere Woche +5 %,
 *   jede 4. Kalenderwoche Entlastung (−25 %). Dadurch steigert sich der Plan langfristig mit dir.
 * Wettkampfmodus: Periodisierung rückwärts vom Wettkampftag (Grundlage → Aufbau → Spitze → Taper → Wettkampfwoche),
 *   Hauptsportart bekommt den Großteil, Kraft bleibt (zum Ende leichter), bei anderer Hauptsportart 1× locker Laufen,
 *   außer der Umfang ist ohnehin sehr hoch.
 * Danach werden Fixtermine, Verletzung, deine Änderungen und erledigte Einheiten eingerechnet.
 * Alles regelbasiert und nachvollziehbar, ohne Server.
 */
import type { Activity, StrengthSession, SplitTemplate, Goal, Injury, FixedEvent, PlanEdit, MuscleGroup, Movement, Vacation } from '../../core/db';
import { addDays, weekStart, today as todayFn } from '../../core/dates';
import { nextSplitDay, groupLabel } from '../strength/strength';
import { STAGES, STAGE_VOLUME, MOVEMENTS, isOutage } from '../injury/injury';
import { TRI, goalLabel, fmtPace } from './goals';
import { estimatePaces, type Paces } from './paces';
import { activityLoad, loadSeries, type HrProfile } from '../load/load';
import { sportName } from '../../ui/format';

export type PlanSport = 'kraft' | 'lauf' | 'trail' | 'rad' | 'schwimmen' | 'gehen' | 'wettkampf';
export type Intensity = 'locker' | 'mittel' | 'hart' | 'wettkampf';
export interface PlanSession {
  key: string; date: string; origDate: string; sport: PlanSport; title: string; minutes: number;
  intensity: Intensity; details: string; groups?: MuscleGroup[]; elevation?: number;
  status: 'offen' | 'erledigt' | 'ausgelassen'; autoDone?: boolean; moved?: boolean; notes: string[];
  activityId?: string;   // passende Garmin-Aktivität (bei automatisch erledigt)
}
export type Phase = 'basis' | 'grundlage' | 'aufbau' | 'spitze' | 'taper' | 'wettkampfwoche' | 'erholung' | 'urlaub';
export const PHASE_LABEL: Record<Phase, string> = {
  basis: 'Standardwoche', grundlage: 'Grundlage', aufbau: 'Aufbau', spitze: 'Spitze', taper: 'Taper', wettkampfwoche: 'Wettkampfwoche', erholung: 'Erholungswoche', urlaub: 'Urlaubswoche (zählt als Erholung)'
};
export interface PlanWeek {
  weekStart: string; phase: Phase; goal: Goal | null; weekNo?: number; totalWeeks?: number;
  sessions: PlanSession[]; events: FixedEvent[]; paces: Paces; minutes: number; runMinutes: number;
  /** Außerplanmäßige Aktivitäten dieser Woche und was daraufhin angepasst wurde. */
  extra: { text: string; load: number }[]; adjusted: boolean;
}
export interface PlanContext {
  today: string; activities: Activity[]; strength: StrengthSession[]; split: SplitTemplate | null;
  goal: Goal | null; injury: Injury | null; events: FixedEvent[]; edits: Map<string, PlanEdit>;
  runsPerWeek: 2 | 3; vacations: Vacation[];
  /** Krafteinheiten pro Woche (1–6, Standard 3). */
  strengthPerWeek?: number;
  hr?: HrProfile;
}

/* ---------- Hilfen ---------- */
const r5 = (m: number) => Math.max(20, Math.round(m / 5) * 5);
const DAY = (ws: string, i: number) => addDays(ws, i);   // 0 = Montag
export function isoWeek(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d)); const day = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - day + 3);
  const first = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((dt.getTime() - first.getTime()) / 86400000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
}
function recentMinutes(acts: Activity[], before: string, test: RegExp): number {
  const from = addDays(before, -28);
  return acts.filter(a => a.date >= from && a.date < before && test.test(a.sportType)).reduce((s, a) => s + (a.duration ?? a.elapsed ?? 0) / 60, 0) / 4;
}
const pr = (p: number, spread = 0.12) => `${fmtPace(p - spread)}–${fmtPace(p + spread)} min/km`;
const isLongGoal = (g: Goal) => (g.sport === 'lauf' && (g.distanceKm ?? 0) > 30) || (g.sport === 'trailrun' && (g.distanceKm ?? 0) > 42)
  || (g.sport === 'rad' && (g.distanceKm ?? 0) > 160) || (g.sport === 'triathlon' && (g.triDistance === '70.3' || g.triDistance === 'lang'));

/**
 * Reduzierte Urlaubswoche: mind. 4 Tage Urlaub mit "weniger" oder "keins".
 * Sie zählt als Erholungswoche – die nächste geplante Erholungswoche rückt dafür nach hinten.
 */
export function isVacationWeek(ws: string, vacations: Vacation[]): boolean {
  let n = 0;
  for (let i = 0; i < 7; i++) { const d = addDays(ws, i); if (vacations.some(v => v.training !== 'voll' && d >= v.start && d <= v.end)) n++; }
  return n >= 4;
}

/** Standardwoche: Erholungswoche? Ohne Urlaub jede 4. Kalenderwoche, Urlaub verschiebt den Rhythmus. */
function baseRecovery(ws: string, vacs: Vacation[]): boolean {
  let w = addDays(ws, -7 * 16);
  let c = (isoWeek(w) + 3) % 4;      // so ausgerichtet, dass ohne Urlaub KW % 4 == 0 Erholung ist
  let rec = false;
  for (; w <= ws; w = addDays(w, 7)) {
    if (isVacationWeek(w, vacs)) { c = 0; rec = false; continue; }
    if (c === 3) { c = 0; rec = true; } else { c++; rec = false; }
  }
  return rec;
}

/* ---------- Umfang im Wettkampfmodus (Minuten Hauptsportart pro Woche) ---------- */
function goalVolumes(g: Goal, ctx: PlanContext, ws: string) {
  const km = g.distanceKm ?? 0;
  const run = recentMinutes(ctx.activities, ws, /Run/), ride = recentMinutes(ctx.activities, ws, /Ride/), swim = recentMinutes(ctx.activities, ws, /Swim/);
  switch (g.sport) {
    case 'lauf': return { start: Math.max(run, km <= 6 ? 120 : km <= 11 ? 150 : km <= 22 ? 180 : 240), peak: km <= 6 ? 210 : km <= 11 ? 240 : km <= 22 ? 300 : 390 };
    case 'trailrun': return { start: Math.max(run, 180), peak: km <= 25 ? 300 : km <= 45 ? 390 : km <= 80 ? 480 : 560 };
    case 'rad': return { start: Math.max(ride, 150), peak: (km <= 60 ? 300 : km <= 120 ? 420 : km <= 200 ? 540 : 660) * ((g.elevation ?? 0) > 1500 ? 1.1 : 1) };
    case 'schwimmen': return { start: Math.max(swim, 90), peak: km <= 2 ? 150 : km <= 4 ? 210 : 270 };
    case 'triathlon': { const peak = { sprint: 360, olympisch: 480, '70.3': 600, lang: 840 }[g.triDistance ?? 'olympisch']; return { start: Math.max(run + ride + swim, peak * 0.5), peak }; }
  }
}

/** Phase und Umfangsfaktor einer Woche im Wettkampfplan. */
function goalPhase(g: Goal, ws: string, vacations: Vacation[]) {
  const startWs = weekStart(g.planStart), raceWs = weekStart(g.date);
  const total = Math.round((Date.parse(raceWs) - Date.parse(startWs)) / 604800000) + 1;
  const idx = Math.round((Date.parse(ws) - Date.parse(startWs)) / 604800000);
  const toRace = total - 1 - idx;
  const taper = isLongGoal(g) ? 2 : 1;          // inkl. Wettkampfwoche
  const peakWeeks = total >= 8 ? 2 : total >= 5 ? 1 : 0;
  const buildEnd = total - taper - peakWeeks;   // Wochen 0..buildEnd-1 = Grundlage/Aufbau
  // Wochentyp für jede Woche bis zur Spitze: Belastung, Erholung (jede 4.) oder Urlaub (zählt als Erholung → Zähler neu)
  const kind: ('last' | 'erholung' | 'urlaub')[] = [];
  let sinceRecovery = 0;
  for (let i = 0; i < buildEnd + peakWeeks; i++) {
    const wsI = addDays(startWs, i * 7);
    if (isVacationWeek(wsI, vacations)) { kind.push('urlaub'); sinceRecovery = 0; continue; }
    if (sinceRecovery === 3 && i < total - taper - 1 && i < buildEnd) { kind.push('erholung'); sinceRecovery = 0; continue; }
    kind.push('last'); sinceRecovery++;
  }
  let phase: Phase;
  if (toRace === 0) phase = 'wettkampfwoche';
  else if (toRace < taper) phase = 'taper';
  else if (kind[idx] === 'urlaub') phase = 'urlaub';
  else if (idx >= buildEnd) phase = 'spitze';
  else if (kind[idx] === 'erholung') phase = 'erholung';
  else phase = idx < Math.max(1, Math.round(buildEnd * 0.35)) ? 'grundlage' : 'aufbau';
  // Steigerung über alle Belastungswochen bis zur Spitze
  const loadWeeks = kind.map((k, i) => (k === 'last' ? i : -1)).filter(i => i >= 0);
  const pos = loadWeeks.filter(i => i <= idx).length;
  const ramp = loadWeeks.length > 1 ? Math.max(0, Math.min(1, (pos - 1) / (loadWeeks.length - 1))) : 1;
  return { phase, idx, total, toRace, ramp };
}

/* ---------- Kraft ---------- */
export const kraftCount = (ctx: PlanContext) => Math.max(1, Math.min(6, Math.round(ctx.strengthPerWeek ?? 3)));
/** Krafttage je Anzahl (0 = Montag). Samstag (langer Lauf) bleibt immer frei. */
export const KRAFT_DAYS: Record<number, number[]> = { 1: [0], 2: [0, 3], 3: [0, 2, 4], 4: [0, 2, 4, 6], 5: [0, 1, 2, 4, 6], 6: [0, 1, 2, 3, 4, 6] };
/** Kein schweres Beintraining am Tag vor dem langen Lauf (Fr) und am Tag danach (So). */
const noLegDay = (d: number) => d === 4 || d === 6;
/**
 * Verteilt die Split-Tage auf die Krafttage: Beintage möglichst mit mindestens einem Tag Abstand
 * und nicht vor/nach dem langen Lauf. Was nicht passt, wird ohne schweres Beintraining geplant.
 */
function assignKraft(days: number[], groups: MuscleGroup[][]): { day: number; groups: MuscleGroup[]; noLegs: boolean }[] {
  const legs = groups.filter(hasLegs), other = groups.filter(g => !hasLegs(g));
  const legDays: number[] = [];
  for (const d of days) if (!noLegDay(d) && legDays.length < legs.length && legDays.every(x => Math.abs(x - d) >= 2)) legDays.push(d);
  const rest = days.filter(d => !legDays.includes(d));
  const queue = [...other, ...legs.slice(legDays.length)];
  const out = [...legDays.map((day, i) => ({ day, groups: legs[i], noLegs: false })),
    ...rest.map((day, i) => ({ day, groups: queue[i], noLegs: true }))];
  return out.sort((a, b) => a.day - b.day);
}
function strengthGroups(ctx: PlanContext, ws: string, count: number): MuscleGroup[][] {
  const thisWeekOffset = Math.max(0, Math.round((Date.parse(ws) - Date.parse(weekStart(ctx.today))) / 604800000));
  if (!ctx.split) return Array.from({ length: count }, () => ['ganzkoerper']);
  const before = ctx.strength.filter(s => s.date < weekStart(ctx.today));
  const start = nextSplitDay(ctx.split, before).index + thisWeekOffset * kraftCount(ctx);
  return Array.from({ length: count }, (_, i) => [...ctx.split!.days[(start + i) % ctx.split!.days.length]]);
}
const hasLegs = (g: MuscleGroup[]) => g.includes('beine') || g.includes('ganzkoerper');
function kraft(ws: string, day: number, slot: string, groups: MuscleGroup[], light: boolean, noLegs: boolean): PlanSession {
  let gs = groups;
  const notes: string[] = [];
  if (noLegs && hasLegs(gs)) { gs = gs.filter(g => g !== 'beine'); if (gs.includes('ganzkoerper')) gs = ['push', 'pull', 'rumpf']; if (!gs.length || (gs.length === 1 && gs[0] === 'rumpf')) gs = ['push', 'pull', ...gs]; notes.push('Ohne schweres Beintraining (Wettkampf/harte Einheit steht an).'); }
  return {
    key: `${ws}:${slot}`, date: DAY(ws, day), origDate: DAY(ws, day), sport: 'kraft', minutes: light ? 40 : 60,
    title: `Kraft · ${gs.map(groupLabel).join(' + ')}`, groups: gs, intensity: light ? 'locker' : 'mittel',
    details: light ? 'Leichter als sonst: 1–2 Sätze weniger, nicht bis zum Muskelversagen.' : 'Nach deinem Split. Intensität nach Gefühl, 1–2 Wiederholungen Reserve.',
    status: 'offen', notes
  };
}

/* ---------- Ausdauer-Bausteine ---------- */
function S(ws: string, day: number, slot: string, sport: PlanSport, title: string, minutes: number, intensity: Intensity, details: string, elevation?: number): PlanSession {
  return { key: `${ws}:${slot}`, date: DAY(ws, day), origDate: DAY(ws, day), sport, title, minutes: r5(minutes), intensity, details, elevation, status: 'offen', notes: [] };
}
function runQuality(ws: string, day: number, slot: string, phase: Phase, wk: number, p: Paces, minutes: number, g: Goal | null, trail: boolean): PlanSession {
  const m = r5(minutes);
  const sport: PlanSport = trail ? 'trail' : 'lauf';
  if (phase === 'basis' || phase === 'grundlage' || phase === 'erholung')
    return S(ws, day, slot, sport, 'Fahrtspiel', m, 'mittel', `Locker (${pr(p.easy)}), darin 6–8 × 1 min zügig nach Gefühl (≈ ${fmtPace(p.threshold)} min/km) mit 2 min locker. Zum Schluss 4 Steigerungen.`);
  if (phase === 'wettkampfwoche')
    return S(ws, day, slot, sport, 'Kurz & knackig', Math.min(m, 40), 'mittel', `15 min einlaufen, 3 × 4 min ${p.race ? 'Wettkampftempo ' + pr(p.race, 0.05) : 'zügig ' + pr(p.threshold, 0.05)}, 2 min Trabpause, auslaufen. Beine frisch halten.`);
  if (phase === 'spitze' && g) {
    const rp = p.race ?? p.threshold;
    if (trail) return S(ws, day, slot, 'trail', 'Bergintervalle lang', m, 'hart', `Einlaufen, 4–5 × 6 min bergauf zügig (Gehen an Steilstücken erlaubt), locker zurück. Bergab bewusst kontrolliert laufen – Bergab-Technik üben.`);
    if ((g.distanceKm ?? 0) <= 11 || g.sport === 'triathlon') return S(ws, day, slot, sport, 'Wettkampftempo', m, 'hart', `15 min einlaufen, 5 × 1 km in ${pr(rp, 0.05)}, 2 min Trabpause, auslaufen.`);
    return S(ws, day, slot, sport, 'Wettkampftempo-Block', m, 'hart', `15 min einlaufen, 2 × 15–20 min in ${pr(rp, 0.05)} mit 4 min locker, auslaufen.`);
  }
  const variant = wk % 3;
  if (trail && variant !== 1) return S(ws, day, slot, 'trail', 'Bergintervalle', m, 'hart', `Einlaufen, 6–8 × 2–3 min zügig bergauf, locker bergab traben. Danach 10 min locker.`);
  if (variant === 0) return S(ws, day, slot, sport, 'Intervalle', m, 'hart', `15 min einlaufen, 5–6 × 3 min in ${pr(p.interval, 0.06)}, 2 min Trabpause, 10 min auslaufen.`);
  if (variant === 1) return S(ws, day, slot, sport, 'Schwelle', m, 'hart', `15 min einlaufen, 3 × 8 min in ${pr(p.threshold, 0.06)}, 2 min Trabpause, 10 min auslaufen.`);
  return S(ws, day, slot, sport, 'Tempodauerlauf', m, 'mittel', `15 min einlaufen, 20–25 min gleichmäßig in ${pr(p.threshold + 0.1, 0.06)}, auslaufen.`);
}
const easyRun = (ws: string, day: number, slot: string, p: Paces, min: number, trail = false) =>
  S(ws, day, slot, trail ? 'trail' : 'lauf', 'Lockerer Lauf', min, 'locker', `Ruhig im Gesprächstempo, ${pr(p.easy)}.${trail ? ' Gern auf Trails/Wegen.' : ''}`);
function longRun(ws: string, day: number, slot: string, p: Paces, min: number, phase: Phase, g: Goal | null, trail: boolean, hm?: number) {
  let details = `Lang und ruhig, ${pr(p.long)}. Verpflegung/Trinken testen.`;
  if (phase === 'spitze' && p.race && g?.sport === 'lauf' && (g.distanceKm ?? 0) > 20) details = `Lang, letzte 30–40 min im Wettkampftempo ${pr(p.race, 0.05)}. Wettkampfverpflegung testen.`;
  if (trail) details = `Lang auf Trails mit ca. ${hm ?? 0} hm, Tempo nach Gefühl (bergauf gehen ist okay). Bergab locker und kontrolliert.`;
  return S(ws, day, slot, trail ? 'trail' : 'lauf', trail ? 'Langer Trailrun' : 'Langer Lauf', min, 'mittel', details, trail ? hm : undefined);
}

/* ---------- Woche erzeugen ---------- */
export function buildWeek(ws: string, ctx: PlanContext): PlanWeek {
  const g = ctx.goal && !ctx.goal.archived && ws >= weekStart(ctx.goal.planStart) && ws <= weekStart(ctx.goal.date) ? ctx.goal : null;
  const p = estimatePaces(ctx.activities, ctx.goal && !ctx.goal.archived ? ctx.goal : null, ctx.today);
  const ahead = Math.max(0, Math.round((Date.parse(ws) - Date.parse(weekStart(ctx.today))) / 604800000));
  const sessions: PlanSession[] = [];
  let phase: Phase = 'basis', weekNo: number | undefined, total: number | undefined;

  if (!g) {
    /* Standardwoche: Mo Kraft (Beine), Di locker, Mi Kraft, Do Qualität, Fr Kraft, Sa lang, So frei */
    const vacs = ctx.vacations ?? [];
    const vacWeek = isVacationWeek(ws, vacs);
    // Erholung nach je 3 Belastungswochen; eine reduzierte Urlaubswoche zählt als Erholung und startet den Zähler neu
    const recovery = !vacWeek && baseRecovery(ws, vacs);
    phase = vacWeek ? 'urlaub' : recovery ? 'erholung' : 'basis';
    const recent = Math.max(90, recentMinutes(ctx.activities, weekStart(ctx.today), /Run/));
    const vol = Math.min(recent * 1.08 * Math.pow(1.05, ahead), recent * 1.5) * (recovery ? 0.75 : 1);
    const kDays = KRAFT_DAYS[kraftCount(ctx)];
    const kg = strengthGroups(ctx, ws, kDays.length);
    assignKraft(kDays, kg).forEach((k, i) => sessions.push(kraft(ws, k.day, `kraft${i + 1}`, k.groups, false, k.noLegs)));
    if (ctx.runsPerWeek === 3) {
      sessions.push(easyRun(ws, 1, 'run-easy', p, vol * 0.3), runQuality(ws, 3, 'run-q', phase, isoWeek(ws), p, vol * 0.3, null, false), longRun(ws, 5, 'run-long', p, Math.min(vol * 0.4, 150), phase, null, false));
    } else {
      sessions.push(runQuality(ws, 1, 'run-q', phase, isoWeek(ws), p, vol * 0.45, null, false), longRun(ws, 5, 'run-long', p, Math.min(vol * 0.55, 150), phase, null, false));
    }
  } else {
    const gp = goalPhase(g, ws, ctx.vacations ?? []); phase = gp.phase; weekNo = gp.idx + 1; total = gp.total;
    const v = goalVolumes(g, ctx, weekStart(ctx.today));
    const peak = Math.max(v.peak, v.start);
    let vol = v.start + (peak - v.start) * gp.ramp;
    if (phase === 'erholung') vol *= 0.75;
    if (phase === 'taper') vol = peak * 0.65;
    if (phase === 'wettkampfwoche') vol = peak * 0.4;
    const raceDay = (Date.parse(g.date) - Date.parse(ws)) / 86400000;   // 0..6 in der Wettkampfwoche
    // Kraft: wie eingestellt, Taper eine weniger und leichter, Wettkampfwoche 1× leicht ohne Beine
    const n = kraftCount(ctx);
    const kCount = phase === 'wettkampfwoche' ? 1 : phase === 'taper' ? Math.max(1, n - 1) : n;
    const kg = strengthGroups(ctx, ws, kCount);
    const kDays = KRAFT_DAYS[kCount];
    assignKraft(kDays, kg).forEach((k, i) => sessions.push(kraft(ws, k.day, `kraft${i + 1}`, k.groups, phase === 'taper' || phase === 'wettkampfwoche',
      phase === 'wettkampfwoche' || k.noLegs || (phase === 'taper' && i > 0))));
    const trail = g.sport === 'trailrun';

    if (g.sport === 'lauf' || g.sport === 'trailrun') {
      const four = peak >= 240 && phase !== 'wettkampfwoche';
      const longCap = trail ? Math.min(270, 60 + (g.distanceKm ?? 20) * 4) : (g.distanceKm ?? 10) <= 11 ? 95 : (g.distanceKm ?? 0) <= 22 ? 130 : 190;
      const hmWeek = trail ? Math.round((g.elevation ?? 800) * (0.35 + 0.35 * gp.ramp) * (phase === 'erholung' || phase === 'taper' ? 0.6 : 1) / 50) * 50 : 0;
      sessions.push(easyRun(ws, 1, 'run-easy', p, vol * (four ? 0.2 : 0.28), trail));
      sessions.push(runQuality(ws, 3, 'run-q', phase, gp.idx, p, vol * 0.24, g, trail));
      if (phase !== 'wettkampfwoche') sessions.push(longRun(ws, 5, 'run-long', p, Math.min(vol * (four ? 0.36 : 0.45), longCap), phase, g, trail, Math.round(hmWeek * 0.6 / 50) * 50));
      if (four) sessions.push(easyRun(ws, 6, 'run-easy2', p, vol * 0.2, trail));
    } else if (g.sport === 'rad') {
      const hm = g.elevation ? Math.round(g.elevation * (0.4 + 0.4 * gp.ramp) / 50) * 50 : undefined;
      sessions.push(S(ws, 1, 'ride-easy', 'rad', 'Lockere Ausfahrt', vol * 0.22, 'locker', 'Gleichmäßig locker, hohe Trittfrequenz (85–95).'));
      sessions.push(S(ws, 3, 'ride-q', 'rad', phase === 'grundlage' || phase === 'erholung' ? 'Ausfahrt mit Tempowechseln' : phase === 'spitze' ? 'Wettkampftempo am Rad' : 'Rad-Intervalle', vol * 0.25,
        phase === 'grundlage' || phase === 'erholung' ? 'mittel' : 'hart',
        phase === 'grundlage' || phase === 'erholung' ? 'Locker, darin 6 × 2 min zügig.' : phase === 'spitze' ? '20 min einfahren, 3 × 15 min im geplanten Wettkampftempo, 5 min locker dazwischen.' : '20 min einfahren, 4–5 × 8 min zügig (Schwelle), 4 min locker, ausfahren.'));
      if (phase !== 'wettkampfwoche') sessions.push(S(ws, 5, 'ride-long', 'rad', 'Lange Ausfahrt', Math.min(vol * 0.53, 360), 'mittel', `Lang und gleichmäßig${hm ? `, möglichst ca. ${hm} hm` : ''}. Verpflegung wie im Wettkampf testen.`, hm));
      // 1× locker Laufen – außer der Radumfang ist ohnehin sehr hoch
      if (vol < 420 && phase !== 'wettkampfwoche') sessions.push(easyRun(ws, 6, 'run-easy', p, 35));
    } else if (g.sport === 'schwimmen') {
      sessions.push(S(ws, 1, 'swim-tech', 'schwimmen', 'Technik & Grundlage', vol * 0.3, 'locker', 'Einschwimmen, Technikübungen (z. B. Abschlag, Zählen der Züge), dann ruhig durchschwimmen.'));
      sessions.push(S(ws, 3, 'swim-q', 'schwimmen', phase === 'spitze' ? 'Wettkampftempo' : 'Intervalle', vol * 0.3, phase === 'grundlage' ? 'mittel' : 'hart',
        phase === 'spitze' ? 'Einschwimmen, 4 × 400 m im Wettkampftempo, 1 min Pause.' : 'Einschwimmen, 10–12 × 100 m zügig, 20 s Pause, ausschwimmen.'));
      if (phase !== 'wettkampfwoche') sessions.push(S(ws, 5, 'swim-long', 'schwimmen', 'Lange Strecke', vol * 0.4, 'mittel', 'Lange gleichmäßige Strecke, möglichst im Freiwasser oder ohne Pausen.'));
      if (phase !== 'wettkampfwoche') sessions.push(easyRun(ws, 6, 'run-easy', p, 35));
    } else {
      // Triathlon: Schwimmen 20 %, Rad 47 %, Laufen 33 %
      const tri = TRI[g.triDistance ?? 'olympisch'];
      const sw = vol * 0.2, bk = vol * 0.47, rn = vol * 0.33;
      const build = phase === 'aufbau' || phase === 'spitze';
      sessions.push(S(ws, 0, 'swim-tech', 'schwimmen', 'Schwimmen Technik', sw * 0.45, 'locker', 'Technikübungen + ruhige Strecke.'));
      sessions.push(S(ws, 1, 'ride-easy', 'rad', 'Rad locker', bk * 0.25, 'locker', 'Locker, hohe Trittfrequenz.'));
      sessions.push(easyRun(ws, 2, 'run-easy', p, rn * 0.3));
      sessions.push(S(ws, 3, 'ride-q', 'rad', build ? 'Rad-Intervalle' : 'Rad mit Tempowechseln', bk * 0.3, build ? 'hart' : 'mittel', build ? '4–5 × 8 min zügig (≈ Wettkampftempo oder etwas darüber), 4 min locker.' : 'Locker mit 6 × 2 min zügig.'));
      sessions.push(S(ws, 4, 'swim-q', 'schwimmen', 'Schwimmen Intervalle', sw * 0.55, 'hart', `10 × 100 m zügig, 20 s Pause${g.targetTimes?.swim ? ` (Ziel-Pace ${fmtPace(g.targetTimes.swim / 60 / tri.swim / 10)} min/100 m)` : ''}.`));
      if (phase !== 'wettkampfwoche') {
        sessions.push(S(ws, 5, 'ride-long', 'rad', 'Lange Radausfahrt', Math.min(bk * 0.45, 300), 'mittel', 'Lang und gleichmäßig, Wettkampfverpflegung testen.'));
        if (build) sessions.push(S(ws, 5, 'brick', 'lauf', 'Koppellauf (direkt nach dem Rad)', Math.min(10 + rn * 0.15, 30), 'mittel', `Direkt vom Rad in die Laufschuhe, erste Minuten ${pr(p.race ?? p.threshold + 0.1, 0.08)}, dann locker. Wechsel üben.`));
        sessions.push(longRun(ws, 6, 'run-long', p, Math.min(rn * 0.55, tri.run > 20 ? 150 : 80), phase, g, false));
      }
    }

    // Wettkampftag + Tag davor
    if (phase === 'wettkampfwoche' && raceDay >= 0 && raceDay <= 6) {
      for (let i = sessions.length - 1; i >= 0; i--) {
        const d = (Date.parse(sessions[i].date) - Date.parse(ws)) / 86400000;
        if (d === raceDay || d === raceDay - 1 || d > raceDay) sessions.splice(i, 1);
      }
      if (raceDay >= 1) sessions.push(S(ws, raceDay - 1, 'pre', g.sport === 'schwimmen' ? 'schwimmen' : g.sport === 'rad' ? 'rad' : 'lauf', 'Vorbelastung', 20, 'locker',
        'Sehr locker 15–20 min mit 3 kurzen Steigerungen. Früh schlafen, Material und Verpflegung vorbereiten.'));
      sessions.push({ key: `${ws}:race`, date: g.date, origDate: g.date, sport: 'wettkampf', title: `Wettkampf: ${goalLabel(g)}`, minutes: 0, intensity: 'wettkampf',
        details: raceDetails(g, p), status: 'offen', notes: [] });
    }
  }

  let out = applyEvents(sessions, ctx.events, ws);
  out = applyVacation(out, ctx.vacations ?? [], !!g);
  if (ctx.injury) out = applyInjury(out, ctx.injury, ws, ctx.vacations ?? []);
  out = applyEdits(out, ctx.edits);
  const used = new Set<string>();
  out = applyDone(out, ctx.activities, ctx.today, used);
  const inter = applyInteractions(out, ctx, ws, used);
  out = inter.list;
  out.sort((a, b) => a.date.localeCompare(b.date) || order(a) - order(b));
  const minutes = out.filter(s => s.status !== 'ausgelassen').reduce((t, s) => t + s.minutes, 0);
  const runMinutes = out.filter(s => (s.sport === 'lauf' || s.sport === 'trail') && s.status !== 'ausgelassen').reduce((t, s) => t + s.minutes, 0);
  const events = ctx.events.filter(e => e.end >= ws && e.start <= addDays(ws, 6));
  return { weekStart: ws, phase, goal: g, weekNo, totalWeeks: total, sessions: out, events, paces: p, minutes, runMinutes, extra: inter.extra, adjusted: inter.adjusted };
}
const order = (s: PlanSession) => (s.sport === 'kraft' ? 1 : s.key.endsWith('brick') ? 3 : 2);

function raceDetails(g: Goal, p: Paces): string {
  if (g.sport === 'triathlon') {
    const t = g.targetTimes; const tri = TRI[g.triDistance ?? 'olympisch'];
    return `Schwimmen ${tri.swim} km (${t?.swim ? fmtTimeShort(t.swim) : 'Zielzeit egal'}), Rad ${tri.bike} km (${t?.bike ? fmtTimeShort(t.bike) : 'egal'}), Laufen ${tri.run} km (${t?.run ? fmtTimeShort(t.run) : 'egal'}). Ruhig starten, eigenes Tempo.`;
  }
  const target = g.targetTime ? `Ziel ${fmtTimeShort(g.targetTime)}${p.race && (g.sport === 'lauf') ? ` (≈ ${fmtPace(p.race)} min/km)` : ''}` : 'Zielzeit egal – genießen';
  return `${target}. Kontrolliert anlaufen, nicht überpacen. Viel Erfolg!`;
}
const fmtTimeShort = (s: number) => { const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h}:${String(m).padStart(2, '0')} h` : `${m} min`; };

/* ---------- Fixtermine ---------- */
const EVENT_LABEL = { ski: 'Skitag', hochtour: 'Hochtour', urlaub: 'Urlaub', sonstiges: 'Fixtermin' } as const;
// Hinweis: Urlaub ist seit v9 ein eigener Modus (applyVacation), Typ 'urlaub' bei Fixterminen nur noch für alte Daten.
function applyEvents(list: PlanSession[], events: FixedEvent[], ws: string): PlanSession[] {
  const out: PlanSession[] = [];
  for (const s of list) {
    const ev = events.find(e => s.date >= e.start && s.date <= e.end);
    if (ev) continue;                                            // an Fixtermin-Tagen nichts planen
    const tomorrow = events.find(e => (e.type === 'ski' || e.type === 'hochtour') && e.start === addDays(s.date, 1));
    if (tomorrow && s.sport === 'kraft' && s.groups && hasLegs(s.groups)) {
      const k = kraft(ws, (Date.parse(s.date) - Date.parse(ws)) / 86400000, s.key.split(':')[1], s.groups, false, true);
      k.notes = [`Weniger Beinvolumen: morgen ${EVENT_LABEL[tomorrow.type]}.`]; out.push(k); continue;
    }
    if (tomorrow && s.intensity === 'hart') { out.push({ ...s, intensity: 'locker', title: s.title + ' (locker)', notes: [...s.notes, `Morgen ${EVENT_LABEL[tomorrow.type]} – heute nur locker.`] }); continue; }
    out.push(s);
  }
  return out;
}

/* ---------- Urlaub ---------- */
function applyVacation(list: PlanSession[], vacations: Vacation[], goalMode: boolean): PlanSession[] {
  const out: PlanSession[] = [];
  for (const s of list) {
    const v = vacations.find(x => s.date >= x.start && s.date <= x.end);
    if (!v || s.sport === 'wettkampf') { out.push(s); continue; }
    if (s.sport === 'kraft') continue;                                   // kein Studio im Urlaub – trägst du selbst ein, falls doch
    const mode = v.training === 'keine' && goalMode ? 'weniger' : v.training;
    if (mode === 'keine') continue;
    if (mode === 'weniger') {
      out.push({ ...s, minutes: r5(s.minutes * 0.6), intensity: s.intensity === 'hart' ? 'mittel' : s.intensity,
        details: s.intensity === 'hart' ? 'Urlaubsversion: locker mit ein paar zügigen Abschnitten nach Lust und Gelände.' : s.details,
        notes: [...s.notes, 'Urlaub: reduziert.'] });
      continue;
    }
    out.push({ ...s, notes: [...s.notes, 'Urlaub.'] });
  }
  return out;
}

/* ---------- Verletzung ---------- */
const ENDURANCE_MOVE: Partial<Record<PlanSport, Movement>> = { lauf: 'laufen', trail: 'laufen', rad: 'rad', schwimmen: 'schwimmen', gehen: 'gehen' };
function alternativeSport(inj: Injury, not: Movement): { sport: PlanSport; label: string } | null {
  for (const [m, sport, label] of [['rad', 'rad', 'Rad'], ['schwimmen', 'schwimmen', 'Schwimmen'], ['gehen', 'gehen', 'Gehen/Wandern']] as [Movement, PlanSport, string][])
    if (m !== not && inj.movement[m] === 'geht') return { sport, label };
  return null;
}
/** Minuten-Faktor, damit eine Ersatzsportart ungefähr dieselbe Belastung bringt wie Laufen. */
const EQUIV: Partial<Record<PlanSport, number>> = { rad: 1.3, schwimmen: 1.0, gehen: 1.5 };
function altDetails(sport: PlanSport, intensity: Intensity, orig: string): string {
  const base = `Ersatz für ${orig}`;
  if (sport === 'rad') return intensity === 'hart' ? `${base}: 15 min einfahren, 4–5 × 6 min zügig (schwer atmend, aber kontrolliert), 3 min locker, ausfahren.`
    : intensity === 'mittel' ? `${base}: gleichmäßig, darin 3 × 10 min zügig.` : `${base}: locker und gleichmäßig, hohe Trittfrequenz.`;
  if (sport === 'schwimmen') return intensity === 'hart' ? `${base}: einschwimmen, 10 × 100 m zügig mit 20 s Pause, ausschwimmen.`
    : `${base}: ruhig und gleichmäßig, Technik sauber halten.`;
  return `${base}: zügig gehen/wandern, gern bergauf.`;
}
export function applyInjury(list: PlanSession[], inj: Injury, ws?: string, vacations: Vacation[] = []): PlanSession[] {
  const outage = isOutage(inj);
  const stage = inj.stage;
  const label = outage ? 'Ernste Verletzung' : `Verletzung, Stufe „${STAGES[stage].label}“`;
  if (!outage && stage === 0) return [];                                       // Pause: nichts planen
  const factor = outage ? 1 : STAGE_VOLUME[stage];
  const out: PlanSession[] = [];
  let blocked = 0;   // Einheiten, die wegen der Verletzung ersetzt werden mussten oder weggefallen sind
  for (const s of list) {
    if (s.sport === 'wettkampf') { out.push({ ...s, notes: [...s.notes, `${label} – prüfe, ob der Wettkampf machbar ist.`] }); continue; }
    if (s.sport === 'kraft') {
      let gs = (s.groups ?? []).flatMap(g => (g === 'ganzkoerper' ? ['push', 'pull', 'beine', 'rumpf'] as MuscleGroup[] : [g]));
      if (inj.movement.beinkraft === 'nicht') gs = gs.filter(g => g !== 'beine');
      if (inj.movement.oberkoerper === 'nicht') gs = gs.filter(g => g !== 'push' && g !== 'pull');
      if (!gs.length) { blocked++; continue; }
      const limited = (gs.includes('beine') && inj.movement.beinkraft === 'eingeschraenkt') || ((gs.includes('push') || gs.includes('pull')) && inj.movement.oberkoerper === 'eingeschraenkt');
      out.push({ ...s, groups: gs, title: `Kraft · ${gs.map(groupLabel).join(' + ')}`, intensity: limited ? 'locker' : s.intensity,
        notes: [...s.notes, `${label}: nur erlaubte Muskelgruppen${limited ? ', vorsichtig und leicht' : ''}.`] });
      continue;
    }
    const mv = ENDURANCE_MOVE[s.sport]!;
    const st = inj.movement[mv];
    const notMoves = s.sport === 'trail' && (inj.movement.bergab === 'nicht' || inj.movement.springen === 'nicht');
    // Laufen mit Gehpausen (Stufe 3) bzw. reduziert ab Stufe 4
    if ((s.sport === 'lauf' || s.sport === 'trail') && !outage && st !== 'nicht') {
      if (stage === 1) { /* nur Alternativtraining → unten ersetzen */ }
      else if (stage === 2) { out.push({ ...s, sport: 'lauf', title: 'Laufen mit Gehpausen', intensity: 'locker', minutes: r5(Math.min(s.minutes, 35) * 0.8),
        details: '1–2 min sehr locker laufen, 1–2 min gehen, im Wechsel. Flach, schmerzfrei. Bei Schmerz abbrechen.', notes: [`${label}.`] }); continue; }
      else {
        const hardOk = stage >= 5;
        out.push({ ...s, minutes: r5(s.minutes * factor), intensity: hardOk ? s.intensity : 'locker', title: hardOk ? s.title : s.intensity === 'hart' ? 'Lockerer Lauf' : s.title,
          details: hardOk ? s.details : 'Locker und flach. Umfang reduziert. Bei Schmerz abbrechen.', notes: [`${label}: Umfang ${Math.round(factor * 100)} %.`] });
        continue;
      }
    }
    // Nicht betroffene Sportart (z. B. Rad bei Schulterverletzung): bleibt voll – hilft, fit zu bleiben
    if (st === 'geht' && !notMoves && (outage || stage >= 2 || s.sport !== 'lauf')) { out.push({ ...s, notes: [...s.notes, `${label}: nicht betroffen, bleibt voll.`] }); continue; }
    if (st === 'eingeschraenkt' && !notMoves) { out.push({ ...s, intensity: 'locker', minutes: r5(s.minutes * 0.7), title: s.title + ' (locker)', details: 'Nur locker und kürzer. Bei Schmerz abbrechen.', notes: [`${label}: eingeschränkt.`] }); continue; }
    const alt = alternativeSport(inj, mv);
    blocked++;
    if (!alt) continue;
    // Ersatz mit vergleichbarer Belastung: längere Dauer je nach Sportart, Intensität bleibt (Gehen höchstens mittel)
    const intensity: Intensity = alt.sport === 'gehen' && s.intensity === 'hart' ? 'mittel' : s.intensity;
    out.push({ ...s, sport: alt.sport, title: `${alt.label} statt ${s.title}`, intensity, minutes: r5(Math.min(s.minutes * (EQUIV[alt.sport] ?? 1), 240)),
      details: altDetails(alt.sport, intensity, s.title), notes: [`${label}: ${MOVEMENTS.find(m => m.id === mv)?.label} geht nicht – gleichwertiger Ersatz.`] });
  }
  // Ausgleich: eine zusätzliche Einheit in einer erlaubten Sportart an einem freien Tag (nicht im Urlaub)
  if (blocked > 0 && ws) {
    const free = [6, 3, 1, 4, 5, 2, 0].map(i => addDays(ws, i))
      .find(d => !out.some(x => x.date === d) && !list.some(x => x.date === d && x.sport === 'wettkampf') && !vacations.some(v => d >= v.start && d <= v.end));
    if (free) {
      const day = (Date.parse(free) - Date.parse(ws)) / 86400000;
      const endu = (['rad', 'schwimmen', 'gehen'] as const).find(sp => inj.movement[sp === 'gehen' ? 'gehen' : sp] === 'geht');
      if (endu) {
        const sport: PlanSport = endu, mins = endu === 'rad' ? 75 : endu === 'schwimmen' ? 45 : 90;
        out.push({ ...S(ws, day, 'ausgleich', sport, `Ausgleich: ${endu === 'rad' ? 'Rad' : endu === 'schwimmen' ? 'Schwimmen' : 'Wandern'} Grundlage`, mins, 'mittel',
          'Gleichmäßig im Grundlagenbereich, die letzten 15 min etwas zügiger. Hält deine Ausdauer, während die Verletzung andere Einheiten blockiert.'),
          notes: [`${label}: zusätzliche Ausgleichseinheit.`] });
      } else {
        const gs: MuscleGroup[] = inj.movement.oberkoerper !== 'nicht' ? ['push', 'pull', 'rumpf'] : inj.movement.beinkraft !== 'nicht' ? ['beine', 'rumpf'] : [];
        if (gs.length) out.push({ ...kraft(ws, day, 'ausgleich', gs, false, false), title: `Ausgleich Kraft · ${gs.map(groupLabel).join(' + ')}`,
          notes: [`${label}: zusätzliche Krafteinheit für die freien Muskelgruppen.`] });
      }
    }
  }
  return out;
}

/* ---------- Eigene Änderungen + erledigte Einheiten ---------- */
function applyEdits(list: PlanSession[], edits: Map<string, PlanEdit>): PlanSession[] {
  return list.map(s => {
    const e = edits.get(s.key); if (!e) return s;
    return { ...s, date: e.movedTo ?? s.date, moved: !!e.movedTo && e.movedTo !== s.origDate, status: e.status ?? s.status };
  });
}
const FAMILY: Record<PlanSport, RegExp> = { kraft: /Weight|Workout/, lauf: /Run/, trail: /Run/, rad: /Ride/, schwimmen: /Swim/, gehen: /Hike|Walk/, wettkampf: /./ };
function applyDone(list: PlanSession[], acts: Activity[], today: string, used: Set<string>): PlanSession[] {
  return list.map(s => {
    if (s.status === 'ausgelassen' || s.date > today) return s;
    const a = acts.find(x => x.date === s.date && !used.has(x.id) && FAMILY[s.sport].test(x.sportType));
    if (!a) return s;
    if (s.status === 'erledigt') { used.add(a.id); return { ...s, activityId: a.id }; }
    used.add(a.id);
    return { ...s, status: 'erledigt', autoDone: true, activityId: a.id };
  });
}

/* ---------- Wechselwirkung mit außerplanmäßigem Training ---------- */
/**
 * Alles, was du zusätzlich machst (lange Radtour, Wanderung, Skitag …), wird mit eingerechnet:
 * 1) 48-h-Regel: Nach hoher Belastung (≥ 120 TRIMP oder ≥ 2 h) werden harte/lange Einheiten am Folgetag locker und kürzer,
 *    nach beinlastigem Sport kein schweres Beintraining. Sehr hohe Belastung (≥ 200) wirkt zwei Tage.
 * 2) Wochenbudget: Außerplanmäßige Belastung wird von den restlichen Einheiten der Woche abgezogen
 *    (andere Sportarten zählen 70 %, weil sie die Laufmuskulatur weniger beanspruchen).
 *    Zuerst werden lockere Einheiten gekürzt/gestrichen, lange und harte Einheiten höchstens um 30 %.
 * 3) Belastungssprung (7-Tage- zu 42-Tage-Belastung > 1,4): restliche harte Einheiten der Woche werden entschärft.
 */
const HIGH_LOAD = 120, VERY_HIGH = 200;
const LEG_HEAVY = /Ride|Run|Hike|Walk|Ski|Snowboard|Climb|Rowing|Snowshoe/;
const LOAD_PER_MIN: Record<Intensity, number> = { locker: 1.0, mittel: 1.5, hart: 2.0, wettkampf: 2.0 };
const fmtDur = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')}` : `${Math.round(m)} min`);
const endurance = (s: PlanSession) => s.sport !== 'kraft' && s.sport !== 'wettkampf';

function applyInteractions(list: PlanSession[], ctx: PlanContext, ws: string, used: Set<string>) {
  const t = ctx.today;
  const hr = ctx.hr ?? { max: 190, rest: 60, maxSource: 'default', restSource: 'default' } as HrProfile;
  const load = (a: Activity) => activityLoad(a, hr).load;
  let out = list.map(s => ({ ...s, notes: [...s.notes] }));
  const extra: { text: string; load: number }[] = [];
  let adjusted = false;
  const open = (s: PlanSession) => s.status === 'offen' && s.date >= t;

  // 1) 48-h-Regel (für heute und morgen)
  for (const s of out) {
    if (!open(s) || s.date > addDays(t, 1)) continue;
    const prev = ctx.activities.filter(a => (a.date === addDays(s.date, -1) && load(a) >= HIGH_LOAD) || (a.date === addDays(s.date, -2) && load(a) >= VERY_HIGH)
      || (a.date === addDays(s.date, -1) && (a.duration ?? 0) >= 7200));
    if (!prev.length) continue;
    const a = prev.sort((x, y) => load(y) - load(x))[0];
    const why = `${a.date === addDays(s.date, -1) ? 'Gestern' : 'Vorgestern'} ${sportName(a.sportType)} ${fmtDur((a.duration ?? a.elapsed ?? 0) / 60)} (Belastung ${Math.round(load(a))})`;
    if (endurance(s) && s.intensity !== 'locker') {
      Object.assign(s, { intensity: 'locker', minutes: r5(s.minutes * 0.7), title: s.title.replace(/ \(locker\)$/, '') + ' (locker)' });
      s.notes.push(`${why}: heute nur locker und kürzer.`); adjusted = true;
    } else if (s.sport === 'kraft' && s.groups && s.groups.includes('beine') && prev.some(x => LEG_HEAVY.test(x.sportType))) {
      s.groups = s.groups.filter(g => g !== 'beine'); if (!s.groups.length) s.groups = ['rumpf'];
      s.title = `Kraft · ${s.groups.map(groupLabel).join(' + ')}`;
      s.notes.push(`${why}: Beine heute auslassen.`); adjusted = true;
    }
  }

  // 2) Wochenbudget – nur für die laufende Woche
  if (ws === weekStart(t)) {
    const unplanned = ctx.activities.filter(a => a.date >= ws && a.date <= t && !used.has(a.id) && !/Weight|Workout|Yoga/.test(a.sportType));
    const plannedLoad = out.filter(endurance).reduce((sum, s) => sum + s.minutes * LOAD_PER_MIN[s.intensity], 0);
    let budget = 0;
    for (const a of unplanned) {
      const l = load(a); if (l < 25) continue;
      const w = /Run/.test(a.sportType) ? 1 : 0.7;
      budget += l * w;
      extra.push({ text: `${sportName(a.sportType)} ${fmtDur((a.duration ?? a.elapsed ?? 0) / 60)}`, load: Math.round(l) });
    }
    if (plannedLoad > 0 && budget / plannedLoad >= 0.1) {
      const note = `Angepasst: außerplanmäßig ${extra.map(e => e.text).join(', ')} diese Woche.`;
      const candidates = out.filter(s => open(s) && endurance(s))
        .sort((x, y) => ['locker', 'mittel', 'hart', 'wettkampf'].indexOf(x.intensity) - ['locker', 'mittel', 'hart', 'wettkampf'].indexOf(y.intensity) || x.minutes - y.minutes);
      for (const s of candidates) {
        if (budget <= 0) break;
        const perMin = LOAD_PER_MIN[s.intensity];
        const sLoad = s.minutes * perMin;
        if (s.intensity === 'locker' && !s.key.endsWith('run-long') && budget >= sLoad * 0.7) {
          s.status = 'ausgelassen'; s.notes.push(note + ' Diese Einheit entfällt.'); budget -= sLoad; adjusted = true; continue;
        }
        const maxCut = s.intensity === 'locker' && !s.key.endsWith('long') ? 0.5 : 0.3;
        const cutMin = Math.min(s.minutes * maxCut, budget / perMin);
        if (cutMin < 5) continue;
        s.minutes = r5(s.minutes - cutMin); s.notes.push(note + ` Um ${Math.round(cutMin / 5) * 5} min gekürzt.`);
        budget -= cutMin * perMin; adjusted = true;
      }
    }
  }

  // 3) Belastungssprung
  if (ws === weekStart(t)) {
    const series = loadSeries(ctx.activities, hr, t);
    const last = series.at(-1);
    if (last && last.ctl > 15 && last.atl / last.ctl > 1.4) {
      for (const s of out) if (open(s) && endurance(s) && s.intensity === 'hart') {
        s.intensity = 'mittel'; s.title += ' (entschärft)';
        s.notes.push(`Belastungssprung (Verhältnis ${(last.atl / last.ctl).toFixed(1).replace('.', ',')}): harte Abschnitte kürzer und etwas langsamer.`); adjusted = true;
      }
    }
  }
  return { list: out, extra, adjusted };
}

/** Anpassung der heutigen Einheiten an die Tagesampel. */
export function adaptToLight(s: PlanSession, light: 'gruen' | 'gelb' | 'rot' | 'grau'): PlanSession {
  if (s.status !== 'offen' || s.sport === 'wettkampf') return s;
  if (light === 'gelb' && (s.intensity === 'hart' || s.intensity === 'mittel'))
    return { ...s, intensity: 'locker', minutes: r5(s.minutes * 0.75), notes: [...s.notes, 'Ampel gelb: heute locker und etwa ¼ kürzer.'] };
  if (light === 'rot') return { ...s, notes: [...s.notes, 'Ampel rot: besser Ruhetag oder nur 20–30 min sehr locker.'] };
  return s;
}

export const todayIso = todayFn;
