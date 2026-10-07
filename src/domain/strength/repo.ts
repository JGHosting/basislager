/** Speichern/Laden von Krafteinheiten und Split-Einstellung. */
import { db, getSetting, setSetting, type StrengthSession, type MuscleGroup, type SplitTemplate } from '../../core/db';
import { newId } from '../../core/ids';

export async function activeSplit(): Promise<SplitTemplate | null> {
  const id = await getSetting<string | null>('activeSplit');
  return id ? (await db.splits.get(id)) ?? null : null;
}
export async function setActiveSplit(id: string | null) { await setSetting('activeSplit', id); }

export async function sessionFor(target: { activityId?: string; sessionId?: string }): Promise<StrengthSession | undefined> {
  if (target.sessionId) return db.strength.get(target.sessionId);
  if (target.activityId) return db.strength.where('activityId').equals(target.activityId).first();
}

export async function saveSession(input: { id?: string; activityId?: string; date: string; muscleGroups: MuscleGroup[]; intensity: number | null; skipped?: boolean }) {
  const now = Date.now();
  const prev = input.id ? await db.strength.get(input.id) : undefined;
  const row: StrengthSession = {
    id: prev?.id ?? newId(), date: input.date, muscleGroups: input.muscleGroups, intensity: input.intensity,
    createdAt: prev?.createdAt ?? now, updatedAt: now
  };
  if (input.activityId) row.activityId = input.activityId;   // Feld nur setzen, wenn vorhanden (eindeutiger Index)
  if (input.skipped) row.skipped = true;
  await db.strength.put(row);
  return row;
}
export async function deleteSession(id: string) { await db.strength.delete(id); }
