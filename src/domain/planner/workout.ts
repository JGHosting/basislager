/**
 * Plan-Einheit → strukturiertes Workout im Textformat von intervals.icu.
 * intervals.icu überträgt solche Workouts an Garmin Connect und damit auf die Uhr.
 *
 * Syntax (Auszug): "- 10m 60-70% HR" (Prozent vom Maximalpuls), "- 3m 4:50-5:05/km Pace",
 * "- 1km 4:40-4:50/km Pace", Wiederholungsblock mit Kopfzeile "Hauptteil 5x" und Leerzeilen davor/danach.
 * Die Pulsbereiche entsprechen deinen Zonen (% vom Maximalpuls): Z1 50–60, Z2 60–70, Z3 70–80, Z4 80–90.
 */
import type { PlanSession } from './plan';
import type { Paces } from './paces';
import { fmtPace } from './goals';

export const ICU_TYPE: Record<PlanSession['sport'], string | null> = {
  lauf: 'Run', trail: 'TrailRun', rad: 'Ride', schwimmen: 'Swim', gehen: 'Walk', kraft: 'WeightTraining', wettkampf: null
};

const HR = { z1: '50-60% HR', z2: '60-70% HR', z23: '65-75% HR', z3: '70-80% HR', z34: '75-85% HR', z4: '80-90% HR' };
const pace = (p: number, spread: number) => `${fmtPace(p - spread)}-${fmtPace(p + spread)}/km Pace`;

type Line = string;
const step = (cue: string, dur: string, target: string) => `- ${cue ? cue + ' ' : ''}${dur} ${target}`.replace(/\s+/g, ' ').trim();
const block = (head: string, reps: number, lines: Line[]) => ['', `${head} ${reps}x`, ...lines, ''];
const m = (min: number) => `${Math.max(1, Math.round(min))}m`;
/** Anzahl Wiederholungen so, dass Ein-/Auslaufen + Block in die geplante Dauer passen. */
const fit = (total: number, fixed: number, per: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.floor((total - fixed) / per)));

