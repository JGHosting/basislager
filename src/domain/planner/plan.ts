/**
 * Trainingsplaner.
 *
 * Standardwoche (ohne Wettkampf): Kraft nach deinem Split (0–6×) + deine Ausdauer-Sportarten (je 0–5×, Grundlage oder Leistung).
 *   Umfang je Sportart = Schnitt deiner letzten 4 Wochen + 8 %, für jede weitere Woche +5 %,
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
import { TRI, goalLabel, fmtPace, raceLegs, plannedSessions, ambitious, type RaceLeg } from './goals';
import { estimatePaces, type Paces } from './paces';
import type { CurveCache } from './besttimes';
import { activityLoad, loadSeries, type HrProfile } from '../load/load';
import { sportName } from '../../ui/format';
import { VACATION_LEG, vacationSportLabel } from '../vacation/vacation';
import { normalizeSports, rolesFor, ROLE_WEIGHT, MAX_PER_WEEK, type EnduranceSport, type SportConfig, type SportsSetting, type Role } from './sports';
import { resolveWarmup, type WarmupMode, type WarmupSettings, DEFAULT_WARMUP_SETTINGS } from './warmup';

export type PlanSport = 'kraft' | 'lauf' | 'trail' | 'rad' | 'schwimmen' | 'gehen' | 'wettkampf';
export type Intensity = 'locker' | 'mittel' | 'hart' | 'wettkampf';
export interface PlanSession {
  key: string; date: string; origDate: string; sport: PlanSport; title: string; minutes: number;
  intensity: Intensity; details: string; groups?: MuscleGroup[]; elevation?: number;
  status: 'offen' | 'erledigt' | 'ausgelassen'; autoDone?: boolean; moved?: boolean; notes: string[];
  activityId?: string;   // passende Garmin-Aktivität (bei automatisch erledigt)
  /** Aufwärmen vor dieser Einheit, passend ausgewählt (siehe domain/planner/warmup.ts). Null = keins geplant. */
  warmup?: { minutes: number; items: string[] } | null;
  /** Override der Aufwärm-Einstellung nur für diese Einheit (sonst Kategorie-Standard aus warmupSettings). */
  warmupMode?: WarmupMode;
  /** Nur Wettkampf: Abschnitte mit geschätzter Dauer (für die Verpflegung; zählt nicht in Wochensummen). */
  race?: { legs: RaceLeg[]; estimated: boolean };
  /** Ausgefallen durch dich (manuell) oder verpasst – zählt für den Ausgleich im Wettkampfplan. */
  skipped?: 'manuell' | 'verpasst';
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
  /** Wettkampfplan: nicht ausgeglichene Minuten je Sportart (werden in der Folgewoche teilweise nachgeholt). */
  carry?: Partial<Record<'lauf' | 'rad' | 'schwimmen', number>>;
}
export interface PlanContext {
  today: string; activities: Activity[]; strength: StrengthSession[]; split: SplitTemplate | null;
  goal: Goal | null; injury: Injury | null; events: FixedEvent[]; edits: Map<string, PlanEdit>;
  /** Alt: Läufe pro Woche (nur noch Fallback, falls 'sports' fehlt). */
  runsPerWeek: 2 | 3; vacations: Vacation[];
  /** Ausdauer-Sportarten mit Häufigkeit und Ziel (Mehr → Sportarten). */
  sports?: SportsSetting;
  /** Physio-Aktivitäten: zählen weder als Krafttraining noch als außerplanmäßige Belastung. */
  physio?: Set<string>;
  /** Krafteinheiten pro Woche (1–6, Standard 3). */
  strengthPerWeek?: number;
  hr?: HrProfile;
  /** Pace-Kurven von intervals.icu (für die aktuelle Laufform). */
  curves?: CurveCache | null;
  /** Aufwärm-Standard je Kategorie (Mehr → Training → Aufwärmen). */
  warmupSettings?: WarmupSettings;
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
export const kraftCount = (ctx: PlanContext) => Math.max(0, Math.min(6, Math.round(ctx.strengthPerWeek ?? 3)));
/** Krafttage je Anzahl (0 = Montag). Samstag (langer Lauf) bleibt immer frei. */
export const KRAFT_DAYS: Record<number, number[]> = { 0: [], 1: [0], 2: [0, 3], 3: [0, 2, 4], 4: [0, 2, 4, 6], 5: [0, 1, 2, 4, 6], 6: [0, 1, 2, 3, 4, 6] };
/** Kein schweres Beintraining am Tag vor dem langen Lauf (Fr) und am Tag danach (So). */
const noLegDay = (d: number) => d === 4 || d === 6;
/**
 * Verteilt die Split-Tage auf die Krafttage: Beintage möglichst mit mindestens einem Tag Abstand
 * und nicht vor/nach dem langen Lauf. Was nicht passt, wird ohne schweres Beintraining geplant.
 */
function assignKraft(days: number[], groups: MuscleGroup[][], fixedLegDays: number[] = []): { day: number; groups: MuscleGroup[]; noLegs: boolean }[] {
  const legs = groups.filter(hasLegs), other = groups.filter(g => !hasLegs(g));
  const legDays: number[] = [];
  for (const d of days) if (!noLegDay(d) && legDays.length < legs.length && [...fixedLegDays, ...legDays].every(x => Math.abs(x - d) >= 2)) legDays.push(d);
  const rest = days.filter(d => !legDays.includes(d));
  const queue = [...other, ...legs.slice(legDays.length)];
  const out = [...legDays.map((day, i) => ({ day, groups: legs[i], noLegs: false })),
    ...rest.map((day, i) => ({ day, groups: queue[i], noLegs: true }))];
  return out.sort((a, b) => a.day - b.day);
}
function strengthGroups(ctx: PlanContext, ws: string, count: number): MuscleGroup[][] {
  const thisWeekOffset = Math.max(0, Math.round((Date.parse(ws) - Date.parse(weekStart(ctx.today))) / 604800000));
  if (!ctx.split) return Array.from({ length: count }, () => ['ganzkoerper']);
  let start: number;
  if (thisWeekOffset === 0) {
    start = nextSplitDay(ctx.split, ctx.strength.filter(s => s.date < weekStart(ctx.today))).index;
  } else {
    // Zukünftige Wochen: ab der zuletzt tatsächlich trainierten Einheit + noch offene Krafttage dieser Woche
    const t = ctx.today;
    const remaining = openStrengthThisWeek(ctx);
    start = nextSplitDay(ctx.split, ctx.strength.filter(x => x.date <= t)).index + remaining + (thisWeekOffset - 1) * kraftCount(ctx);
  }
  return Array.from({ length: count }, (_, i) => [...ctx.split!.days[(start + i) % ctx.split!.days.length]]);
}
/** Noch offene Krafteinheiten der laufenden Woche (nach Verschieben, Auslassen, Erledigt) – daran schließt die nächste Woche an. */
const openCache = new WeakMap<PlanContext, number>();
function openStrengthThisWeek(ctx: PlanContext): number {
  const hit = openCache.get(ctx); if (hit != null) return hit;
  const cur = buildWeek(weekStart(ctx.today), ctx);
  const n = cur.sessions.filter(s => s.sport === 'kraft' && s.status === 'offen' && s.date >= ctx.today).length;
  openCache.set(ctx, n);
  return n;
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
    return S(ws, day, slot, sport, 'Fahrtspiel', m, 'mittel', `Locker in ${z2}, darin 6–8 × 1 min zügig nach Gefühl (≈ ${fmtPace(p.threshold)} min/km) mit 2 min locker. Zum Schluss 4 Steigerungen.`);
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
const z2 = 'Zone 2 (60–70 % vom Maximalpuls)';
const easyRun = (ws: string, day: number, slot: string, p: Paces, min: number, trail = false) =>
  S(ws, day, slot, trail ? 'trail' : 'lauf', 'Lockerer Lauf', min, 'locker', `Ruhig im Gesprächstempo in ${z2} – nach Puls, nicht nach Pace.${trail ? ' Gern auf Trails/Wegen.' : ''}`);
function longRun(ws: string, day: number, slot: string, p: Paces, min: number, phase: Phase, g: Goal | null, trail: boolean, hm?: number) {
  let details = `Lang und ruhig in ${z2} – nach Puls, nicht nach Pace. Verpflegung/Trinken testen.`;
  if (phase === 'spitze' && p.race && g?.sport === 'lauf' && (g.distanceKm ?? 0) > 20) details = `Lang, letzte 30–40 min im Wettkampftempo ${pr(p.race, 0.05)}. Wettkampfverpflegung testen.`;
  if (trail) details = `Lang auf Trails mit ca. ${hm ?? 0} hm, Tempo nach Gefühl (bergauf gehen ist okay). Bergab locker und kontrolliert.`;
  return S(ws, day, slot, trail ? 'trail' : 'lauf', trail ? 'Langer Trailrun' : 'Langer Lauf', min, 'mittel', details, trail ? hm : undefined);
}

/* ---------- Ausdauer nach Sportarten ---------- */
export const sportsOf = (ctx: PlanContext) => normalizeSports(ctx.sports, ctx.runsPerWeek);
const FAMILY_RE: Record<EnduranceSport, RegExp> = { lauf: /Run/, rad: /Ride/, schwimmen: /Swim/ };
const KEY_PREFIX: Record<EnduranceSport, string> = { lauf: 'run', rad: 'ride', schwimmen: 'swim' };
/** Mindestumfang (min/Woche) bei wenig Verlauf; Laufen wie bisher ≥ 90 min. */
const FLOOR_PER: Record<EnduranceSport, number> = { lauf: 30, rad: 45, schwimmen: 30 };
const LONG_CAP: Record<EnduranceSport, number> = { lauf: 150, rad: 300, schwimmen: 90 };
/** Für die Verteilung „hart“: harte Intensität, Qualitätseinheit oder lange Einheit, die nicht nur locker ist. */
const isHardOrLong = (s: PlanSession) => s.sport !== 'kraft' && (s.intensity === 'hart' || s.intensity === 'wettkampf' || /(-q\d*|race)$/.test(s.key) || (/long\d*$/.test(s.key) && s.intensity !== 'locker'));

function enduranceSession(ws: string, sport: EnduranceSport, role: Role, mode: SportConfig['mode'], key: string, min: number, phase: Phase, p: Paces, wk: number): PlanSession {
  const base = mode === 'grundlage';
  if (sport === 'lauf') {
    if (role === 'long') return base ? S(ws, 0, key, 'lauf', 'Langer Lauf', Math.min(min, LONG_CAP.lauf), 'locker', `Lang und ruhig in ${z2} – nach Puls, nicht nach Pace. Trinken/Verpflegung testen.`)
      : longRun(ws, 0, key, p, Math.min(min, LONG_CAP.lauf), phase, null, false);
    if (role === 'easy') return base ? S(ws, 0, key, 'lauf', 'Grundlagenlauf', min, 'locker', `Ruhig im Gesprächstempo in ${z2} – nach Puls, nicht nach Pace.`) : easyRun(ws, 0, key, p, min);
    // Leistung: in der Standardwoche wechseln Intervalle, Schwelle und Tempodauerlauf, Erholungswoche bleibt Fahrtspiel
    return runQuality(ws, 0, key, phase === 'basis' ? 'aufbau' : phase, wk + (role === 'q2' ? 1 : 0), p, min, null, false);
  }
  if (sport === 'rad') {
    if (role === 'long') return base ? S(ws, 0, key, 'rad', 'Lange Grundlagenausfahrt', Math.min(min, LONG_CAP.rad), 'locker', `Lang und gleichmäßig in ${z2}, hohe Trittfrequenz (85–95). Essen und trinken nicht vergessen.`)
      : S(ws, 0, key, 'rad', 'Lange Ausfahrt', Math.min(min, LONG_CAP.rad), 'mittel', 'Lang und gleichmäßig, die letzte halbe Stunde gern etwas zügiger. Essen und trinken nicht vergessen.');
    if (role === 'easy') return base ? S(ws, 0, key, 'rad', 'Grundlagenausfahrt', min, 'locker', `Gleichmäßig in ${z2}, hohe Trittfrequenz (85–95).`)
      : S(ws, 0, key, 'rad', 'Lockere Ausfahrt', min, 'locker', 'Gleichmäßig locker, hohe Trittfrequenz (85–95).');
    if (role === 'q2' || phase === 'erholung' || phase === 'urlaub')
      return S(ws, 0, key, 'rad', 'Ausfahrt mit Tempowechseln', min, 'mittel', 'Locker, darin 6 × 2 min zügig mit 3 min locker.');
    return wk % 2 === 0
      ? S(ws, 0, key, 'rad', 'Rad-Intervalle', min, 'hart', '20 min einfahren, 4–5 × 8 min zügig (Schwelle), 4 min locker, ausfahren.')
      : S(ws, 0, key, 'rad', 'Sweet-Spot-Ausfahrt', min, 'hart', '15 min einfahren, 2–3 × 12 min knapp unter der Schwelle, 5 min locker, ausfahren.');
  }
  if (role === 'long') return S(ws, 0, key, 'schwimmen', 'Lange Strecke', Math.min(min, LONG_CAP.schwimmen), base ? 'locker' : 'mittel', base ? 'Lange, ruhige Strecke ohne Pausen, Technik sauber halten.' : 'Lange gleichmäßige Strecke, möglichst ohne Pausen.');
  if (role === 'easy') return S(ws, 0, key, 'schwimmen', 'Technik & Grundlage', min, 'locker', 'Einschwimmen, Technikübungen (z. B. Abschlag, Züge zählen), dann ruhig durchschwimmen.');
  if (role === 'q2' || phase === 'erholung' || phase === 'urlaub') return S(ws, 0, key, 'schwimmen', 'Schwimmen Tempo', min, 'mittel', 'Einschwimmen, 4 × 400 m zügig-gleichmäßig, 1 min Pause, ausschwimmen.');
  return S(ws, 0, key, 'schwimmen', 'Intervalle', min, 'hart', 'Einschwimmen, 10–12 × 100 m zügig, 20 s Pause, ausschwimmen.');
}

/**
 * Erzeugt die Ausdauer-Einheiten der gewählten Sportarten und verteilt sie auf die Woche:
 * 1) lange Einheiten (Hauptsportart Samstag, weitere Sonntag), 2) Qualität mit einem Tag Abstand zu harten/langen Einheiten,
 * 3) lockere Einheiten dorthin, wo noch am wenigsten los ist (möglichst nicht zwei Ausdauereinheiten an einem Tag).
 */
function enduranceWeek(ws: string, ctx: PlanContext, phase: Phase, p: Paces, existing: PlanSession[], configs: SportConfig[],
  o: { main: EnduranceSport | null; factor: number; ramp: number; demote: boolean; max: number }): PlanSession[] {
  const items: { s: PlanSession; role: Role; main: boolean }[] = [];
  const sorted = [...configs].sort((a, b) => Number(b.sport === o.main) - Number(a.sport === o.main));
  for (const c of sorted) {
    let roles = rolesFor(c);
    if (o.demote) roles = roles.map(r => (r === 'q' || r === 'q2' ? 'easy' : r));
    if (roles.length > o.max) roles = Array<Role>(o.max).fill('easy');
    if (!roles.length) continue;
    const recent = Math.max(FLOOR_PER[c.sport] * Math.max(roles.length, c.sport === 'lauf' ? 3 : 2), recentMinutes(ctx.activities, weekStart(ctx.today), FAMILY_RE[c.sport]));
    const vol = Math.min(recent * o.ramp, recent * 1.5) * o.factor;
    const wsum = roles.reduce((t, r) => t + ROLE_WEIGHT[r], 0);
    const seen: Record<string, number> = {};
    for (const r of roles) {
      const base = r === 'q2' ? 'q2' : r;
      seen[base] = (seen[base] ?? 0) + 1;
      const key = `${KEY_PREFIX[c.sport]}-${base}${seen[base] > 1 ? seen[base] : ''}`;
      items.push({ s: enduranceSession(ws, c.sport, r, c.mode, key, vol * ROLE_WEIGHT[r] / wsum, phase, p, isoWeek(ws)), role: r, main: c.sport === o.main });
    }
  }
  const placed: PlanSession[] = [];
  const all = () => [...existing, ...placed];
  const on = (d: number) => all().filter(s => s.date === DAY(ws, d));
  const blocked = (d: number) => on(d).some(s => s.sport === 'wettkampf') || existing.some(s => s.sport === 'wettkampf' && s.date < DAY(ws, d));
  const hardNear = (d: number) => [d - 1, d, d + 1].some(x => x >= 0 && x <= 6 && on(x).some(isHardOrLong));
  const put = (it: { s: PlanSession }, d: number) => placed.push({ ...it.s, date: DAY(ws, d), origDate: DAY(ws, d) });
  const free = (prefs: number[], ok: (d: number) => boolean) => prefs.find(d => !blocked(d) && ok(d));
  // 1) lange Einheiten
  for (const it of items.filter(i => i.role === 'long')) {
    const prefs = it.main ? [5, 6, 4, 2] : [6, 5, 2, 4];
    const d = free(prefs, x => !on(x).some(isHardOrLong)) ?? free(prefs, () => true);
    if (d != null) put(it, d);
  }
  // 2) Qualität (Hauptsportart zuerst)
  for (const it of items.filter(i => i.role === 'q' || i.role === 'q2').sort((a, b) => Number(b.main) - Number(a.main))) {
    const prefs = it.main ? [3, 1, 2, 0, 4, 6, 5] : [1, 3, 2, 0, 4, 6, 5];
    const room = (x: number) => !on(x).some(y => y.sport === it.s.sport) && on(x).filter(y => y.sport !== 'kraft').length < 2;
    const d = free(prefs, x => room(x) && !hardNear(x)) ?? free(prefs, x => room(x) && !on(x).some(isHardOrLong)) ?? free(prefs, room) ?? free(prefs, () => true);
    if (d != null) put(it, d);
  }
  // 3) lockere Einheiten
  const easyPrefs = [1, 3, 2, 4, 6, 0, 5];
  for (const it of items.filter(i => i.role === 'easy')) {
    const score = (d: number) => {
      const day = on(d), endu = day.filter(x => x.sport !== 'kraft');
      return endu.length * 10 + (endu.some(x => x.sport === it.s.sport) ? 20 : 0) + (day.some(isHardOrLong) ? 6 : 0) + (day.some(x => x.sport === 'kraft') ? 3 : 0) + easyPrefs.indexOf(d) * 0.1;
    };
    const d = easyPrefs.filter(x => !blocked(x)).sort((a, b) => score(a) - score(b))[0];
    if (d != null) put(it, d);
  }
  return placed;
}

/* ---------- Woche erzeugen ---------- */
export function buildWeek(ws: string, ctx: PlanContext): PlanWeek {
  const g = ctx.goal && !ctx.goal.archived && ws >= weekStart(ctx.goal.planStart) && ws <= weekStart(ctx.goal.date) ? ctx.goal : null;
  const p = estimatePaces(ctx.activities, ctx.goal && !ctx.goal.archived ? ctx.goal : null, ctx.today, { ws, curves: ctx.curves, hrMax: ctx.hr?.max });
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
    const kDays = KRAFT_DAYS[kraftCount(ctx)];
    const kg = strengthGroups(ctx, ws, kDays.length);
    assignKraft(kDays, kg).forEach((k, i) => sessions.push(kraft(ws, k.day, `kraft${i + 1}`, k.groups, false, k.noLegs)));
    // Ausdauer nach deinen Sportarten (Mehr → Sportarten): Umfang je Sportart wächst langsam mit dir mit
    sessions.push(...enduranceWeek(ws, ctx, phase, p, sessions, sportsOf(ctx).list.filter(c => c.perWeek > 0), {
      main: sportsOf(ctx).main, factor: recovery ? 0.75 : 1, ramp: 1.08 * Math.pow(1.05, ahead), demote: false, max: MAX_PER_WEEK
    }));
  } else {
    const gp = goalPhase(g, ws, ctx.vacations ?? []); phase = gp.phase; weekNo = gp.idx + 1; total = gp.total;
    const v = goalVolumes(g, ctx, weekStart(ctx.today));
    const peak = Math.max(v.peak, v.start);
    let vol = v.start + (peak - v.start) * gp.ramp;
    if (phase === 'erholung') vol *= 0.75;
    if (phase === 'taper') vol = peak * 0.65;
    if (phase === 'wettkampfwoche') vol = peak * 0.4;
    // Einheiten pro Woche: Empfehlung nach Distanz/Zielzeit, gedeckelt durch deine verfügbare Zeit
    const ps = plannedSessions(g);
    if (ps.short) vol *= Math.max(0.8, ps.n / ps.rec);
    else if (ambitious(g)) vol *= 1.1;
    const raceDay = (Date.parse(g.date) - Date.parse(ws)) / 86400000;   // 0..6 in der Wettkampfwoche
    // Kraft: wie eingestellt, Taper eine weniger und leichter, Wettkampfwoche 1× leicht ohne Beine
    const n = kraftCount(ctx);
    const kCount = n === 0 ? 0 : phase === 'wettkampfwoche' ? 1 : phase === 'taper' ? Math.max(1, n - 1) : n;
    const kg = strengthGroups(ctx, ws, kCount);
    const kDays = KRAFT_DAYS[kCount];
    assignKraft(kDays, kg).forEach((k, i) => sessions.push(kraft(ws, k.day, `kraft${i + 1}`, k.groups, phase === 'taper' || phase === 'wettkampfwoche',
      phase === 'wettkampfwoche' || k.noLegs || (phase === 'taper' && i > 0))));
    const trail = g.sport === 'trailrun';
    // Weitere Sportarten aus deinen Einstellungen, die der Wettkampfplan nicht selbst abdeckt
    const covered: EnduranceSport[] = g.sport === 'triathlon' ? ['lauf', 'rad', 'schwimmen'] : g.sport === 'rad' ? ['rad'] : g.sport === 'schwimmen' ? ['schwimmen'] : ['lauf'];
    const extras = sportsOf(ctx).list.filter(c => c.perWeek > 0 && !covered.includes(c.sport));
    const extraRun = extras.some(c => c.sport === 'lauf');

    // Anteil am Umfang je Einheit; Slots in Prioritätsreihenfolge, die ersten n werden geplant
    const race = phase === 'wettkampfwoche';
    const pick = <T extends { w: number; key: string }>(all: T[], n: number, drop: string[]) => {
      const list = all.slice(0, n).filter(x => !(race && drop.includes(x.key)));
      const sum = list.reduce((t, x) => t + x.w, 0) || 1;
      return list.map(x => ({ ...x, share: x.w / sum }));
    };
    if (g.sport === 'lauf' || g.sport === 'trailrun') {
      const longCap = trail ? Math.min(270, 60 + (g.distanceKm ?? 20) * 4) : (g.distanceKm ?? 10) <= 11 ? 95 : (g.distanceKm ?? 0) <= 22 ? 130 : 190;
      const hmWeek = trail ? Math.round((g.elevation ?? 800) * (0.35 + 0.35 * gp.ramp) * (phase === 'erholung' || phase === 'taper' ? 0.6 : 1) / 50) * 50 : 0;
      const slots = [{ key: 'run-q', day: 3, w: 1.1 }, { key: 'run-long', day: 5, w: 1.8 }, { key: 'run-easy', day: 1, w: 1 }, { key: 'run-easy2', day: 6, w: 1 }, { key: 'run-easy3', day: 2, w: 0.9 }, { key: 'run-easy4', day: 4, w: 0.8 }];
      for (const x of pick(slots, ps.n, ['run-long', 'run-easy2', 'run-easy3', 'run-easy4'])) {
        // In der Wettkampfwoche ohne langen Lauf: Umfang wie bisher auf locker + Qualität
        const m = vol * (race ? (x.key === 'run-q' ? 0.24 : 0.28) : x.share);
        if (x.key === 'run-q') sessions.push(runQuality(ws, x.day, x.key, phase, gp.idx, p, m, g, trail));
        else if (x.key === 'run-long') sessions.push(longRun(ws, x.day, x.key, p, Math.min(m, longCap), phase, g, trail, Math.round(hmWeek * 0.6 / 50) * 50));
        else sessions.push(easyRun(ws, x.day, x.key, p, m, trail));
      }
    } else if (g.sport === 'rad') {
      const hm = g.elevation ? Math.round(g.elevation * (0.4 + 0.4 * gp.ramp) / 50) * 50 : undefined;
      const easyQ = phase === 'grundlage' || phase === 'erholung';
      const slots = [{ key: 'ride-q', day: 3, w: 1.1 }, { key: 'ride-long', day: 5, w: 2.3 }, { key: 'ride-easy', day: 1, w: 1 }, { key: 'ride-easy2', day: 6, w: 0.8 }, { key: 'ride-easy3', day: 2, w: 0.8 }];
      for (const x of pick(slots, ps.n, ['ride-long', 'ride-easy2', 'ride-easy3'])) {
        const m = vol * (race ? (x.key === 'ride-q' ? 0.25 : 0.22) : x.share);
        if (x.key === 'ride-q') sessions.push(S(ws, x.day, x.key, 'rad', easyQ ? 'Ausfahrt mit Tempowechseln' : phase === 'spitze' ? 'Wettkampftempo am Rad' : 'Rad-Intervalle', m,
          easyQ ? 'mittel' : 'hart',
          easyQ ? 'Locker, darin 6 × 2 min zügig.' : phase === 'spitze' ? '20 min einfahren, 3 × 15 min im geplanten Wettkampftempo, 5 min locker dazwischen.' : '20 min einfahren, 4–5 × 8 min zügig (Schwelle), 4 min locker, ausfahren.'));
        else if (x.key === 'ride-long') sessions.push(S(ws, x.day, x.key, 'rad', 'Lange Ausfahrt', Math.min(m, 360), 'mittel', `Lang und gleichmäßig${hm ? `, möglichst ca. ${hm} hm` : ''}. Verpflegung wie im Wettkampf testen.`, hm));
        else sessions.push(S(ws, x.day, x.key, 'rad', 'Lockere Ausfahrt', m, 'locker', 'Gleichmäßig locker, hohe Trittfrequenz (85–95).'));
      }
      // 1× locker Laufen – außer der Radumfang ist ohnehin sehr hoch oder Sonntag ist schon belegt
      if (vol < 420 && !race && !extraRun && ps.n < 4) sessions.push(easyRun(ws, 6, 'run-easy', p, 35));
    } else if (g.sport === 'schwimmen') {
      const slots = [{ key: 'swim-q', day: 3, w: 1 }, { key: 'swim-long', day: 5, w: 1.33 }, { key: 'swim-tech', day: 1, w: 1 }, { key: 'swim-tech2', day: 0, w: 0.8 }, { key: 'swim-easy', day: 2, w: 0.8 }];
      for (const x of pick(slots, ps.n, ['swim-long', 'swim-tech2', 'swim-easy'])) {
        const m = vol * (race ? 0.3 : x.share);
        if (x.key === 'swim-q') sessions.push(S(ws, x.day, x.key, 'schwimmen', phase === 'spitze' ? 'Wettkampftempo' : 'Intervalle', m, phase === 'grundlage' ? 'mittel' : 'hart',
          phase === 'spitze' ? 'Einschwimmen, 4 × 400 m im Wettkampftempo, 1 min Pause.' : 'Einschwimmen, 10–12 × 100 m zügig, 20 s Pause, ausschwimmen.'));
        else if (x.key === 'swim-long') sessions.push(S(ws, x.day, x.key, 'schwimmen', 'Lange Strecke', m, 'mittel', 'Lange gleichmäßige Strecke, möglichst im Freiwasser oder ohne Pausen.'));
        else sessions.push(S(ws, x.day, x.key, 'schwimmen', 'Technik & Grundlage', m, 'locker', 'Einschwimmen, Technikübungen (z. B. Abschlag, Zählen der Züge), dann ruhig durchschwimmen.'));
      }
      if (!race && !extraRun) sessions.push(easyRun(ws, 6, 'run-easy', p, 35));
    } else {
      // Triathlon: Schwimmen 20 %, Rad 47 %, Laufen 33 %; Einheiten nach Priorität
      const tri = TRI[g.triDistance ?? 'olympisch'];
      const vols = { schwimmen: vol * 0.2, rad: vol * 0.47, lauf: vol * 0.33 };
      const build = phase === 'aufbau' || phase === 'spitze';
      type Slot = { key: string; day: number; w: number; sp: 'schwimmen' | 'rad' | 'lauf' };
      const all: Slot[] = [
        { key: 'ride-long', day: 5, w: 0.45, sp: 'rad' }, { key: 'run-long', day: 6, w: 0.55, sp: 'lauf' }, { key: 'ride-q', day: 3, w: 0.3, sp: 'rad' },
        { key: 'swim-q', day: 4, w: 0.55, sp: 'schwimmen' }, { key: 'run-easy', day: 2, w: 0.3, sp: 'lauf' }, { key: 'swim-tech', day: 0, w: 0.45, sp: 'schwimmen' },
        { key: 'ride-easy', day: 1, w: 0.25, sp: 'rad' }, { key: 'run-easy2', day: 4, w: 0.25, sp: 'lauf' }, { key: 'swim-easy', day: 2, w: 0.35, sp: 'schwimmen' }, { key: 'ride-easy2', day: 0, w: 0.2, sp: 'rad' }
      ];
      const chosen = all.slice(0, ps.n).filter(x => !(race && ['ride-long', 'run-long', 'run-easy2', 'swim-easy', 'ride-easy2'].includes(x.key)));
      const wsum = (sp: Slot['sp']) => chosen.filter(x => x.sp === sp).reduce((t, x) => t + x.w, 0) || 1;
      for (const x of chosen) {
        const m = vols[x.sp] * x.w / (race ? 1 : wsum(x.sp));   // Wettkampfwoche: bewusst wenig
        if (x.key === 'swim-tech' || x.key === 'swim-easy') sessions.push(S(ws, x.day, x.key, 'schwimmen', 'Schwimmen Technik', m, 'locker', 'Technikübungen + ruhige Strecke.'));
        else if (x.key === 'swim-q') sessions.push(S(ws, x.day, x.key, 'schwimmen', 'Schwimmen Intervalle', m, 'hart', `10 × 100 m zügig, 20 s Pause${g.targetTimes?.swim ? ` (Ziel-Pace ${fmtPace(g.targetTimes.swim / 60 / tri.swim / 10)} min/100 m)` : ''}.`));
        else if (x.key === 'ride-easy' || x.key === 'ride-easy2') sessions.push(S(ws, x.day, x.key, 'rad', 'Rad locker', m, 'locker', 'Locker, hohe Trittfrequenz.'));
        else if (x.key === 'ride-q') sessions.push(S(ws, x.day, x.key, 'rad', build ? 'Rad-Intervalle' : 'Rad mit Tempowechseln', m, build ? 'hart' : 'mittel', build ? '4–5 × 8 min zügig (≈ Wettkampftempo oder etwas darüber), 4 min locker.' : 'Locker mit 6 × 2 min zügig.'));
        else if (x.key === 'ride-long') {
          sessions.push(S(ws, x.day, x.key, 'rad', 'Lange Radausfahrt', Math.min(m, 300), 'mittel', 'Lang und gleichmäßig, Wettkampfverpflegung testen.'));
          if (build) sessions.push(S(ws, 5, 'brick', 'lauf', 'Koppellauf (direkt nach dem Rad)', Math.min(10 + vols.lauf * 0.15, 30), 'mittel', `Direkt vom Rad in die Laufschuhe, erste Minuten ${pr(p.race ?? p.threshold + 0.1, 0.08)}, dann locker. Wechsel üben.`));
        }
        else if (x.key === 'run-long') sessions.push(longRun(ws, x.day, x.key, p, Math.min(m, tri.run > 20 ? 150 : 80), phase, g, false));
        else sessions.push(easyRun(ws, x.day, x.key, p, m));
      }
    }

    // Zusatzsportarten: Fokus liegt auf dem Wettkampf → keine Steigerung, in der Spitze nur Grundlage,
    // im Taper höchstens eine lockere Einheit, in der Wettkampfwoche keine
    if (extras.length && phase !== 'wettkampfwoche') {
      const taperW = phase === 'taper';
      sessions.push(...enduranceWeek(ws, ctx, phase, p, sessions, extras, {
        main: null, factor: phase === 'erholung' || phase === 'urlaub' ? 0.75 : taperW ? 0.5 : 1, ramp: 1,
        demote: taperW || phase === 'spitze', max: taperW ? 1 : MAX_PER_WEEK
      }));
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
        details: raceDetails(g, p), status: 'offen', notes: [], race: raceLegs(g, p) });
    }
  }

  let out = applyVacation(sessions, ctx.vacations ?? [], !!g, ws);
  if (ctx.injury) out = applyInjury(out, ctx.injury, ws, ctx.vacations ?? []);
  out = applyEdits(out, ctx.edits);
  out = applyStrengthShift(out, ctx.edits, ws);
  const used = new Set<string>();
  out = applyDone(out, ctx.activities.filter(a => !ctx.physio?.has(a.id)), ctx.today, used, ws, ctx.hr?.max ?? 190);
  if (ws === weekStart(ctx.today)) out = applyMissed(out, ctx.today, ws, ctx.edits);
  out = applyStrengthActual(out, ctx, ws, phase === 'wettkampfwoche');
  out = applyStrengthMissed(out, ctx.today, ctx.edits);
  const inter = applyInteractions(out, ctx, ws, used);
  out = inter.list;
  // Ausgleich nur im Wettkampfplan (nicht im Trainingsalltag), nicht bei Verletzung, Taper, Wettkampf- und Erholungswochen
  let carry: PlanWeek['carry'];
  const compensate = !!g && !ctx.injury && !['taper', 'wettkampfwoche', 'erholung', 'urlaub'].includes(phase);
  if (g && !ctx.injury && ws === weekStart(ctx.today)) {
    const c = applyCompensation(out, ctx.today, compensate ? null : {});
    out = c.list; carry = c.carry;
  } else if (compensate && ws === addDays(weekStart(ctx.today), 7)) {
    const prev = buildWeek(addDays(ws, -7), ctx);
    if (prev.carry) out = applyCarry(out, prev.carry);
  }
  out = applyWarmup(out, ctx);
  out.sort((a, b) => a.date.localeCompare(b.date) || order(a) - order(b));
  const minutes = out.filter(s => s.status !== 'ausgelassen').reduce((t, s) => t + s.minutes, 0);
  const runMinutes = out.filter(s => (s.sport === 'lauf' || s.sport === 'trail') && s.status !== 'ausgelassen').reduce((t, s) => t + s.minutes, 0);
  const events: FixedEvent[] = [];   // Fixtermine sind in den Urlaub übergegangen
  return { weekStart: ws, phase, goal: g, weekNo, totalWeeks: total, sessions: out, events, paces: p, minutes, runMinutes, extra: inter.extra, adjusted: inter.adjusted, carry };
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
function applyVacation(list: PlanSession[], vacations: Vacation[], goalMode: boolean, ws: string): PlanSession[] {
  const sportVac = (date: string) => vacations.find(v => v.sport && date >= v.start && date <= v.end);
  const out: PlanSession[] = [];
  for (const s of list) {
    if (s.sport === 'wettkampf') { out.push(s); continue; }
    const v = vacations.find(x => s.date >= x.start && s.date <= x.end);
    // Urlaubstag mit fest geplantem Sport: der Sport ersetzt das geplante Training (nichts anderes planen)
    if (v?.sport) continue;
    if (v) {
      // Urlaub ohne Sport: Trainingsstufe voll / weniger / keine
      if (s.sport === 'kraft') continue;                                 // kein Studio im Urlaub – trägst du selbst ein, falls doch
      const mode = v.training === 'keine' && goalMode ? 'weniger' : v.training;
      if (mode === 'keine') continue;
      if (mode === 'weniger') {
        out.push({ ...s, minutes: r5(s.minutes * 0.6), intensity: s.intensity === 'hart' ? 'mittel' : s.intensity,
          details: s.intensity === 'hart' ? 'Urlaubsversion: locker mit ein paar zügigen Abschnitten nach Lust und Gelände.' : s.details,
          notes: [...s.notes, 'Urlaub: reduziert.'] });
        continue;
      }
      out.push({ ...s, notes: [...s.notes, 'Urlaub.'] });
      continue;
    }
    // Kein Urlaubstag: Anpassung, wenn morgen ein Sport-Urlaubstag beginnt
    const tmr = sportVac(addDays(s.date, 1));
    if (tmr?.sport) {
      const label = vacationSportLabel(tmr.sport);
      if (s.sport === 'kraft' && s.groups && hasLegs(s.groups) && VACATION_LEG.has(tmr.sport)) {
        const k = kraft(ws, (Date.parse(s.date) - Date.parse(ws)) / 86400000, s.key.split(':')[1], s.groups, false, true);
        k.notes = [`Weniger Beinvolumen: morgen ${label}.`]; out.push(k); continue;
      }
      if (s.intensity === 'hart') { out.push({ ...s, intensity: 'locker', title: s.title + ' (locker)', notes: [...s.notes, `Morgen ${label} – heute nur locker.`] }); continue; }
    }
    out.push(s);
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
  // Pause: keine Ausdauer. Krafttraining bleibt immer wie geplant – das entscheidest du im Training selbst.
  if (!outage && stage === 0) return list.filter(s => s.sport === 'kraft');
  const factor = outage ? 1 : STAGE_VOLUME[stage];
  const out: PlanSession[] = [];
  let blocked = 0;   // Einheiten, die wegen der Verletzung ersetzt werden mussten oder weggefallen sind
  for (const s of list) {
    if (s.sport === 'wettkampf') { out.push({ ...s, notes: [...s.notes, `${label} – prüfe, ob der Wettkampf machbar ist.`] }); continue; }
    if (s.sport === 'kraft') { out.push(s); continue; }          // Kraft wird nicht an die Verletzung angepasst
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
      }
    }
  }
  return out;
}

