/** Anzeige-Helfer (nur Darstellung, keine Logik). */
const SPORT: Record<string, string> = {
  Run: 'Laufen', TrailRun: 'Trailrun', VirtualRun: 'Laufen indoor', Ride: 'Rad', VirtualRide: 'Rad indoor',
  GravelRide: 'Gravel', MountainBikeRide: 'MTB', EBikeRide: 'E-Bike', Swim: 'Schwimmen', OpenWaterSwim: 'Freiwasser',
  WeightTraining: 'Kraft', Workout: 'Workout', Hike: 'Wandern', Walk: 'Gehen', AlpineSki: 'Ski',
  BackcountrySki: 'Skitour', NordicSki: 'Langlauf', Snowboard: 'Snowboard', RockClimbing: 'Klettern',
  Yoga: 'Yoga', Rowing: 'Rudern', Elliptical: 'Crosstrainer', StandUpPaddling: 'SUP'
};
export const sportName = (t: string) => SPORT[t] ?? t;

/** Sportfamilie → Farbe (für kleine Markierungen). */
export function sportColor(t: string): string {
  if (/Run|Walk/.test(t)) return 'var(--c-run)';
  if (/Ride/.test(t)) return 'var(--c-ride)';
  if (/Swim/.test(t)) return 'var(--c-swim)';
  if (/Weight|Workout|Yoga|Elliptical/.test(t)) return 'var(--c-strength)';
  if (/Ski|Snowboard/.test(t)) return 'var(--c-snow)';
  if (/Hike|Climb/.test(t)) return 'var(--c-mountain)';
  return 'var(--c-other)';
}

export function dur(s: number | null | undefined): string {
  if (!s) return '–';
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
}
export const km = (m: number | null | undefined, digits = 1) =>
  m ? (m / 1000).toLocaleString('de-DE', { maximumFractionDigits: digits }) + ' km' : '';
export const num = (v: number | null | undefined, digits = 0) =>
  v == null ? '–' : v.toLocaleString('de-DE', { maximumFractionDigits: digits });
export const hours = (s: number | null | undefined) =>
  s == null ? '–' : (s / 3600).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' h';

/** Tempo aus Geschwindigkeit (m/s) als mm:ss pro km. */
export function paceStr(mps: number): string {
  const min = 1000 / mps / 60, m = Math.floor(min), s = Math.round((min - m) * 60);
  return `${s === 60 ? m + 1 : m}:${String(s === 60 ? 0 : s).padStart(2, '0')}`;
}
export const speedStr = (mps: number) => (mps * 3.6).toLocaleString('de-DE', { maximumFractionDigits: 1 });
const isFoot = (t: string) => /Run|Walk|Hike|Snowshoe/.test(t);
/** Kurze Fakten für die Aktivitätsliste: Distanz, Tempo/Pace, Puls, Höhe. */
export function activityFacts(a: { sportType: string; distance: number | null; duration: number | null; elapsed: number | null; avgHr: number | null }, elev: number | null): string[] {
  const out: string[] = [];
  const dist = a.distance, sec = a.duration ?? a.elapsed;
  if (dist && dist > 0) out.push(km(dist));
  if (dist && sec && dist > 50) out.push(isFoot(a.sportType) ? paceStr(dist / sec) + ' /km' : speedStr(dist / sec) + ' km/h');
  if (a.avgHr) out.push('♥ ' + Math.round(a.avgHr));
  if (elev && elev >= 20) out.push(Math.round(elev) + ' hm');
  return out;
}
