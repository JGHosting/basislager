/**
 * Ausdauer-Sportarten im Plan (zusätzlich zum Kraftsport).
 * Je Sportart: Einheiten pro Woche (0–5) und Ziel – nur Grundlage (Zone 2) oder Leistung (zusätzlich Tempo/Intervalle).
 * Die Hauptsportart bekommt die besten Tage (langer Samstag, Qualitätstag Donnerstag).
 * Reine Funktionen, gespeichert als Einstellung 'sports' (wandert damit automatisch ins Backup).
 */
export type EnduranceSport = 'lauf' | 'rad' | 'schwimmen';
export type SportMode = 'grundlage' | 'leistung';
export interface SportConfig { sport: EnduranceSport; perWeek: number; mode: SportMode }
export interface SportsSetting { main: EnduranceSport; list: SportConfig[] }

export const SPORTS: { id: EnduranceSport; label: string; unit: string }[] = [
  { id: 'lauf', label: 'Laufen', unit: 'Läufe' },
  { id: 'rad', label: 'Radfahren', unit: 'Ausfahrten' },
  { id: 'schwimmen', label: 'Schwimmen', unit: 'Einheiten' }
];
export const sportLabel = (s: EnduranceSport) => SPORTS.find(x => x.id === s)!.label;
export const MAX_PER_WEEK = 5;

/** Standard bzw. Übernahme der alten Einstellung „Läufe pro Woche (2/3)“. */
export function defaultSports(runsPerWeek?: number | null): SportsSetting {
  return { main: 'lauf', list: [{ sport: 'lauf', perWeek: runsPerWeek ?? 3, mode: 'leistung' }] };
}

/** Bereinigt eine gespeicherte Einstellung (fehlende Sportarten ergänzen, Werte begrenzen, Hauptsportart gültig halten). */
export function normalizeSports(raw: Partial<SportsSetting> | null | undefined, runsPerWeek?: number | null): SportsSetting {
  const base = raw?.list?.length ? raw : defaultSports(runsPerWeek);
  const list: SportConfig[] = SPORTS.map(({ id }) => {
    const c = base.list!.find(x => x.sport === id);
    return { sport: id, perWeek: Math.max(0, Math.min(MAX_PER_WEEK, Math.round(c?.perWeek ?? 0))), mode: c?.mode === 'grundlage' ? 'grundlage' : 'leistung' };
  });
  const active = list.filter(c => c.perWeek > 0);
  let main = base.main && list.some(c => c.sport === base.main) ? base.main : 'lauf';
  if (active.length && !active.some(c => c.sport === main)) main = active[0].sport;
  return { main, list };
}

/** Aktive Sportarten, Hauptsportart zuerst. */
export const activeSports = (s: SportsSetting) =>
  s.list.filter(c => c.perWeek > 0).sort((a, b) => Number(b.sport === s.main) - Number(a.sport === s.main));

/** Kurztext, z. B. „3× Laufen · 2× Rad (Grundlage)“. */
export function sportsSummary(s: SportsSetting): string {
  const a = activeSports(s);
  if (!a.length) return 'keine Ausdauer';
  const short: Record<EnduranceSport, string> = { lauf: 'Laufen', rad: 'Rad', schwimmen: 'Schwimmen' };
  return a.map(c => `${c.perWeek}× ${short[c.sport]}${c.mode === 'grundlage' ? ' (Grundlage)' : ''}`).join(' · ');
}

/**
 * Rollen der Einheiten einer Sportart pro Woche.
 * Leistung: höchstens 2 Qualitätseinheiten (ca. 80/20), ab 2 Einheiten eine lange.
 * Grundlage: nur Zone 2, ab 2 Einheiten eine davon länger.
 */
export type Role = 'easy' | 'q' | 'q2' | 'long';
export function rolesFor(c: SportConfig): Role[] {
  const n = c.perWeek;
  if (c.mode === 'grundlage') return n === 0 ? [] : n === 1 ? ['easy'] : ['long', ...Array<Role>(n - 1).fill('easy')];
  return ([[], ['q'], ['q', 'long'], ['easy', 'q', 'long'], ['easy', 'q', 'easy', 'long'], ['easy', 'q', 'easy', 'q2', 'long']] as Role[][])[Math.min(n, 5)];
}
/** Anteil am Wochenumfang je Rolle (lang etwas mehr). */
export const ROLE_WEIGHT: Record<Role, number> = { easy: 1, q: 1, q2: 0.9, long: 4 / 3 };