/* ---------- Eigene Änderungen + erledigte Einheiten ---------- */
/** Aufwärmen passend zur (durch Urlaub/Verletzung/Verschieben) endgültigen Einheit, mit Platz für einen Pro-Einheit-Override. */
function applyWarmup(list: PlanSession[], ctx: PlanContext): PlanSession[] {
  const settings = ctx.warmupSettings ?? DEFAULT_WARMUP_SETTINGS;
  return list.map(s => {
    if (s.status === 'ausgelassen') return s;
    const edit = ctx.edits.get(s.key);
    const warmupMode = edit?.warmup;
    return { ...s, warmup: resolveWarmup(s, settings, warmupMode), warmupMode };
  });
}

function applyEdits(list: PlanSession[], edits: Map<string, PlanEdit>): PlanSession[] {
  return list.map(s => {
    const e = edits.get(s.key); if (!e) return s;
    return { ...s, date: e.movedTo ?? s.date, moved: !!e.movedTo && e.movedTo !== s.origDate, status: e.status ?? s.status, skipped: e.status === 'ausgelassen' ? 'manuell' as const : s.skipped };
  });
}
/**
 * Krafteinheit von Hand nach hinten verschoben: Krafteinheiten, die dort schon liegen, rücken je einen Tag mit –
 * bis zum nächsten freien Tag (der Ruhetag rückt so einen Tag nach hinten). Ausdauer bleibt, wo sie ist.
 * Was über den Sonntag hinausrutscht, entfällt; der Split macht nächste Woche einfach weiter.
 */
