/** Ernährungstagebuch: Einträge, Cache, Favoriten, Tracking-Status, Tagessummen. */
import { db, getSetting, setSetting, type Food, type FoodLogEntry, type FoodUnit, type Meal } from '../../core/db';
import { newId } from '../../core/ids';
import { addDays } from '../../core/dates';
import { toGrams, sumEntries, MEALS, type Sums } from './calc';
import { fold, searchBls } from './bls';
import { offSearch } from './off';

/* ---------- Cache / Favoriten ---------- */
export async function cacheFood(input: Food): Promise<Food> {
  const f = plain(input);
  const prev = await db.foods.get(f.id);
  // Bei erneutem Laden aus der Quelle: Nährwerte aktualisieren, Nutzungsdaten behalten
  const row: Food = prev ? { ...f, fav: prev.fav, useCount: prev.useCount, lastUsedAt: prev.lastUsedAt, createdAt: prev.createdAt,
    pieceGrams: prev.pieceGrams ?? f.pieceGrams, updatedAt: Date.now() } : f;
  await db.foods.put(row);
  return row;
}
export async function toggleFav(f: Food): Promise<Food> {
  const row = await cacheFood(f);
  row.fav = row.fav ? 0 : 1; row.updatedAt = Date.now();
  await db.foods.put(row); return row;
}
export async function saveCustomFood(input: Omit<Food, 'id' | 'source' | 'sourceId' | 'fav' | 'useCount' | 'lastUpdated' | 'createdAt' | 'updatedAt'>): Promise<Food> {
  const now = Date.now(); const id = newId();
  const f: Food = { ...input, id: 'custom:' + id, source: 'custom', sourceId: id, fav: 0, useCount: 0, lastUpdated: now, createdAt: now, updatedAt: now };
  await db.foods.put(f); return f;
}

/* ---------- Einträge ---------- */
export async function addEntry(input: Food, date: string, meal: Meal, amount: number, unit: FoodUnit): Promise<void> {
  const food = plain(input);
  const grams = toGrams(food, amount, unit);
  if (grams == null || !(grams > 0)) throw new Error('Ungültige Menge.');
  const now = Date.now();
  await db.transaction('rw', db.foods, db.foodlog, async () => {
    const cached = await cacheFood(food);
    cached.useCount++; cached.lastUsedAt = now; cached.updatedAt = now;
    await db.foods.put(cached);
    await db.foodlog.put({
      id: newId(), date, meal, foodId: food.id, amount, unit, grams,
      snapshot: { name: food.name, brand: food.brand, source: food.source, per: food.per,
        kcal: food.kcal, protein: food.protein, carbs: food.carbs, fat: food.fat, fiber: food.fiber, sugar: food.sugar, salt: food.salt },
      createdAt: now, updatedAt: now
    });
  });
}
/** Reine Datenkopie (UI-Zustand kann Proxys enthalten, die IndexedDB nicht speichern kann). */
const plain = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

export async function updateEntry(entry: FoodLogEntry, amount: number, unit: FoodUnit, meal: Meal) {
  const e = plain(entry);
  const food = (await db.foods.get(e.foodId)) ?? { servingSize: null, pieceGrams: null, per: e.snapshot.per };
  const grams = toGrams(food, amount, unit) ?? (unit === e.unit ? e.grams / e.amount * amount : null);
  if (grams == null || !(grams > 0)) throw new Error('Ungültige Menge.');
  await db.foodlog.put({ ...e, amount, unit, grams, meal, updatedAt: Date.now() });
}
export async function deleteEntry(id: string) { await db.foodlog.delete(id); }

/* ---------- Tracking-Status ---------- */
/** Kein Eintrag = getrackt (Standard). Damit ist jeder neue Tag automatisch wieder normal. */
export async function isTracked(date: string) { return (await db.nutritionDays.get(date))?.tracked !== false; }
export async function setTracked(date: string, tracked: boolean) {
  if (tracked) await db.nutritionDays.delete(date);
  else await db.nutritionDays.put({ date, tracked: false, updatedAt: Date.now() });
}

/* ---------- Ziel ---------- */
export const getKcalGoal = async () => (await getSetting<number | null>('kcalGoal')) ?? null;
export const setKcalGoal = (v: number | null) => setSetting('kcalGoal', v);

/* ---------- Tag ---------- */
export interface DayView { date: string; tracked: boolean; entries: FoodLogEntry[]; total: Sums; meals: Record<Meal, { entries: FoodLogEntry[]; sum: Sums }> }
export async function dayView(date: string): Promise<DayView> {
  const [entries, tracked] = await Promise.all([db.foodlog.where('date').equals(date).toArray(), isTracked(date)]);
  entries.sort((a, b) => a.createdAt - b.createdAt);
  const meals = Object.fromEntries(MEALS.map(m => { const es = entries.filter(e => e.meal === m.id); return [m.id, { entries: es, sum: sumEntries(es) }]; })) as DayView['meals'];
  return { date, tracked, entries, total: sumEntries(entries), meals };
}
export type DayState = 'getrackt' | 'nicht getrackt' | 'keine Einträge';
export async function recentDays(n: number, from: string): Promise<{ date: string; state: DayState; kcal: number }[]> {
  const out = [];
  for (let i = 0; i < n; i++) {
    const date = addDays(from, -i);
    const [entries, tracked] = await Promise.all([db.foodlog.where('date').equals(date).toArray(), isTracked(date)]);
    out.push({ date, state: (!tracked ? 'nicht getrackt' : entries.length ? 'getrackt' : 'keine Einträge') as DayState, kcal: sumEntries(entries).kcal.value });
  }
  return out;
}

/* ---------- Suche ---------- */
export async function quickPicks(): Promise<{ favs: Food[]; recent: Food[] }> {
  const all = await db.foods.toArray();
  return {
    favs: all.filter(f => f.fav).sort((a, b) => a.name.localeCompare(b.name)),
    recent: all.filter(f => f.lastUsedAt).sort((a, b) => b.lastUsedAt! - a.lastUsedAt!).slice(0, 12)
  };
}

/** Lokal: Cache (Favoriten/genutzt) + BLS. Sofort, offline. */
export async function searchLocal(q: string): Promise<Food[]> {
  const fq = fold(q).trim();
  if (!fq) return [];
  const cached = (await db.foods.toArray()).filter(f => fold(f.name + ' ' + (f.brand ?? '')).includes(fq) || fq.split(/\s+/).every(t => fold(f.name + ' ' + (f.brand ?? '')).includes(t)))
    .sort((a, b) => b.fav - a.fav || b.useCount - a.useCount);
  const bls = searchBls(q).map(h => h.food);
  return dedupe([...cached, ...bls]);
}
/** Online: Open Food Facts. Ergebnisse werden NICHT automatisch gespeichert – erst beim Benutzen. */
export async function searchOnline(q: string): Promise<Food[]> { return offSearch(q); }

export function dedupe(list: Food[]): Food[] {
  const seen = new Set<string>(); const out: Food[] = [];
  for (const f of list) {
    const k1 = f.id, k2 = f.barcode ? 'bc:' + f.barcode : '', k3 = 'n:' + fold(f.name) + '|' + fold(f.brand ?? '') + '|' + Math.round(f.kcal ?? -1);
    if (seen.has(k1) || (k2 && seen.has(k2)) || seen.has(k3)) continue;
    seen.add(k1); if (k2) seen.add(k2); seen.add(k3); out.push(f);
  }
  return out;
}
export async function findByBarcode(code: string): Promise<Food | null> {
  return (await db.foods.where('barcode').equals(code).first()) ?? null;
}
