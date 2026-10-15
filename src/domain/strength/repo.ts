/** Speichern/Laden von Krafteinheiten und Split-Einstellung. */
import { db, getSetting, setSetting, BUILTIN_SPLITS, type StrengthSession, type MuscleGroup, type SplitTemplate } from '../../core/db';
import { newId } from '../../core/ids';
import { nextSplitDay } from './strength';

export async function activeSplit(): Promise<SplitTemplate | null> {
  const id = await getSetting<string | null>('activeSplit');
  return id ? (await db.splits.get(id)) ?? null : null;
}
export async function setActiveSplit(id: string | null) { await setSetting('activeSplit', id); }

export async function sessionFor(target: { activityId?: string; sessionId?: string; date?: string; fresh?: boolean }): Promise<StrengthSession | undefined> {
  if (target.sessionId) return db.strength.get(target.sessionId);
  if (target.activityId) return db.strength.where('activityId').equals(target.activityId).first();
  // Nur Datum (z. B. aus dem Plan): vorhandene Einheit dieses Tages bearbeiten statt eine zweite anzulegen
  if (target.date && !target.fresh) return (await db.strength.where('date').equals(target.date).toArray()).sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

export async function saveSession(input: { id?: string; activityId?: string; date: string; muscleGroups: MuscleGroup[]; intensity: number | null; skipped?: boolean }) {
  const now = Date.now();
  const prev = input.id ? await db.strength.get(input.id) : undefined;
  const row: StrengthSession = {
    id: prev?.id ?? newId(), date: input.date, muscleGroups: input.muscleGroups, intensity: input.intensity,
    createdAt: prev?.createdAt ?? now, updatedAt: now
  };
  const activityId = input.activityId ?? prev?.activityId;   // beim Bearbeiten Verknüpfung behalten
  if (activityId) row.activityId = activityId;   // Feld nur setzen, wenn vorhanden (eindeutiger Index)
  if (input.skipped) row.skipped = true;
  await db.strength.put(row);
  return row;
}
export async function deleteSession(id: string) { await db.strength.delete(id); }

/** Feste Split-Vorlagen ergänzen, falls sie fehlen (z. B. nach Import eines älteren Backups). */
export async function ensureBuiltinSplits() {
  for (const s of BUILTIN_SPLITS) if (!(await db.splits.get(s.id))) await db.splits.put(s);
}

/**
 * Nach dem Abgleich: Garmin-Krafttrainings ohne Zuordnung automatisch die nächste Split-Muskelgruppe
 * zuweisen, damit der Plan sofort weiterrückt (ohne manuelles „Bearbeiten → Speichern").
 * Die Zuordnung bleibt jederzeit änderbar; bereits zugeordnete oder manuell eingetragene Tage bleiben unberührt.
 */
export async function autoAssignStrength(): Promise<number> {
  const split = await activeSplit();
  if (!split || !split.days.length) return 0;                       // ohne Split keine sinnvolle Reihenfolge
  const [acts, sessions] = await Promise.all([
    db.activities.where('sportType').equals('WeightTraining').toArray(),
    db.strength.toArray()
  ]);
  const linked = new Set(sessions.map(s => s.activityId).filter(Boolean));
  const datesWithSession = new Set(sessions.map(s => s.date));
  const cutoff = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10);
  const todo = acts.filter(a => a.date >= cutoff && !linked.has(a.id) && !datesWithSession.has(a.date))
    .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
  if (!todo.length) return 0;
  const soFar = sessions.filter(s => !s.skipped && s.muscleGroups.length);   // Grundlage für die Reihenfolge
  const now = Date.now();
  let n = 0;
  for (const a of todo) {
    const groups = nextSplitDay(split, soFar).groups;
    const row: StrengthSession = { id: newId(), date: a.date, activityId: a.id, muscleGroups: [...groups], intensity: null, createdAt: now + n, updatedAt: now + n };
    await db.strength.put(row);
    soFar.push(row);
    datesWithSession.add(a.date);
    n++;
  }
  return n;
}

/**
 * Entfernt doppelte Krafteinheiten, die durch einen früheren Fehler entstehen konnten
 * (mehrfaches Eintragen am selben Tag legte jeweils eine neue Einheit an).
 * Doppelt = gleicher Tag und exakt gleiche Muskelgruppen. Behalten wird die mit
 * verknüpfter Aktivität, sonst die zuletzt geänderte. Unterschiedliche Einheiten
 * am selben Tag (andere Gruppen) bleiben unangetastet.
 */
export async function dedupeStrength(): Promise<number> {
  const all = await db.strength.toArray();
  const groups = new Map<string, StrengthSession[]>();
  for (const s of all) {
    const key = `${s.date}|${[...s.muscleGroups].sort().join('+')}|${s.skipped ? 1 : 0}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(s);
  }
  const remove: string[] = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => Number(!!b.activityId) - Number(!!a.activityId) || b.updatedAt - a.updatedAt);
    remove.push(...list.slice(1).map(s => s.id));
  }
  if (remove.length) await db.strength.bulkDelete(remove);

  // Zweiter Durchgang: Ein Tag mit genau einer Garmin-Krafteinheit ist ein Training.
  // Mehrere Einträge entstanden früher beim Umstellen der Muskelgruppen. Die verknüpfte
  // Einheit bekommt den zuletzt gewählten Stand (Gruppen/Intensität), die übrigen fallen weg.
  const left = all.filter(s => !remove.includes(s.id));
  const byDate = new Map<string, StrengthSession[]>();
  for (const s of left) (byDate.get(s.date) ?? byDate.set(s.date, []).get(s.date)!).push(s);
  let merged = 0;
  for (const list of byDate.values()) {
    if (list.length < 2) continue;
    const linked = list.filter(s => s.activityId);
    if (linked.length !== 1) continue;                       // zwei getrackte Trainings = beide echt
    const keep = linked[0];
    const newest = list.filter(s => s.muscleGroups.length).sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? keep;
    await db.strength.put({ ...keep, muscleGroups: [...newest.muscleGroups], intensity: newest.intensity, skipped: newest.skipped, updatedAt: Date.now() });
    await db.strength.bulkDelete(list.filter(s => s.id !== keep.id).map(s => s.id));
    merged += list.length - 1;
  }
  return remove.length + merged;
}
