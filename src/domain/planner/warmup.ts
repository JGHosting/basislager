/**
 * Aufwärmen vor geplanten Einheiten. Rein regelbasiert, wie der Rest des Planers:
 * "Auto" wärmt vor Kraft und vor jeder nicht-lockeren Ausdauereinheit auf (Intervalle, Tempo, hart/mittel),
 * nicht vor lockeren Grundlageneinheiten. Nach dem Training wird bewusst nichts eingeplant.
 */
import type { PlanSession, PlanSport } from './plan';
import type { MuscleGroup } from '../../core/db';
import { getSetting, setSetting } from '../../core/db';

export type WarmupMode = 'aus' | 'auto' | 'immer';
export type WarmupCategory = 'kraft' | 'lauf' | 'rad' | 'schwimmen';
export const WARMUP_LABEL: Record<WarmupCategory, string> = { kraft: 'Kraft', lauf: 'Laufen', rad: 'Radfahren', schwimmen: 'Schwimmen' };
export const WARMUP_MODE_LABEL: Record<WarmupMode, string> = { aus: 'Aus', auto: 'Auto', immer: 'Immer' };

export type WarmupSettings = Record<WarmupCategory, WarmupMode>;
export const DEFAULT_WARMUP_SETTINGS: WarmupSettings = { kraft: 'auto', lauf: 'auto', rad: 'auto', schwimmen: 'auto' };

const KEY = 'warmup';
export async function getWarmupSettings(): Promise<WarmupSettings> { return { ...DEFAULT_WARMUP_SETTINGS, ...(await getSetting<Partial<WarmupSettings>>(KEY)) }; }
export async function saveWarmupSettings(s: WarmupSettings) { await setSetting(KEY, s); }

export function warmupCategory(sport: PlanSport): WarmupCategory | null {
  if (sport === 'kraft') return 'kraft';
  if (sport === 'lauf' || sport === 'trail') return 'lauf';
  if (sport === 'rad') return 'rad';
  if (sport === 'schwimmen') return 'schwimmen';
  return null;   // gehen, wettkampf: kein automatisches Aufwärmen
}
/** "Intensiv" im Sinne der Auto-Regel: Kraft immer, sonst alles außer lockeren Ausdauereinheiten. */
export const isIntense = (s: PlanSession) => s.sport === 'kraft' || s.intensity !== 'locker';

export interface Warmup { minutes: number; items: string[] }
const legs = (g?: MuscleGroup[]) => !!g?.some(x => x === 'beine' || x === 'ganzkoerper');
const upper = (g?: MuscleGroup[]) => !!g?.some(x => x === 'push' || x === 'pull' || x === 'arme' || x === 'ganzkoerper');
const core = (g?: MuscleGroup[]) => !!g?.some(x => x === 'rumpf' || x === 'ganzkoerper');

/** Baut den Aufwärm-Inhalt passend zur Einheit (z. B. Beine vor Kniebeugen). */
export function buildWarmup(s: PlanSession): Warmup | null {
  const cat = warmupCategory(s.sport);
  if (cat === 'kraft') {
    const items = ['2 Min. leicht einlaufen oder Rad, Puls hoch'];
    if (legs(s.groups)) items.push('Hüfte: Beinschwingen vor/zurück und seitlich, je 10×', 'Kniebeuge-Halt, 30 s');
    if (upper(s.groups)) items.push('Schultern: Wandschieben (Wall Slides), 10×', 'Armkreisen, je 10× pro Richtung');
    if (core(s.groups)) items.push('Rumpf: Dead Bug, 8× je Seite');
    if (items.length === 1) items.push('Gelenke locker durchbewegen: Schultern, Hüfte, Knie.');
    return { minutes: 4, items };
  }
  if (cat === 'lauf') return { minutes: 3, items: ['Beinschwingen vor/zurück, 10× je Seite', 'Beinschwingen seitlich, 10× je Seite', 'Hüftbeuger-Wippen im Halbkniestand, 8× je Seite'] };
  if (cat === 'rad') return { minutes: 3, items: ['Hüftbeuger-Wippen im Halbkniestand, 8× je Seite', 'Katze-Kuh, 10×', 'Beinschwingen seitlich, 10× je Seite'] };
  if (cat === 'schwimmen') return { minutes: 3, items: ['Armkreisen groß, je 10× pro Richtung', 'Wandschieben (Wall Slides), 10×', 'Rumpfdrehungen, 10×'] };
  return null;
}

/** Ergebnis für eine Einheit: Einstellung (Override oder Kategorie-Standard) + ggf. Inhalt. */
export function resolveWarmup(s: PlanSession, settings: WarmupSettings, override?: WarmupMode): Warmup | null {
  const cat = warmupCategory(s.sport);
  if (!cat) return null;
  const mode = override ?? settings[cat];
  if (mode === 'aus') return null;
  if (mode === 'immer') return buildWarmup(s);
  return isIntense(s) ? buildWarmup(s) : null;
}
