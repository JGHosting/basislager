/** Planer: Daten laden/speichern. */
import { db, getSetting, setSetting, type Goal, type FixedEvent, type PlanEdit } from '../../core/db';
import { newId } from '../../core/ids';
import { today, weekStart, addDays } from '../../core/dates';
import { activeInjury } from '../injury/injury';
import { buildWeek, type PlanContext, type PlanWeek, type PlanSession } from './plan';

const plain = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

/** Aktives Ziel: das nächste, nicht archivierte, dessen Datum noch nicht vorbei ist. */
export async function activeGoal(): Promise<Goal | null> {
  const t = today();
  return (await db.goals.toArray()).filter(g => !g.archived && g.date >= t).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
}

export async function loadContext(): Promise<PlanContext> {
  const [activities, strength, splitId, goal, injuries, events, edits, runs] = await Promise.all([
    db.activities.toArray(), db.strength.toArray(), getSetting<string | null>('activeSplit'), activeGoal(),
    db.injuries.toArray(), db.fixedEvents.toArray(), db.planEdits.toArray(), getSetting<2 | 3>('runsPerWeek')
  ]);
  return {
    today: today(), activities, strength, split: splitId ? (await db.splits.get(splitId)) ?? null : null,
    goal, injury: activeInjury(injuries), events, edits: new Map(edits.map(e => [e.key, e])), runsPerWeek: runs ?? 3
  };
}

export async function planWeeks(fromWs: string, count: number): Promise<{ ctx: PlanContext; weeks: PlanWeek[] }> {
  const ctx = await loadContext();
  return { ctx, weeks: Array.from({ length: count }, (_, i) => buildWeek(addDays(fromWs, i * 7), ctx)) };
}

/** Einheiten eines Tages (inkl. in diese Woche verschobener). */
export async function sessionsOn(date: string): Promise<{ sessions: PlanSession[]; ctx: PlanContext }> {
  const ctx = await loadContext();
  const ws = weekStart(date);
  const list = [...buildWeek(addDays(ws, -7), ctx).sessions, ...buildWeek(ws, ctx).sessions, ...buildWeek(addDays(ws, 7), ctx).sessions];
  return { ctx, sessions: list.filter(s => s.date === date) };
}

export async function saveGoal(g: Omit<Goal, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) {
  const now = Date.now(); const data = plain(g);
  const prev = data.id ? await db.goals.get(data.id) : undefined;
  // Nur ein aktives Ziel: andere zukünftige werden archiviert
  if (!prev) for (const o of await db.goals.toArray()) if (!o.archived) await db.goals.put({ ...o, archived: true, updatedAt: now });
  const row: Goal = { ...prev, ...data, id: prev?.id ?? newId(), createdAt: prev?.createdAt ?? now, updatedAt: now } as Goal;
  await db.goals.put(row); return row;
}
export async function archiveGoal(id: string) { const g = await db.goals.get(id); if (g) await db.goals.put({ ...g, archived: true, updatedAt: Date.now() }); }

export async function editSession(key: string, change: Partial<Pick<PlanEdit, 'movedTo' | 'status'>> | null) {
  if (change === null) { await db.planEdits.delete(key); return; }
  const prev = await db.planEdits.get(key);
  const row: PlanEdit = { ...prev, ...change, key, updatedAt: Date.now() };
  if (row.status === undefined) delete row.status;
  if (!row.movedTo) delete row.movedTo;
  await db.planEdits.put(row);
}

export async function saveEvent(e: Omit<FixedEvent, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) {
  const now = Date.now(); const prev = e.id ? await db.fixedEvents.get(e.id) : undefined;
  await db.fixedEvents.put({ ...prev, ...plain(e), id: prev?.id ?? newId(), createdAt: prev?.createdAt ?? now, updatedAt: now } as FixedEvent);
}
export async function deleteEvent(id: string) { await db.fixedEvents.delete(id); }
export const setRunsPerWeek = (n: 2 | 3) => setSetting('runsPerWeek', n);

/** Wenig Grundlage? (Laufumfang der letzten 4 Wochen sehr gering) → Startempfehlung früher. */
export async function lowBase(sport: Goal['sport']): Promise<boolean> {
  const from = addDays(today(), -28);
  const re = sport === 'rad' ? /Ride/ : sport === 'schwimmen' ? /Swim/ : sport === 'triathlon' ? /Run|Ride|Swim/ : /Run/;
  const min = (await db.activities.where('date').aboveOrEqual(from).toArray()).filter(a => re.test(a.sportType)).reduce((s, a) => s + (a.duration ?? 0) / 60, 0) / 4;
  return min < (sport === 'triathlon' ? 180 : 90);
}
