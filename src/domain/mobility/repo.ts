/**
 * Verlauf (mobilityLog), Streak und Fälligkeits-/Pausenlogik für die tägliche Routine.
 */
import { db } from '../../core/db';
import { today, addDays } from '../../core/dates';
import { getMobilitySettings, saveMobilitySettings, getPauseRanges, dayWasPaused } from './settings';
import { buildTodayRoutine, pickReplacement, toItem, type Routine, type RoutineItem } from './select';
import { loadProgress, recordExercise, type Feedback } from './progression';
import { isExcluded } from './injury';
import { activeInjury } from '../injury/injury';
import { byId, LIBRARY } from './library';

/** done = Anteil erledigter Übungen; die Routine zählt ab 80 % als erledigt. */
export const DONE_THRESHOLD = 0.8;

export async function todayLog() { return db.mobilityLog.get(today()); }

/** Was die Auswahl beeinflusst – Änderung vor der ersten erledigten Übung plant die heutige Routine neu. */
export const sigOf = (s: Awaited<ReturnType<typeof getMobilitySettings>>) =>
  JSON.stringify([s.minutes, s.level, s.goals.map(g => [g.id, g.weight])]);

export async function ensureTodayRoutine(): Promise<Routine> {
  let existing = await todayLog();
  const settings = await getMobilitySettings();
  const injury = activeInjury(await db.injuries.toArray());
  const sig = sigOf(settings);
  if (existing && existing.minutes > 0 && !existing.items.some(i => i.done) && existing.sig !== sig) existing = undefined;
  if (existing) {
    const progress = await loadProgress();
    // Verletzung kann sich seit dem Erstellen geändert haben: offene, jetzt ungeeignete Übungen ersetzen (oder streichen)
    let changed = false;
    const items: { exerciseId: string; done: boolean }[] = [];
    for (const i of existing.items) {
      const e = byId(i.exerciseId);
      if (!e && !i.done) { changed = true; continue; }   // Übung gibt es nicht mehr (z. B. ohne Bild entfernt)
      if (!e || i.done || !isExcluded(e, injury)) { items.push(i); continue; }
      changed = true;
      const rep = pickReplacement(i.exerciseId, injury, [...existing.items, ...items].map(x => x.exerciseId), settings.level, progress);
      if (rep) items.push({ exerciseId: rep.exerciseId, done: false });
    }
    if (changed) await db.mobilityLog.put({ ...existing, items, updatedAt: Date.now() });
    return {
      date: existing.date, minutes: existing.minutes,
      items: items.flatMap(i => {
        const e = byId(i.exerciseId); if (!e) return [];
        return [toItem(e, progress)];
      })
    };
  }
  const routine = await buildTodayRoutine(settings, injury);
  await db.mobilityLog.put({ date: routine.date, minutes: routine.minutes, sig, items: routine.items.map(i => ({ exerciseId: i.exerciseId, done: false })), createdAt: Date.now(), updatedAt: Date.now() });
  return routine;
}

/**
 * "Routine aktualisieren": plant die heutige Routine mit den aktuellen Zielen/Gewichten/Länge neu.
 * Bereits abgehakte Übungen bleiben erhalten, der Rest wird neu ausgewählt.
 */
export async function rebuildToday(): Promise<void> {
  const settings = await getMobilitySettings();
  const injury = activeInjury(await db.injuries.toArray());
  const row = await todayLog();
  const done = row && row.minutes > 0 ? row.items.filter(i => i.done) : [];
  const fresh = await buildTodayRoutine(settings, injury);
  const open = fresh.items.filter(i => !done.some(d => d.exerciseId === i.exerciseId))
    .slice(0, Math.max(0, fresh.items.length - done.length))
    .map(i => ({ exerciseId: i.exerciseId, done: false }));
  const now = Date.now();
  await db.mobilityLog.put({ date: today(), minutes: settings.minutes, sig: sigOf(settings), items: [...done, ...open], createdAt: row?.createdAt ?? now, updatedAt: now });
}

