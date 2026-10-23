/**
 * Auswertungen für die Verlauf-Ansicht im Mobility-Tab: Kalender, Kennzahlen, Selbsttest-Kurven.
 */
import { db } from '../../core/db';
import { regionScore } from './tests';
import { REGIONS, type Region } from './library';
import { completion, DONE_THRESHOLD } from './repo';
import { getPauseRanges, dayWasPaused } from './settings';

export type DayState = 'done' | 'partial' | 'skipped' | 'paused';

export interface MobilityTotals { daysDone: number; minutes: number; exercises: number; bestStreak: number }

/** Status je Tag (nur Tage mit Eintrag oder Pause) im Zeitraum [from, to]. */
export async function dayStates(from: string, to: string): Promise<Record<string, DayState>> {
  const rows = await db.mobilityLog.where('date').between(from, to, true, true).toArray();
  const ranges = await getPauseRanges();
  const out: Record<string, DayState> = {};
  for (const r of rows) {
    if (r.minutes === 0) { out[r.date] = 'skipped'; continue; }
    const c = completion(r);
    if (c >= DONE_THRESHOLD) out[r.date] = 'done';
    else if (c > 0) out[r.date] = 'partial';
  }
  // Pausentage markieren (sofern nicht trotzdem erledigt)
  for (const p of ranges) {
    const start = p.start < from ? from : p.start;
    const end = !p.end || p.end > to ? to : p.end;
    for (let d = start; d <= end; d = nextDay(d)) if (!out[d] && dayWasPaused(ranges, d)) out[d] = 'paused';
  }
  return out;
}
function nextDay(d: string): string {
  const [y, m, dd] = d.split('-').map(Number);
  const t = new Date(y, m - 1, dd + 1);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

export async function totals(): Promise<MobilityTotals> {
  const rows = (await db.mobilityLog.toArray()).sort((a, b) => a.date.localeCompare(b.date));
  let daysDone = 0, minutes = 0, exercises = 0, best = 0, run = 0, prev = '';
  for (const r of rows) {
    if (r.minutes === 0) { run = 0; prev = r.date; continue; }
    const c = completion(r);
    exercises += r.items.filter(i => i.done).length;
    minutes += Math.round(r.minutes * c);
    if (c >= DONE_THRESHOLD) {
      daysDone++;
      run = prev && nextDay(prev) === r.date ? run + 1 : 1;
      best = Math.max(best, run);
    } else run = 0;
    prev = r.date;
  }
  return { daysDone, minutes, exercises, bestStreak: best };
}

/** Selbsttest-Werte je Region (0–1) über die Zeit. */
export async function testSeries(): Promise<{ dates: string[]; regions: { id: Region; label: string; values: (number | null)[] }[] }> {
  const rows = await db.mobilityTests.orderBy('date').toArray();
  const scores = rows.map(r => regionScore(r.results));
  return {
    dates: rows.map(r => r.date),
    regions: REGIONS.map(r => ({ id: r.id, label: r.label, values: scores.map(s => s[r.id] ?? null) }))
      .filter(r => r.values.some(v => v != null))
  };
}