function applyStrengthShift(list: PlanSession[], edits: Map<string, PlanEdit>, ws: string): PlanSession[] {
  const end = addDays(ws, 6);
  const out = list.map(s => ({ ...s, notes: [...s.notes] }));
  const manual = (s: PlanSession) => !!edits.get(s.key)?.movedTo || !!edits.get(s.key)?.status;
  const kraftList = out.filter(s => s.sport === 'kraft' && s.status !== 'ausgelassen');
  const movers = kraftList.filter(s => edits.get(s.key)?.movedTo && s.date > s.origDate).sort((a, b) => a.date.localeCompare(b.date));
  for (const m of movers) {
    let cur = m;
    for (let guard = 0; guard < 14; guard++) {
      const blocker = kraftList.find(o => o !== cur && o.date === cur.date && o.status !== 'ausgelassen');
      if (!blocker) break;
      if (manual(blocker) || blocker.status !== 'offen') {
        if (cur === m) break;                       // fester Termin: nicht weiter verdrängen
        cur.date = addDays(cur.date, 1); continue;  // an festem Termin vorbei
      }
      blocker.date = addDays(blocker.date, 1); blocker.moved = true;
      if (!blocker.notes.some(n => /rückt/.test(n))) blocker.notes.push(`Rückt einen Tag nach hinten (${m.title.replace('Kraft · ', '')} wurde verschoben).`);
      if (blocker.date > end) {
        blocker.date = end; blocker.status = 'ausgelassen'; blocker.skipped = 'verpasst';
        blocker.notes.push('Passt diese Woche nicht mehr rein – der Split geht nächste Woche weiter.');
        break;
      }
      cur = blocker;
    }
  }
  return out;
}

