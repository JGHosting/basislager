import { db, type Injury, type Movement, type MoveStatus } from '../../core/db';
import { newId } from '../../core/ids';
import { today } from '../../core/dates';
import { LAST_STAGE, activeInjury } from './injury';

const plain = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

export async function getActiveInjury() { return activeInjury(await db.injuries.toArray()); }

export async function saveInjury(input: Omit<Injury, 'id' | 'createdAt' | 'updatedAt' | 'stageHistory' | 'stage'> & { id?: string; stage?: number }) {
  const now = Date.now();
  const data = plain(input);
  const prev = data.id ? await db.injuries.get(data.id) : undefined;
  // Start: schwer → Pause, sonst direkt Alternativtraining (nur erlaubte Bewegungen)
  const stage = data.stage ?? prev?.stage ?? (data.mode === 'ausfall' ? 0 : data.severity === 'schwer' ? 0 : 1);
  const row: Injury = {
    ...prev, ...data, id: prev?.id ?? newId(), stage,
    stageHistory: prev?.stageHistory ?? [{ date: data.startDate, stage }],
    createdAt: prev?.createdAt ?? now, updatedAt: now
  } as Injury;
  if (!row.medicalNote) delete row.medicalNote;
  await db.injuries.put(row);
  return row;
}

export async function setStage(id: string, stage: number) {
  const inj = await db.injuries.get(id); if (!inj) return;
  const t = today();
  const s = Math.max(0, Math.min(LAST_STAGE, stage));
  inj.stage = s;
  inj.stageHistory = [...inj.stageHistory, { date: t, stage: s }];
  if (s === LAST_STAGE) inj.endDate = t; else delete inj.endDate;
  inj.updatedAt = Date.now();
  await db.injuries.put(inj);
}

export async function setMovement(id: string, m: Movement, st: MoveStatus) {
  const inj = await db.injuries.get(id); if (!inj) return;
  inj.movement = { ...inj.movement, [m]: st }; inj.updatedAt = Date.now();
  await db.injuries.put(inj);
}

export async function endInjury(id: string) { await setStage(id, LAST_STAGE); }
export async function deleteInjury(id: string) { await db.injuries.delete(id); }

/** Schmerzwert (0–10) des Tages als eigener, manueller Morgenwert. */
export async function savePain(date: string, pain: number | null) {
  const now = Date.now();
  const e = await db.morning.get(date);
  await db.morning.put(e ? { ...e, pain, updatedAt: now } : {
    date, hrv: null, restingHr: null, sleepScore: null, sleepSecs: null, weight: null, feltRecovery: null, pain,
    sources: {}, createdAt: now, updatedAt: now
  });
}

/** Ernste Verletzung in Rückkehrstufen überführen (z. B. nach Gips/Schiene). */
export async function switchToStages(id: string, stage = 1) {
  const inj = await db.injuries.get(id); if (!inj) return;
  inj.mode = 'stufen'; inj.stage = stage; inj.stageHistory = [...inj.stageHistory, { date: today(), stage }]; inj.updatedAt = Date.now();
  await db.injuries.put(inj);
}