/** "Tauschen" im Player: verletzungsgerechten Ersatz wählen und im Tageslog festhalten. */
export async function swapExercise(oldId: string, inRoutine: string[]): Promise<RoutineItem | null> {
  const settings = await getMobilitySettings();
  const injury = activeInjury(await db.injuries.toArray());
  const rep = pickReplacement(oldId, injury, inRoutine, settings.level, await loadProgress());
  if (!rep) return null;
  const row = await todayLog();
  if (row) await db.mobilityLog.put({ ...row, items: row.items.map(i => (i.exerciseId === oldId ? { exerciseId: rep.exerciseId, done: false } : i)), updatedAt: Date.now() });
  return rep;
}

/** Wie viele Übungen der Bibliothek die aktive Verletzung gerade ausschließt (für den Hinweis im Mobility-Tab). */
export function excludedCount(injury: import('../../core/db').Injury | null): number {
  return injury ? LIBRARY.filter(e => isExcluded(e, injury)).length : 0;
}

export async function setExerciseDone(exerciseId: string, done: boolean) {
  const row = await todayLog(); if (!row) return;
  const items = row.items.map(i => (i.exerciseId === exerciseId ? { ...i, done } : i));
  await db.mobilityLog.put({ ...row, items, updatedAt: Date.now() });
}
export async function finishToday(allDone: boolean) {
  const row = await todayLog(); if (!row) return;
  const items = allDone ? row.items.map(i => ({ ...i, done: true })) : row.items;
  await db.mobilityLog.put({ ...row, items, updatedAt: Date.now() });
  const s = await getMobilitySettings();
  await saveMobilitySettings({ rotationIdx: (s.rotationIdx + 3) % 6 });
}
export function completion(row: { items: { done: boolean }[] } | undefined): number {
  if (!row || !row.items.length) return 0;
  return row.items.filter(i => i.done).length / row.items.length;
}
export async function isTodayDone(): Promise<boolean> {
  const row = await todayLog();
  if (row && row.minutes === 0) return true;   // "Heute aussetzen" – für heute erledigt, zählt aber nicht für die Streak
  return completion(row) >= DONE_THRESHOLD;
}

/** "Heute aussetzen" (Stufe Brutal) – zählt als erledigt mit 0 Übungen, kostet die Streak. */
export async function skipToday() {
  await db.mobilityLog.put({ date: today(), minutes: 0, items: [], createdAt: Date.now(), updatedAt: Date.now() });
}

/** Fällig, sobald es noch keinen (ausreichend erledigten) Eintrag für heute gibt und kein Pausenmodus aktiv ist. */
export async function mobilityDueToday(): Promise<boolean> {
  const s = await getMobilitySettings();
  if (s.pauseMode) return false;
  return !(await isTodayDone());
}

/** Fortlaufende Tagesstreak. Tage im Pausenmodus zählen weder als Erfolg noch als Abbruch. */
export async function currentStreak(): Promise<number> {
  const ranges = await getPauseRanges();
  let streak = 0; let d = today();
  // Heute selbst zählt nur mit, wenn schon erledigt; sonst wird ab gestern geprüft.
  const todayRow = await db.mobilityLog.get(d);
  const todayDone = completion(todayRow) >= DONE_THRESHOLD;
  if (todayDone) { streak++; d = addDays(d, -1); } else if (!dayWasPaused(ranges, d)) { d = addDays(d, -1); }
  for (;;) {
    if (dayWasPaused(ranges, d)) { d = addDays(d, -1); continue; }
    const row = await db.mobilityLog.get(d);
    if (completion(row) >= DONE_THRESHOLD) { streak++; d = addDays(d, -1); continue; }
    break;
  }
  return streak;
}

/** Durchgang + Feedback in den Fortschritt übernehmen; liefert neu freigeschaltete Übungen. */
export async function rateExercise(exerciseId: string, fb: Feedback) {
  const s = await getMobilitySettings();
  return recordExercise(exerciseId, fb, s.level);
}

/**
 * Routine zum Abspielen: nur die heute noch offenen Übungen. Sind alle erledigt,
 * kommt die ganze Routine nochmal als Wiederholung (zählt nicht erneut).
 */
export async function routineToPlay(): Promise<Routine> {
  const routine = await ensureTodayRoutine();
  const row = await todayLog();
  const done = new Set(row?.items.filter(i => i.done).map(i => i.exerciseId) ?? []);
  const open = routine.items.filter(i => !done.has(i.exerciseId));
  if (!open.length) return { ...routine, repeat: true };
  return { ...routine, items: open };
}
