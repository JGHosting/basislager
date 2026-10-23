/**
 * Mobility-Einstellungen (ein JSON-Setting, wie bei 'sports'/'hrMax') + Streak/Pausen-Verlauf.
 */
import { getSetting, setSetting } from '../../core/db';
import type { GoalId } from './library';
import { today, addDays } from '../../core/dates';

export type Intrusiveness = 'aus' | 'sanft' | 'hartnaeckig' | 'brutal';
export interface CustomGoal { id: string; label: string }
export interface GoalWeight { id: GoalId | string; weight: 1 | 2 | 3 }

export interface MobilitySettings {
  minutes: 5 | 10 | 15;
  time: string;                // "HH:mm", nur informativ (Auslöser ist weiterhin die Garmin-Morgenmeldung)
  goals: GoalWeight[];
  customGoals: CustomGoal[];
  intrusiveness: Intrusiveness;
  pauseMode: boolean;
  pauseAuto: boolean;           // true = zuletzt automatisch (Verletzungsstufe "Pause") gesetzt, nicht manuell
  level: 0 | 1 | 2;
  testIntervalWeeks: number;
  rotationIdx: number;          // Fortschritt durch die Regionen-Rotation
}
export const DEFAULT_SETTINGS: MobilitySettings = {
  minutes: 10, time: '07:00',
  goals: [{ id: 'hohlkreuz', weight: 2 }],
  customGoals: [],
  intrusiveness: 'hartnaeckig',
  pauseMode: false, pauseAuto: false,
  level: 0, testIntervalWeeks: 3, rotationIdx: 0
};

const KEY = 'mobility';
export async function getMobilitySettings(): Promise<MobilitySettings> {
  const s = await getSetting<Partial<MobilitySettings>>(KEY);
  return { ...DEFAULT_SETTINGS, ...s, goals: s?.goals ?? DEFAULT_SETTINGS.goals, customGoals: s?.customGoals ?? [] };
}
export async function saveMobilitySettings(patch: Partial<MobilitySettings>) {
  const cur = await getMobilitySettings();
  const next = { ...cur, ...patch };
  await setSetting(KEY, next);
  return next;
}

/** Zeiträume, in denen der Pausenmodus aktiv war (für die Streak-Berechnung). */
export interface PauseRange { start: string; end?: string }
const PAUSE_KEY = 'mobilityPauseRanges';
export async function getPauseRanges(): Promise<PauseRange[]> { return (await getSetting<PauseRange[]>(PAUSE_KEY)) ?? []; }
export async function setPauseMode(on: boolean, auto = false) {
  const ranges = await getPauseRanges();
  const open = ranges.find(r => !r.end);
  if (on && !open) ranges.push({ start: today() });
  if (!on && open) open.end = addDays(today(), -1);   // der heutige Tag selbst zählt noch als pausiert
  await setSetting(PAUSE_KEY, ranges);
  await saveMobilitySettings({ pauseMode: on, pauseAuto: auto });
}
export function dayWasPaused(ranges: PauseRange[], date: string): boolean {
  return ranges.some(r => date >= r.start && (!r.end || date <= r.end));
}