/** Krafteinheit verpasst (Tag vorbei, nicht erledigt): entfällt; die ausgefallenen Muskelgruppen kommen als Nächstes dran. */
function applyStrengthMissed(list: PlanSession[], today: string, edits: Map<string, PlanEdit>): PlanSession[] {
  return list.map(s => {
    if (s.sport !== 'kraft' || s.status !== 'offen' || s.date >= today || edits.get(s.key)?.status) return s;
    return { ...s, status: 'ausgelassen' as const, skipped: 'verpasst' as const,
      notes: [...s.notes, `Am ${fmtWeekday(s.date)} nicht gemacht – die Muskelgruppen kommen als Nächstes dran.`] };
  });
}

const FAMILY: Record<PlanSport, RegExp> = { kraft: /Weight|Workout/, lauf: /Run/, trail: /Run/, rad: /Ride/, schwimmen: /Swim/, gehen: /Hike|Walk/, wettkampf: /./ };
function applyDone(list: PlanSession[], acts: Activity[], today: string, used: Set<string>, ws: string, hrMax = 190): PlanSession[] {
  // 1) Gleicher Tag, gleiche Sportart
  const out = list.map(s => {
    if (s.status === 'ausgelassen' || s.date > today) return s;
    const a = acts.find(x => x.date === s.date && !used.has(x.id) && FAMILY[s.sport].test(x.sportType));
    if (!a) return s;
    if (s.status === 'erledigt') { used.add(a.id); return { ...s, activityId: a.id }; }
    used.add(a.id);
    return { ...s, status: 'erledigt' as const, autoDone: true, activityId: a.id };
  });
  // 2) Anderer Tag derselben Woche: Aktivität der passendsten offenen Ausdauereinheit zuordnen
  //    (gleiche Sportart, ähnliche Dauer; lange Aktivität → bevorzugt die lange Einheit). Die Einheit wandert auf den Trainingstag.
  const end = addDays(ws, 6);
  const rest = acts.filter(a => a.date >= ws && a.date <= end && a.date <= today && !used.has(a.id)).sort((x, y) => (y.duration ?? 0) - (x.duration ?? 0));
  for (const a of rest) {
    const min = (a.duration ?? a.elapsed ?? 0) / 60;
    if (min < 15) continue;
    let best: { i: number; score: number } | null = null;
    out.forEach((s, i) => {
      if (s.status !== 'offen' || !endurance(s) || s.date === a.date || s.date < ws || s.date > end || !FAMILY[s.sport].test(a.sportType)) return;
      const ratio = min / Math.max(1, s.minutes);
      if (ratio < 0.5 || ratio > 2.5) return;
      // Harte Einheit nur mit erkennbar hartem Training (Ø-Puls ≥ 78 % vom Max); ohne Puls nur nachträglich (verpasst → später gemacht)
      if (s.intensity === 'hart' && (a.avgHr ? a.avgHr / hrMax < 0.78 : s.date > a.date)) return;
      // Lange Einheit vorab nur mit ähnlich langer Aktivität
      if (/long/.test(s.key) && s.date > a.date && ratio < 0.75) return;
      const score = Math.abs(Math.log(ratio)) + Math.abs(Date.parse(s.date) - Date.parse(a.date)) / 86400000 * 0.25;
      if (!best || score < best.score) best = { i, score };
    });
    if (!best) continue;
    const s = out[(best as { i: number }).i];
    used.add(a.id);
    out[(best as { i: number }).i] = { ...s, date: a.date, moved: a.date !== s.origDate, status: 'erledigt', autoDone: true, activityId: a.id,
      notes: [...s.notes, `Statt ${fmtWeekday(s.date)} am ${fmtWeekday(a.date)} gemacht.`] };
  }
  return out;
}

