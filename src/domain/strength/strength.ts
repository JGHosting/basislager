/**
 * Kraft-Split: Muskelgruppen statt Übungen.
 * - Krafttrainings aus Garmin (WeightTraining) werden erkannt und warten auf Zuordnung.
 * - Pro Gruppe: wann zuletzt, wie hart, ist sie wieder erholt?
 * - Warnung bei Schieflagen ("Pull seit 12 Tagen nicht trainiert").
 * - Nächster Tag der aktiven Split-Vorlage wird vorgeschlagen.
 * Reine Funktionen (ohne Datenbank) → später in den Planer und eine native App übertragbar.
 */
import type { Activity, StrengthSession, SplitTemplate, MuscleGroup } from '../../core/db';
import { addDays } from '../../core/dates';

export const GROUPS: { id: MuscleGroup; label: string; hint: string }[] = [
  { id: 'push', label: 'Push', hint: 'Brust, Schulter, Trizeps' },
  { id: 'pull', label: 'Pull', hint: 'Rücken, Bizeps' },
  { id: 'beine', label: 'Beine', hint: 'Oberschenkel, Po, Waden' },
  { id: 'rumpf', label: 'Rumpf', hint: 'Bauch, unterer Rücken' },
  { id: 'ganzkoerper', label: 'Ganzkörper', hint: 'alles in einer Einheit' }
];
/** Die vier "echten" Gruppen; Ganzkörper zählt für alle vier. */
export const CORE_GROUPS: MuscleGroup[] = ['push', 'pull', 'beine', 'rumpf'];
export const groupLabel = (g: MuscleGroup) => GROUPS.find(x => x.id === g)?.label ?? g;
export const coversGroup = (s: StrengthSession, g: MuscleGroup) => s.muscleGroups.includes(g) || s.muscleGroups.includes('ganzkoerper');

export const isStrengthActivity = (a: Activity) => a.sportType === 'WeightTraining';

/** Krafttrainings der letzten 14 Tage, die noch keiner Einheit zugeordnet sind. Ältere bleiben in Ruhe. */
export function openStrengthActivities(activities: Activity[], sessions: StrengthSession[], today: string): Activity[] {
  const linked = new Set(sessions.map(s => s.activityId).filter(Boolean));
  const since = addDays(today, -14);
  return activities.filter(a => isStrengthActivity(a) && a.date >= since && !linked.has(a.id)).sort((a, b) => b.start.localeCompare(a.start));
}

/** Erholungsfenster in Stunden: Basis 48 h, Beine 72 h; sehr harte Einheit (≥ 8) +24 h, lockere (≤ 4) −24 h. */
export function recoveryHours(g: MuscleGroup, intensity: number | null): number {
  let h = g === 'beine' ? 72 : 48;
  if (intensity != null && intensity >= 8) h += 24;
  if (intensity != null && intensity <= 4) h -= 24;
  return Math.max(24, h);
}

export interface GroupStatus {
  group: MuscleGroup; lastDate: string | null; daysAgo: number | null; intensity: number | null;
  recovered: boolean; readyIn: number | null;   // Stunden bis erholt
}

/** Status je Gruppe. "Jetzt" = Mittag des heutigen Tages (Einheiten haben nur ein Datum, keine Uhrzeit). */
export function groupStatus(sessions: StrengthSession[], activities: Activity[], today: string, nowMs = Date.now()): GroupStatus[] {
  const startOf = new Map(activities.map(a => [a.id, a.start]));
  const done = sessions.filter(s => !s.skipped && s.muscleGroups.length);
  return CORE_GROUPS.map(g => {
    const last = done.filter(s => coversGroup(s, g)).sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!last) return { group: g, lastDate: null, daysAgo: null, intensity: null, recovered: true, readyIn: null };
    const startIso = (last.activityId && startOf.get(last.activityId)) || last.date + 'T18:00:00';
    const [d, t] = startIso.split('T'); const [y, m, dd] = d.split('-').map(Number); const [hh, mm] = (t ?? '18:00').split(':').map(Number);
    const hoursSince = (nowMs - new Date(y, m - 1, dd, hh, mm).getTime()) / 3600000;
    const need = recoveryHours(g, last.intensity);
    const daysAgo = Math.round((Date.parse(today) - Date.parse(last.date)) / 86400000);
    return { group: g, lastDate: last.date, daysAgo, intensity: last.intensity, recovered: hoursSince >= need, readyIn: hoursSince >= need ? null : Math.ceil(need - hoursSince) };
  });
}

/**
 * Schieflagen: Gruppe, die in den letzten 60 Tagen trainiert wurde (also zur Routine gehört)
 * bzw. Teil des aktiven Splits ist, aber seit über 10 Tagen nicht mehr.
 */
export function neglectWarnings(status: GroupStatus[], sessions: StrengthSession[], split: SplitTemplate | null, today: string): string[] {
  const active = sessions.filter(s => !s.skipped && s.date >= addDays(today, -60));
  if (!active.length) return [];
  const inSplit = new Set(split ? split.days.flat().flatMap(g => (g === 'ganzkoerper' ? CORE_GROUPS : [g])) : []);
  return status
    .filter(st => (inSplit.size ? inSplit.has(st.group) : active.some(s => coversGroup(s, st.group))))
    .filter(st => st.daysAgo == null || st.daysAgo > 10)
    .map(st => st.daysAgo == null ? `${groupLabel(st.group)} wurde noch nie eingetragen.` : `${groupLabel(st.group)} seit ${st.daysAgo} Tagen nicht trainiert.`);
}

/** Nächster Tag der Split-Vorlage: nach dem Tag, der zur letzten Einheit passt. */
export function nextSplitDay(split: SplitTemplate, sessions: StrengthSession[]): { index: number; groups: MuscleGroup[] } {
  const last = sessions.filter(s => !s.skipped && s.muscleGroups.length).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)[0];
  if (!last) return { index: 0, groups: split.days[0] };
  const same = (a: MuscleGroup[], b: MuscleGroup[]) => a.length === b.length && a.every(x => b.includes(x));
  let idx = split.days.findIndex(d => same(d, last.muscleGroups));
  if (idx < 0) idx = split.days.findIndex(d => d.some(g => last.muscleGroups.includes(g)));
  const next = (idx + 1) % split.days.length;
  return { index: next, groups: split.days[next] };
}
