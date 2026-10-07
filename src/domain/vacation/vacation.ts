/**
 * Urlaubsmodus (app-weit):
 * - Plan: Kraft entfällt (kein Studio), Ausdauer je nach Wahl voll / weniger (≈ 60 %) / keine.
 *   Im Wettkampfmodus ist "keine" nicht möglich – wird dann wie "weniger" behandelt.
 * - Ernährung: Urlaubstage gelten als "nicht getrackt" (nie 0 kcal), außer du trackst bewusst.
 * - Kein automatisches Morgenpopup, keine Warnungen zu vernachlässigten Muskelgruppen.
 */
import { db, type Vacation } from '../../core/db';
import { newId } from '../../core/ids';
import { addDays, today } from '../../core/dates';

export const TRAINING_LABEL = { voll: 'Training voll', weniger: 'Training reduziert', keine: 'Kein Training' } as const;

export const vacationOn = (list: Vacation[], date: string) => list.find(v => date >= v.start && date <= v.end) ?? null;
export async function vacationToday(date = today()) { return vacationOn(await db.vacations.toArray(), date); }
/** Urlaub endete erst vor Kurzem (für Warnungen, die sonst zu früh anschlagen). */
export const recentlyOnVacation = (list: Vacation[], date: string, days = 7) => list.some(v => v.start <= date && v.end >= addDays(date, -days));

export async function saveVacation(v: Omit<Vacation, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) {
  const now = Date.now(); const prev = v.id ? await db.vacations.get(v.id) : undefined;
  const row: Vacation = { ...prev, ...JSON.parse(JSON.stringify(v)), id: prev?.id ?? newId(), createdAt: prev?.createdAt ?? now, updatedAt: now };
  if (row.end < row.start) row.end = row.start;
  if (!row.title) delete row.title;
  await db.vacations.put(row); return row;
}
export async function deleteVacation(id: string) { await db.vacations.delete(id); }