const fmtWeekday = (iso: string) => ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'][(new Date(iso + 'T12:00:00').getDay() + 6) % 7];
const isKey = (s: PlanSession) => endurance(s) && !/brick/.test(s.key) && (/long|-q2?$/.test(s.key) || s.intensity === 'hart');
const isHard = (s: PlanSession) => s.sport === 'wettkampf' || (endurance(s) && (/long/.test(s.key) || s.intensity === 'hart'));

/**
 * 3) Verpasst (Tag vorbei, nicht erledigt): wichtige Einheiten (lang, Qualität) auf den nächsten passenden Tag
 *    dieser Woche schieben – kein harter Tag direkt davor/danach; ein lockerer Ausdauertermin dort entfällt dafür.
 *    Passt nichts mehr oder ist die Einheit locker, entfällt sie. Manuell bearbeitete Einheiten bleiben unangetastet.
 */
function applyMissed(list: PlanSession[], today: string, ws: string, edits: Map<string, PlanEdit>): PlanSession[] {
  const out = list.map(s => ({ ...s, notes: [...s.notes] }));
  const end = addDays(ws, 6);
  const missed = out.filter(s => s.status === 'offen' && endurance(s) && s.date < today && s.date >= ws && !edits.get(s.key)?.status)
    .sort((x, y) => Number(isKey(y)) - Number(isKey(x)) || (/long/.test(y.key) ? 1 : 0) - (/long/.test(x.key) ? 1 : 0));
  for (const s of missed) {
    const was = fmtWeekday(s.date);
    if (!isKey(s)) { s.status = 'ausgelassen'; s.skipped = 'verpasst'; s.notes.push(`Am ${was} nicht gemacht – entfällt.`); continue; }
    let target: string | null = null;
    for (let d = today; d <= end && !target; d = addDays(d, 1)) {
      const near = out.filter(o => o !== s && o.status !== 'ausgelassen' && [addDays(d, -1), d, addDays(d, 1)].includes(o.date));
      if (near.some(isHard)) continue;
      if (out.some(o => o !== s && o.date === d && endurance(o) && o.status === 'erledigt')) continue;
      target = d;
    }
    if (!target) { s.status = 'ausgelassen'; s.skipped = 'verpasst'; s.notes.push(`Am ${was} nicht gemacht – passt diese Woche nicht mehr rein.`); continue; }
    for (const o of out) if (o !== s && o.date === target && endurance(o) && o.status === 'offen') { o.status = 'ausgelassen'; o.notes.push(`Entfällt für ${s.title} (von ${was} verschoben).`); }
    s.date = target; s.moved = true; s.notes.push(`Am ${was} verpasst – auf ${target === today ? 'heute' : fmtWeekday(target)} verschoben.`);
  }
  return out;
}

