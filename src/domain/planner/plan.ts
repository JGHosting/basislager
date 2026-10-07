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

export type PlanSport = 'kraft' | 'lauf' | 'trail' | 'rad' | 'schwimmen' | 'gehen' | 'wettkampf';
export type Intensity = 'locker' | 'mittel' | 'hart' | 'wettkampf';
export interface PlanSession {
  key: string; date: string; origDate: string; sport: PlanSport; title: string; minutes: number;
  intensity: Intensity; details: string; groups?: MuscleGroup[]; elevation?: number;
  status: 'offen' | 'erledigt' | 'ausgelassen'; autoDone?: boolean; moved?: boolean; notes: string[];
}
export type Phase = 'basis' | 'grundlage' | 'aufbau' | 'spitze' | 'taper' | 'wettkampfwoche' | 'erholung';
export const PHASE_LABEL: Record<Phase, string> = {
  basis: 'Standardwoche', grundlage: 'Grundlage', aufbau: 'Aufbau', spitze: 'Spitze', taper: 'Taper', wettkampfwoche: 'Wettkampfwoche', erholung: 'Erholungswoche'
};
export interface PlanWeek {
  weekStart: string; phase: Phase; goal: Goal | null; weekNo?: number; totalWeeks?: number;
  sessions: PlanSession[]; events: FixedEvent[]; paces: Paces; minutes: number; runMinutes: number;
}
export interface PlanContext {
  today: string; activities: Activity[]; strength: StrengthSession[]; split: SplitTemplate | null;
  goal: Goal | null; injury: Injury | null; events: FixedEvent[]; edits: Map<string, PlanEdit>;
  runsPerWeek: 2 | 3; vacations: Vacation[];
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
function goalPhase(g: Goal, ws: string) {
  const startWs = weekStart(g.planStart), raceWs = weekStart(g.date);
  const total = Math.round((Date.parse(raceWs) - Date.parse(startWs)) / 604800000) + 1;
  const idx = Math.round((Date.parse(ws) - Date.parse(startWs)) / 604800000);
  const toRace = total - 1 - idx;
  const taper = isLongGoal(g) ? 2 : 1;          // inkl. Wettkampfwoche
  const peakWeeks = total >= 8 ? 2 : total >= 5 ? 1 : 0;
  const buildEnd = total - taper - peakWeeks;   // Wochen 0..buildEnd-1 = Grundlage/Aufbau
  const isRecovery = (i: number) => i < buildEnd + peakWeeks && (i + 1) % 4 === 0 && i < total - taper - 1;
  let phase: Phase;
  if (toRace === 0) phase = 'wettkampfwoche';
  else if (toRace < taper) phase = 'taper';
  else if (idx >= buildEnd) phase = 'spitze';
  else if (isRecovery(idx)) phase = 'erholung';
  else phase = idx < Math.max(1, Math.round(buildEnd * 0.35)) ? 'grundlage' : 'aufbau';
  // Steigerung über alle Belastungswochen bis zur Spitze
  const loadWeeks = Array.from({ length: buildEnd + peakWeeks }, (_, i) => i).filter(i => !isRecovery(i));
  const pos = loadWeeks.filter(i => i <= idx).length;
  const ramp = loadWeeks.length > 1 ? Math.min(1, (pos - 1) / (loadWeeks.length - 1)) : 1;
  return { phase, idx, total, toRace, ramp };
}

/* ---------- Kraft ---------- */
function strengthGroups(ctx: PlanContext, ws: string, count: number): MuscleGroup[][] {
  const thisWeekOffset = Math.max(0, Math.round((Date.parse(ws) - Date.parse(weekStart(ctx.today))) / 604800000));
  if (!ctx.split) return Array.from({ length: count }, () => ['ganzkoerper']);
  const before = ctx.strength.filter(s => s.date < weekStart(ctx.today));
  const start = nextSplitDay(ctx.split, before).index + thisWeekOffset * 3;
  const out = Array.from({ length: count }, (_, i) => [...ctx.split!.days[(start + i) % ctx.split!.days.length]]);
  // Beine/Ganzkörper möglichst auf den ersten Krafttag (Montag) – weit weg von Qualitäts- und langen Einheiten
  return out.sort((a, b) => Number(hasLegs(b)) - Number(hasLegs(a)));
}
const hasLegs = (g: MuscleGroup[]) => g.includes('beine') || g.includes('ganzkoerper');
function kraft(ws: string, day: number, slot: string, groups: MuscleGroup[], light: boolean, noLegs: boolean): PlanSession {
  let gs = groups;
  const notes: string[] = [];
  if (noLegs && hasLegs(gs)) { gs = gs.filter(g => g !== 'beine'); if (gs.includes('ganzkoerper')) gs = ['push', 'pull', 'rumpf']; if (!gs.length) gs = ['push', 'pull']; notes.push('Ohne schweres Beintraining (Wettkampf/harte Einheit steht an).'); }
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
    const recovery = isoWeek(ws) % 4 === 0;
    phase = recovery ? 'erholung' : 'basis';
    const recent = Math.max(90, recentMinutes(ctx.activities, weekStart(ctx.today), /Run/));
    const vol = Math.min(recent * 1.08 * Math.pow(1.05, ahead), recent * 1.5) * (recovery ? 0.75 : 1);
    const kg = strengthGroups(ctx, ws, 3);
    sessions.push(kraft(ws, 0, 'kraft1', kg[0], false, false), kraft(ws, 2, 'kraft2', kg[1], false, false), kraft(ws, 4, 'kraft3', kg[2], false, true));
    if (ctx.runsPerWeek === 3) {
      sessions.push(easyRun(ws, 1, 'run-easy', p, vol * 0.3), runQuality(ws, 3, 'run-q', phase, isoWeek(ws), p, vol * 0.3, null, false), longRun(ws, 5, 'run-long', p, Math.min(vol * 0.4, 150), phase, null, false));
    } else {
      sessions.push(runQuality(ws, 1, 'run-q', phase, isoWeek(ws), p, vol * 0.45, null, false), longRun(ws, 5, 'run-long', p, Math.min(vol * 0.55, 150), phase, null, false));
    }
  } else {
    const gp = goalPhase(g, ws); phase = gp.phase; weekNo = gp.idx + 1; total = gp.total;
    const v = goalVolumes(g, ctx, weekStart(ctx.today));
    const peak = Math.max(v.peak, v.start);
    let vol = v.start + (peak - v.start) * gp.ramp;
    if (phase === 'erholung') vol *= 0.75;
    if (phase === 'taper') vol = peak * 0.65;
    if (phase === 'wettkampfwoche') vol = peak * 0.4;
    const raceDay = (Date.parse(g.date) - Date.parse(ws)) / 86400000;   // 0..6 in der Wettkampfwoche
    // Kraft: 3×, Taper 2× leichter, Wettkampfwoche 1× leicht ohne Beine
    const kCount = phase === 'wettkampfwoche' ? 1 : phase === 'taper' ? 2 : 3;
    const kg = strengthGroups(ctx, ws, kCount);
    const kDays = [0, 2, 4].slice(0, kCount);
    kDays.forEach((d, i) => sessions.push(kraft(ws, d, `kraft${i + 1}`, kg[i], phase === 'taper' || phase === 'wettkampfwoche',
      phase === 'wettkampfwoche' || d === 4 || (phase === 'taper' && i > 0))));
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
  if (ctx.injury) out = applyInjury(out, ctx.injury);
  out = applyEdits(out, ctx.edits);
  out = applyDone(out, ctx.activities, ctx.today);
  out.sort((a, b) => a.date.localeCompare(b.date) || order(a) - order(b));
  const minutes = out.filter(s => s.status !== 'ausgelassen').reduce((t, s) => t + s.minutes, 0);
  const runMinutes = out.filter(s => (s.sport === 'lauf' || s.sport === 'trail') && s.status !== 'ausgelassen').reduce((t, s) => t + s.minutes, 0);
  const events = ctx.events.filter(e => e.end >= ws && e.start <= addDays(ws, 6));
  return { weekStart: ws, phase, goal: g, weekNo, totalWeeks: total, sessions: out, events, paces: p, minutes, runMinutes };
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
export function applyInjury(list: PlanSession[], inj: Injury): PlanSession[] {
  const outage = isOutage(inj);
  const stage = inj.stage;
  const label = outage ? 'Ernste Verletzung' : `Verletzung, Stufe „${STAGES[stage].label}“`;
  if (!outage && stage === 0) return [];                                       // Pause: nichts planen
  const factor = outage ? 1 : STAGE_VOLUME[stage];
  const out: PlanSession[] = [];
  for (const s of list) {
    if (s.sport === 'wettkampf') { out.push({ ...s, notes: [...s.notes, `${label} – prüfe, ob der Wettkampf machbar ist.`] }); continue; }
    if (s.sport === 'kraft') {
      let gs = (s.groups ?? []).flatMap(g => (g === 'ganzkoerper' ? ['push', 'pull', 'beine', 'rumpf'] as MuscleGroup[] : [g]));
      if (inj.movement.beinkraft === 'nicht') gs = gs.filter(g => g !== 'beine');
      if (inj.movement.oberkoerper === 'nicht') gs = gs.filter(g => g !== 'push' && g !== 'pull');
      if (!gs.length) continue;
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
    if (st === 'geht' && !notMoves && (outage || stage >= 2 || s.sport !== 'lauf')) { out.push({ ...s, minutes: r5(s.minutes * (outage ? 1 : Math.max(factor, 0.5))), notes: [...s.notes, `${label}.`] }); continue; }
    if (st === 'eingeschraenkt' && !notMoves) { out.push({ ...s, intensity: 'locker', minutes: r5(s.minutes * 0.7), title: s.title + ' (locker)', details: 'Nur locker und kürzer. Bei Schmerz abbrechen.', notes: [`${label}: eingeschränkt.`] }); continue; }
    const alt = alternativeSport(inj, mv);
    if (!alt) continue;
    out.push({ ...s, sport: alt.sport, title: `${alt.label} statt ${s.title}`, intensity: 'locker', minutes: r5(s.minutes * 0.8),
      details: `Ersatz für ${s.title}: locker und gleichmäßig.`, notes: [`${label}: ${MOVEMENTS.find(m => m.id === mv)?.label} geht nicht – Alternative.`] });
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
function applyDone(list: PlanSession[], acts: Activity[], today: string): PlanSession[] {
  const used = new Set<string>();
  return list.map(s => {
    if (s.status !== 'offen' || s.date > today) return s;
    const a = acts.find(x => x.date === s.date && !used.has(x.id) && FAMILY[s.sport].test(x.sportType));
    if (!a) return s;
    used.add(a.id);
    return { ...s, status: 'erledigt', autoDone: true };
  });
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
