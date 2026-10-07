/**
 * Morgenwerte: Nachtwerte lesen, Gewicht manuell speichern, heutige Plan-Einträge holen.
 * Manuelle Werte werden als source 'manual' markiert und beim Sync nie überschrieben.
 */
import { db, getSetting, type MorningEntry } from '../../core/db';
import { today, addDays } from '../../core/dates';
import { icu, type Credentials, type IcuEvent } from '../../sources/intervals/client';

const hasNight = (m: MorningEntry) => m.hrv != null || m.sleepScore != null || m.sleepSecs != null || m.restingHr != null;

/** Letzter Tag mit Nachtwerten (heute oder älter) + Ø der 7 Tage davor. */
export async function latestNight() {
  const recent = await db.morning.where('date').between(addDays(today(), -30), today(), true, true).reverse().toArray();
  const entry = recent.find(hasNight);
  if (!entry) return null;
  const prev = recent.filter(m => m.date < entry.date && m.date >= addDays(entry.date, -7));
  const avg = (f: 'hrv' | 'restingHr' | 'sleepScore' | 'sleepSecs') => {
    const v = prev.map(m => m[f]).filter((x): x is number => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  return { entry, avg: { hrv: avg('hrv'), restingHr: avg('restingHr'), sleepScore: avg('sleepScore'), sleepSecs: avg('sleepSecs') } };
}

/** Zuletzt bekanntes Gewicht (für Vorbelegung). */
export async function lastWeight(): Promise<{ date: string; kg: number } | null> {
  const all = await db.morning.orderBy('date').reverse().filter(m => m.weight != null).first();
  return all ? { date: all.date, kg: all.weight! } : null;
}

/** Speichert (oder löscht bei null) das Gewicht eines Tages als manuellen Wert. */
export async function saveWeight(date: string, kg: number | null) {
  const now = Date.now();
  await db.transaction('rw', db.morning, async () => {
    const e = await db.morning.get(date);
    const row: MorningEntry = e ? { ...e, sources: { ...e.sources } } : {
      date, hrv: null, restingHr: null, sleepScore: null, sleepSecs: null, weight: null,
      feltRecovery: null, pain: null, sources: {}, createdAt: now, updatedAt: now
    };
    row.weight = kg;
    if (kg == null) delete row.sources.weight; else row.sources.weight = 'manual';
    row.updatedAt = now;
    await db.morning.put(row);
  });
}

/** Wandelt "78,4" / "78.4" in eine Zahl; null bei leer, NaN bei unsinnig. */
export function parseKg(input: string): number | null {
  const s = input.trim().replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 30 && n <= 250 ? Math.round(n * 10) / 10 : NaN;
}

/**
 * Heute geplante Einträge. Solange der eigene Planer fehlt: aus dem intervals.icu-Kalender.
 * Wird nicht gespeichert (live abgefragt), daher auch nicht Teil des Backups.
 */
export async function todaysPlan(): Promise<IcuEvent[] | null> {
  const c = await getSetting<Credentials>('intervals');
  if (!c || !navigator.onLine) return null;
  try {
    const t = today();
    const ev = await icu.events(c, t, t);
    return ev.filter(e => e.start_date_local.slice(0, 10) === t);
  } catch { return null; }
}
