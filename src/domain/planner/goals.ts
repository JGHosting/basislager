/** Wettkampfziele: Distanzen, Empfehlung für den Planstart, Paces. */
import type { Goal, GoalSport, TriDistance } from '../../core/db';
import { addDays, weekStart } from '../../core/dates';

export const SPORTS: { id: GoalSport; label: string; hasElevation: boolean }[] = [
  { id: 'lauf', label: 'Laufen (Straße)', hasElevation: false },
  { id: 'trailrun', label: 'Trailrun', hasElevation: true },
  { id: 'rad', label: 'Radrennen', hasElevation: true },
  { id: 'schwimmen', label: 'Schwimmen', hasElevation: false },
  { id: 'triathlon', label: 'Triathlon', hasElevation: false }
];
export const DISTANCE_PRESETS: Record<Exclude<GoalSport, 'triathlon'>, { label: string; km: number }[]> = {
  lauf: [{ label: '5 km', km: 5 }, { label: '10 km', km: 10 }, { label: 'Halbmarathon', km: 21.0975 }, { label: 'Marathon', km: 42.195 }],
  trailrun: [{ label: '15 km', km: 15 }, { label: '25 km', km: 25 }, { label: '42 km', km: 42 }, { label: '70 km', km: 70 }],
  rad: [{ label: '60 km', km: 60 }, { label: '100 km', km: 100 }, { label: '160 km', km: 160 }, { label: '200 km', km: 200 }],
  schwimmen: [{ label: '1,5 km', km: 1.5 }, { label: '3,8 km', km: 3.8 }, { label: '5 km', km: 5 }]
};
export const TRI: Record<TriDistance, { label: string; swim: number; bike: number; run: number }> = {
  sprint: { label: 'Sprint', swim: 0.75, bike: 20, run: 5 },
  olympisch: { label: 'Olympisch', swim: 1.5, bike: 40, run: 10 },
  '70.3': { label: 'Mitteldistanz (70.3)', swim: 1.9, bike: 90, run: 21.1 },
  lang: { label: 'Langdistanz', swim: 3.8, bike: 180, run: 42.2 }
};

export function goalLabel(g: Goal): string {
  if (g.name) return g.name;
  if (g.sport === 'triathlon') return `Triathlon ${TRI[g.triDistance ?? 'olympisch'].label}`;
  const preset = DISTANCE_PRESETS[g.sport].find(p => Math.abs(p.km - (g.distanceKm ?? 0)) < 0.2);
  const sp = SPORTS.find(s => s.id === g.sport)!.label.replace(' (Straße)', '');
  return `${sp} ${preset ? preset.label : (g.distanceKm ?? 0).toLocaleString('de-DE') + ' km'}${g.elevation ? ` · ${g.elevation} hm` : ''}`;
}

/** Ideale Vorbereitungsdauer in Wochen (Faustregeln aus der Trainingslehre, plus Zuschlag bei wenig Grundlage). */
export function recommendedWeeks(g: Pick<Goal, 'sport' | 'distanceKm' | 'triDistance' | 'elevation'>, lowBase: boolean): number {
  const km = g.distanceKm ?? 0;
  let w: number;
  switch (g.sport) {
    case 'lauf': w = km <= 5.5 ? 8 : km <= 11 ? 10 : km <= 22 ? 12 : 18; break;
    case 'trailrun': w = km <= 25 ? 12 : km <= 45 ? 16 : 20; if ((g.elevation ?? 0) > 2000) w += 2; break;
    case 'rad': w = km <= 80 ? 10 : km <= 160 ? 14 : 16; if ((g.elevation ?? 0) > 2000) w += 2; break;
    case 'schwimmen': w = km <= 2 ? 8 : 12; break;
    case 'triathlon': w = { sprint: 10, olympisch: 12, '70.3': 16, lang: 24 }[g.triDistance ?? 'olympisch']; break;
  }
  return w + (lowBase ? 3 : 0);
}
export function recommendedStart(g: Pick<Goal, 'sport' | 'distanceKm' | 'triDistance' | 'elevation' | 'date'>, lowBase: boolean, today: string) {
  const weeks = recommendedWeeks(g, lowBase);
  const ideal = weekStart(addDays(g.date, -7 * (weeks - 1)));
  const start = ideal < weekStart(today) ? weekStart(today) : ideal;
  return { weeks, ideal, start, tooLate: ideal < weekStart(today) };
}

/* ---------- Zeiten & Paces ---------- */
export function parseTime(s: string): number | null {
  const p = s.trim(); if (!p) return null;
  const parts = p.split(':').map(Number);
  if (parts.some(n => !Number.isFinite(n) || n < 0)) return NaN;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 3600 + parts[1] * 60;          // h:mm
  return parts[0] * 60;                                                     // Minuten
}
export function fmtTime(sec: number | null | undefined): string {
  if (sec == null) return 'egal';
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.round(sec % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
/** min/km als "5:12". */
export function fmtPace(minPerKm: number): string {
  const m = Math.floor(minPerKm), s = Math.round((minPerKm - m) * 60);
  return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, '0')}`;
}