/* ---------- Ausgleich ausgefallener Einheiten (nur Wettkampfplan) ---------- */
/**
 * Bewusst moderat (Nachholen in voller Länge erhöht das Verletzungsrisiko):
 * Die Hälfte der ausgefallenen Minuten (lange Einheit 60 %) kommt auf die übrigen offenen Einheiten derselben Sportart
 * dieser Woche (keine harten), je höchstens +20 %. Was nicht passt, geht in die nächste Woche (dort höchstens +10 % der Sportart).
 * Intensität wird nicht nachgeholt. noRoom = {} → nichts in dieser Woche verteilen, alles vortragen.
 */
const rnd5 = (m: number) => Math.round(m / 5) * 5;
const famOf = (s: PlanSession): 'lauf' | 'rad' | 'schwimmen' | null => s.sport === 'lauf' || s.sport === 'trail' ? 'lauf' : s.sport === 'rad' ? 'rad' : s.sport === 'schwimmen' ? 'schwimmen' : null;
function applyCompensation(list: PlanSession[], today: string, noRoom: object | null): { list: PlanSession[]; carry: PlanWeek['carry'] } {
  const out = list.map(s => ({ ...s, notes: [...s.notes] }));
  const pool: Record<string, number> = {};
  for (const s of out) {
    const f = famOf(s);
    if (!f || s.status !== 'ausgelassen' || !s.skipped || s.key.endsWith('brick')) continue;
    pool[f] = (pool[f] ?? 0) + s.minutes * (/long/.test(s.key) ? 0.6 : 0.5);
  }
  const carry: NonNullable<PlanWeek['carry']> = {};
  for (const [f, total] of Object.entries(pool)) {
    let rest = total;
    if (!noRoom) {
      const open = out.filter(s => famOf(s) === f && s.status === 'offen' && s.date >= today && s.intensity !== 'hart' && s.sport !== 'wettkampf')
        .sort((a, b) => Number(a.intensity !== 'locker') - Number(b.intensity !== 'locker'));
      for (const s of open) {
        if (rest < 5) break;
        const add = rnd5(Math.min(rest, s.minutes * 0.2));
        if (add < 5) continue;
        s.minutes += add; rest -= add;
        s.notes.push(`+${add} min Ausgleich für eine ausgefallene Einheit.`);
      }
    }
    if (rest >= 5) carry[f as 'lauf'] = Math.round(rest);
  }
  return { list: out, carry: Object.keys(carry).length ? carry : undefined };
}
function applyCarry(list: PlanSession[], carry: NonNullable<PlanWeek['carry']>): PlanSession[] {
  const out = list.map(s => ({ ...s, notes: [...s.notes] }));
  for (const [f, minutes] of Object.entries(carry)) {
    const all = out.filter(s => famOf(s) === f && s.status === 'offen' && s.sport !== 'wettkampf');
    const week = all.reduce((t, s) => t + s.minutes, 0);
    const sess = all.filter(s => s.intensity !== 'hart');
    let rest = Math.min(minutes ?? 0, week * 0.1);
    for (const s of sess.sort((a, b) => Number(a.intensity !== 'locker') - Number(b.intensity !== 'locker'))) {
      if (rest < 5) break;
      const add = rnd5(Math.min(rest, s.minutes * 0.15));
      if (add < 5) continue;
      s.minutes += add; rest -= add;
      s.notes.push(`+${add} min Ausgleich für ausgefallenes Training letzte Woche.`);
    }
  }
  return out;
}

