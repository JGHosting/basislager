/**
 * Tagesampel (Erholungsscore 0–100) aus HRV, Sleep Score und Ruhepuls.
 *
 * Baseline: die 14 Tage VOR dem betrachteten Tag (mind. 5 Werte), je Kennzahl Mittelwert und Streuung.
 * Punkte je Kennzahl:
 *   HRV:      70 + 15 × z         (z = Abweichung in Standardabweichungen; höher = besser)
 *   Ruhepuls: 70 − 15 × z         (höher = schlechter)
 *   Schlaf:   Garmin Sleep Score direkt
 * Gewichtung: HRV 45 %, Schlaf 30 %, Ruhepuls 25 % – fehlende Werte werden herausgerechnet.
 * Abzug durch Belastung: −10 bei Form < −25, −10 bei Belastungsverhältnis > 1,5.
 * Ampel: grün ≥ 60, gelb 40–59, rot < 40.
 */
import type { MorningEntry } from '../../core/db';
import { addDays } from '../../core/dates';
import type { LoadDay } from '../load/load';

export const RECOVERY = {
  baselineDays: 14, minBaseline: 5,
  weights: { hrv: 0.45, sleepScore: 0.30, restingHr: 0.25, pain: 0.30 },
  green: 60, yellow: 40,
  minSdFraction: 0.05,                     // Streuung mind. 5 % des Mittelwerts (verhindert Überreaktion)
  tsbPenaltyBelow: -25, acwrPenaltyAbove: 1.5, penalty: 10
};

export type Light = 'gruen' | 'gelb' | 'rot' | 'grau';
export interface Component {
  key: 'hrv' | 'sleepScore' | 'restingHr' | 'pain'; label: string;
  value: number | null; baseline: number | null; z: number | null; points: number | null; weight: number;
}
export interface Recovery {
  date: string; score: number | null; light: Light;
  used: number; total: number;            // "basiert auf X von 3 Werten"
  buildingBaseline: boolean;
  components: Component[];
  penalties: { label: string; points: number }[];
  advice: string;
}

const clamp = (v: number) => Math.max(0, Math.min(100, v));
function stats(vals: number[]) {
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
  return { mean, sd: Math.max(sd, mean * RECOVERY.minSdFraction) };
}

/** injuryActive: Schmerz (0–10) fließt nur während einer aktiven Verletzung ein: 100 − 10 × Schmerz. */
export function computeRecovery(date: string, entries: MorningEntry[], load?: LoadDay, injuryActive = false): Recovery {
  const today = entries.find(e => e.date === date);
  const from = addDays(date, -RECOVERY.baselineDays);
  const base = entries.filter(e => e.date >= from && e.date < date);
  const defs: [Component['key'], string][] = [['hrv', 'HRV'], ['sleepScore', 'Sleep Score'], ['restingHr', 'Ruhepuls']];
  let buildingBaseline = false;

  const components: Component[] = defs.map(([key, label]) => {
    const value = today?.[key] ?? null;
    const weight = RECOVERY.weights[key];
    if (value == null) return { key, label, value, baseline: null, z: null, points: null, weight };
    if (key === 'sleepScore') return { key, label, value, baseline: null, z: null, points: clamp(value), weight };
    const hist = base.map(e => e[key]).filter((v): v is number => v != null);
    if (hist.length < RECOVERY.minBaseline) { buildingBaseline = true; return { key, label, value, baseline: null, z: null, points: null, weight }; }
    const { mean, sd } = stats(hist);
    const z = (value - mean) / sd;
    const points = clamp(key === 'hrv' ? 70 + 15 * z : 70 - 15 * z);
    return { key, label, value, baseline: mean, z, points, weight };
  });

  if (injuryActive) {
    const pain = today?.pain ?? null;
    components.push({ key: 'pain', label: 'Schmerz', value: pain, baseline: null, z: null, points: pain == null ? null : clamp(100 - 10 * pain), weight: RECOVERY.weights.pain });
  }
  const scored = components.filter(c => c.points != null);
  const used = components.filter(c => c.value != null).length;
  const penalties: Recovery['penalties'] = [];
  if (load) {
    if (load.tsb < RECOVERY.tsbPenaltyBelow) penalties.push({ label: `Hohe Ermüdung (Form ${Math.round(load.tsb)})`, points: -RECOVERY.penalty });
    if (load.ctl > 5 && load.atl / load.ctl > RECOVERY.acwrPenaltyAbove)
      penalties.push({ label: `Belastungssprung (Verhältnis ${(load.atl / load.ctl).toFixed(1).replace('.', ',')})`, points: -RECOVERY.penalty });
  }

  let score: number | null = null;
  if (scored.length) {
    const wsum = scored.reduce((s, c) => s + c.weight, 0);
    score = scored.reduce((s, c) => s + c.points! * c.weight, 0) / wsum;
    score = clamp(score + penalties.reduce((s, p) => s + p.points, 0));
  }
  let light: Light = score == null ? 'grau' : score >= RECOVERY.green ? 'gruen' : score >= RECOVERY.yellow ? 'gelb' : 'rot';
  // Deutlicher Schmerz deckelt die Ampel: ab 4 höchstens gelb, ab 7 rot
  const pain = components.find(c => c.key === 'pain')?.value;
  if (pain != null && pain >= 7) { light = 'rot'; penalties.push({ label: 'Schmerz ≥ 7 → Ampel rot', points: 0 }); }
  else if (pain != null && pain >= 4 && light === 'gruen') { light = 'gelb'; penalties.push({ label: 'Schmerz ≥ 4 → Ampel höchstens gelb', points: 0 }); }
  const advice = {
    gruen: 'Gut erholt. Training wie geplant.',
    gelb: 'Etwas angeschlagen. Intensität reduzieren: lieber locker oder kürzer.',
    rot: 'Wenig erholt. Ruhetag oder nur sehr locker bewegen.',
    grau: used ? 'Noch zu wenig Daten für eine Bewertung.' : 'Noch keine Nachtwerte für heute.'
  }[light];
  return { date, score: score == null ? null : Math.round(score), light, used, total: components.length, buildingBaseline, components, penalties, advice };
}