/** Baut den Workout-Text. Gesamtdauer entspricht der geplanten Dauer (Rest wird mit Auslaufen aufgefüllt). */
export function workoutText(s: PlanSession, p: Paces): string {
  const total = s.minutes;
  const run = s.sport === 'lauf' || s.sport === 'trail';
  const out: Line[] = [];
  const rest = (used: number) => Math.max(5, total - used);

  if (s.sport === 'kraft') {
    return [s.details, '', step(s.title.replace(/^Kraft · /, '').replace(/\+/g, 'und'), m(total), '')].join('\n');
  }
  if (s.sport === 'schwimmen') {
    // Pool-Workouts mit Bahnlängen sind auf Garmin heikel → zeitbasiert mit Hinweis
    if (s.intensity === 'hart') {
      const n = fit(total, 15, 2.5, 4, 12);
      out.push(step('Einschwimmen', '10m', HR.z2), ...block('Hauptteil', n, [step('Zügig', '2m', HR.z4), step('Pause', '30s', HR.z1)]), step('Ausschwimmen', m(rest(10 + n * 2.5)), HR.z2));
    } else out.push(step('Gleichmäßig', m(total), s.intensity === 'locker' ? HR.z2 : HR.z23));
    return [s.details, '', ...out].join('\n');
  }
  if (s.sport === 'rad') {
    const t = s.title;
    if (/Intervalle/.test(t)) { const n = fit(total, 20, 12, 2, 5); out.push(step('Einfahren', m(Math.min(20, total - n * 12 - 5)), HR.z2), ...block('Hauptteil', n, [step('Zügig', '8m', HR.z4), step('Locker', '4m', HR.z2)]), step('Ausfahren', m(rest(Math.min(20, total - n * 12 - 5) + n * 12)), HR.z2)); }
    else if (/Wettkampftempo/.test(t)) { const n = fit(total, 25, 20, 1, 3); out.push(step('Einfahren', '15m', HR.z2), ...block('Hauptteil', n, [step('Wettkampftempo', '15m', HR.z34), step('Locker', '5m', HR.z2)]), step('Ausfahren', m(rest(15 + n * 20)), HR.z2)); }
    else if (/Tempowechsel/.test(t)) { const n = fit(total, 20, 5, 3, 6); out.push(step('Einfahren', '15m', HR.z2), ...block('Hauptteil', n, [step('Zügig', '2m', HR.z4), step('Locker', '3m', HR.z2)]), step('Locker', m(rest(15 + n * 5)), HR.z2)); }
    else out.push(step('Gleichmäßig', m(total), s.intensity === 'locker' ? HR.z2 : HR.z23));
    return [s.details, '', ...out].join('\n');
  }
  if (!run) {   // gehen u. a.
    out.push(step('Gleichmäßig', m(total), s.intensity === 'locker' ? HR.z1 : HR.z2));
    return [s.details, '', ...out].join('\n');
  }

  // Laufen: nach Titel der Einheit (abgeleitete Varianten wie "(locker)" fallen auf einfache Läufe zurück)
  const t = s.title;
  const easy = s.intensity === 'locker' || /\(locker\)|Ausgleich|Vorbelastung/.test(t);
  const rp = p.race ?? p.threshold;
  if (easy || t === 'Lockerer Lauf') {
    out.push(step('Locker', m(total), HR.z2));
    if (t === 'Vorbelastung') { out.length = 0; out.push(step('Locker', m(total - 3), HR.z2), ...block('Steigerungen', 3, [step('Steigerung', '20s', HR.z3), step('Locker', '40s', HR.z1)])); }
  } else if (t === 'Fahrtspiel') {
    const n = fit(total, 15, 3, 4, 8); out.push(step('Einlaufen', '10m', HR.z2), ...block('Fahrtspiel', n, [step('Zügig', '1m', pace(p.threshold, 0.1)), step('Locker', '2m', HR.z2)]), step('Locker', m(rest(10 + n * 3)), HR.z2));
  } else if (t === 'Kurz & knackig') {
    const n = fit(total, 15, 6, 2, 3); const w = Math.min(15, total - n * 6 - 5); out.push(step('Einlaufen', m(w), HR.z2), ...block('Hauptteil', n, [step('Zügig', '4m', pace(rp, 0.05)), step('Trabpause', '2m', HR.z1)]), step('Auslaufen', m(rest(w + n * 6)), HR.z2));
  } else if (t === 'Wettkampftempo') {
    const n = fit(total, 25, rp + 2, 3, 6); out.push(step('Einlaufen', '15m', HR.z2), ...block('Hauptteil', n, [step('Wettkampftempo', '1km', pace(rp, 0.05)), step('Trabpause', '2m', HR.z1)]), step('Auslaufen', m(rest(15 + n * (rp + 2))), HR.z2));
  } else if (t === 'Wettkampftempo-Block') {
    const k = Math.max(12, Math.min(20, Math.floor((total - 25) / 2) - 4)); out.push(step('Einlaufen', '15m', HR.z2), ...block('Hauptteil', 2, [step('Wettkampftempo', m(k), pace(rp, 0.05)), step('Locker', '4m', HR.z2)]), step('Auslaufen', m(rest(15 + 2 * (k + 4))), HR.z2));
  } else if (t === 'Intervalle') {
    const n = fit(total, 25, 5, 3, 6); out.push(step('Einlaufen', '15m', HR.z2), ...block('Hauptteil', n, [step('Intervall', '3m', pace(p.interval, 0.06)), step('Trabpause', '2m', HR.z1)]), step('Auslaufen', m(rest(15 + n * 5)), HR.z2));
  } else if (t === 'Schwelle') {
    const n = fit(total, 25, 10, 2, 3); out.push(step('Einlaufen', '15m', HR.z2), ...block('Hauptteil', n, [step('Schwelle', '8m', pace(p.threshold, 0.06)), step('Trabpause', '2m', HR.z1)]), step('Auslaufen', m(rest(15 + n * 10)), HR.z2));
  } else if (t === 'Tempodauerlauf') {
    const k = Math.max(10, Math.min(25, total - 25)); out.push(step('Einlaufen', '15m', HR.z2), step('Tempo', m(k), pace(p.threshold + 0.1, 0.06)), step('Auslaufen', m(rest(15 + k)), HR.z2));
  } else if (t === 'Bergintervalle') {
    const n = fit(total, 20, 5.5, 4, 8); out.push(step('Einlaufen', '15m', HR.z2), ...block('Bergauf', n, [step('Zügig bergauf', '2m30s', HR.z4), step('Locker bergab', '3m', HR.z1)]), step('Locker', m(rest(15 + n * 5.5)), HR.z2));
  } else if (t === 'Bergintervalle lang') {
    const n = fit(total, 20, 10, 3, 5); out.push(step('Einlaufen', '15m', HR.z2), ...block('Bergauf', n, [step('Zügig bergauf', '6m', HR.z34), step('Locker zurück', '4m', HR.z1)]), step('Locker', m(rest(15 + n * 10)), HR.z2));
  } else if (t === 'Langer Lauf' && /Wettkampftempo/.test(s.details) && p.race) {
    out.push(step('Locker', m(total - 35), HR.z2), step('Wettkampftempo', '35m', pace(p.race, 0.05)));
  } else if (/Koppellauf/.test(t)) {
    out.push(step('Wettkampfgefühl', m(Math.min(10, total / 2)), pace(p.race ?? p.threshold + 0.1, 0.08)), step('Locker', m(total - Math.min(10, total / 2)), HR.z2));
  } else if (/Lang|Langer/.test(t)) {
    out.push(step('Locker', m(total), HR.z2));
  } else {
    out.push(step('Gleichmäßig', m(total), s.intensity === 'hart' ? HR.z3 : HR.z23));
  }
  return [s.details, '', ...out].join('\n');
}