/* ---------- Kraft: tatsächlich trainierte Muskelgruppen ---------- */
/**
 * Erledigte Krafttage zeigen, was du wirklich eingetragen hast (nicht den ursprünglichen Plan).
 * Die restlichen Krafttage dieser Woche setzen den Split ab der zuletzt trainierten Einheit fort.
 */
function applyStrengthActual(list: PlanSession[], ctx: PlanContext, ws: string, noLegsAll: boolean): PlanSession[] {
  const t = ctx.today;
  const done = ctx.strength.filter(x => !x.skipped && x.muscleGroups.length);
  const taken = new Set<string>();
  const out = list.map(s => {
    if (s.sport !== 'kraft' || s.date > t) return s;
    const real = (s.activityId ? done.find(x => !taken.has(x.id) && x.activityId === s.activityId) : undefined)
      ?? done.filter(x => !taken.has(x.id) && x.date === s.date).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (!real) return s;
    taken.add(real.id);
    return { ...s, groups: [...real.muscleGroups], title: `Kraft · ${real.muscleGroups.map(groupLabel).join(' + ')}`,
      status: s.status === 'ausgelassen' ? s.status : 'erledigt' as const };
  });
  if (!ctx.split || ws !== weekStart(t)) return out;
  const idx = (d: string) => Math.round((Date.parse(d) - Date.parse(ws)) / 86400000);
  const open = out.filter(s => s.sport === 'kraft' && s.status === 'offen' && s.date >= t && !s.key.endsWith(':ausgleich')).sort((a, b) => a.date.localeCompare(b.date));
  if (!open.length) return out;
  const start = nextSplitDay(ctx.split, done.filter(x => x.date <= t)).index;
  const groups = open.map((_, i) => [...ctx.split!.days[(start + i) % ctx.split!.days.length]]);
  const doneLegs = out.filter(s => s.sport === 'kraft' && s.status === 'erledigt' && s.groups && hasLegs(s.groups)).map(s => idx(s.date));
  const plan = assignKraft(open.map(s => idx(s.date)), groups, doneLegs);
  return out.map(s => {
    const i = open.indexOf(s);
    if (i < 0) return s;
    const a = plan.find(p => p.day === idx(s.date) && !(p as { used?: boolean }).used)!;
    (a as { used?: boolean }).used = true;
    const keepNoLegs = noLegsAll || s.notes.some(n => /Bein/.test(n));
    const k = kraft(ws, a.day, s.key.split(':')[1], a.groups, s.intensity === 'locker', a.noLegs || keepNoLegs);
    return { ...k, key: s.key, date: s.date, origDate: s.origDate, moved: s.moved, status: s.status, notes: [...new Set([...s.notes.filter(n => !/Beintraining/.test(n)), ...k.notes])] };
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
const LEG_HEAVY = /Ride|Run|Hike|Walk|Ski|Snowboard|Climb|Row|Snowshoe/;
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
    const unplanned = ctx.activities.filter(a => a.date >= ws && a.date <= t && !used.has(a.id) && !ctx.physio?.has(a.id) && !/Weight|Workout|Yoga/.test(a.sportType));
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
