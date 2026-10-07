/**
 * Nährwertrechnung. Gerundet wird erst bei der Anzeige, intern wird exakt gerechnet.
 * Fehlende Werte (null) bleiben fehlend – Summen merken sich, wie viele Einträge einen Wert hatten.
 */
import type { Nutrients, FoodUnit, Food, FoodLogEntry, Meal } from '../../core/db';

export const NUTRIENT_KEYS = ['kcal', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'salt'] as const;
export type NutrientKey = typeof NUTRIENT_KEYS[number];
export const MEALS: { id: Meal; label: string }[] = [
  { id: 'fruehstueck', label: 'Frühstück' }, { id: 'mittag', label: 'Mittagessen' },
  { id: 'abend', label: 'Abendessen' }, { id: 'snack', label: 'Snacks' }
];

/** Nährwerte für eine Menge in g/ml (Werte sind pro 100). */
export function scale(n: Nutrients, grams: number): Nutrients {
  const f = grams / 100;
  return Object.fromEntries(NUTRIENT_KEYS.map(k => [k, n[k] == null ? null : n[k]! * f])) as unknown as Nutrients;
}

export interface Sum { value: number; known: number; total: number }   // known < total → unvollständig
export type Sums = Record<NutrientKey, Sum>;
export function sumEntries(entries: FoodLogEntry[]): Sums {
  const s = Object.fromEntries(NUTRIENT_KEYS.map(k => [k, { value: 0, known: 0, total: entries.length }])) as Sums;
  for (const e of entries) {
    const v = scale(e.snapshot, e.grams);
    for (const k of NUTRIENT_KEYS) if (v[k] != null) { s[k].value += v[k]!; s[k].known++; }
  }
  return s;
}

/** Löst eine Mengenangabe in Gramm/Milliliter auf. null = Einheit für dieses Lebensmittel nicht möglich. */
export function toGrams(food: Pick<Food, 'servingSize' | 'pieceGrams' | 'per'>, amount: number, unit: FoodUnit): number | null {
  switch (unit) {
    case 'g': case 'ml': return amount;
    case 'kg': case 'l': return amount * 1000;
    case 'stk': return food.pieceGrams ? amount * food.pieceGrams : null;
    case 'portion': return food.servingSize ? amount * food.servingSize : null;
  }
}
export const unitLabel = (u: FoodUnit, food?: Pick<Food, 'per'>) =>
  ({ g: 'g', kg: 'kg', ml: 'ml', l: 'l', stk: 'Stück', portion: 'Portion' })[u] ?? (food?.per ?? 'g');

/** Typische Stückgewichte für häufige Lebensmittel ohne Portionsangabe (BLS hat keine). */
const PIECES: [RegExp, number][] = [
  [/^banane\b/i, 120], [/^apfel\b/i, 150], [/^birne\b/i, 160], [/^orange\b/i, 180], [/^mandarine\b/i, 70], [/^kiwi\b/i, 75],
  [/^pfirsich\b/i, 130], [/^nektarine\b/i, 130], [/^pflaume\b/i, 35], [/^aprikose\b/i, 45], [/^tomate\b/i, 80], [/^karotte|^möhre/i, 70],
  [/^zwiebel\b/i, 80], [/^kartoffel\b/i, 90], [/^paprika\b/i, 160], [/^gurke\b/i, 400], [/^zucchini\b/i, 250], [/^avocado\b/i, 150],
  [/^hühnerei\b(?!.*(eigelb|eiklar|pulver))/i, 58], [/brötchen/i, 55], [/^brezel|laugenbrezel/i, 80], [/croissant/i, 60],
  [/toastbrot/i, 25], [/knäckebrot/i, 10], [/zwieback/i, 9]
];
export function guessPieceGrams(name: string): number | null {
  for (const [re, g] of PIECES) if (re.test(name)) return g;
  return null;
}

export function defaultMeal(d = new Date()): Meal {
  const h = d.getHours() + d.getMinutes() / 60;
  if (h < 10.5) return 'fruehstueck';
  if (h < 14.5) return 'mittag';
  if (h >= 17.5 && h < 21.5) return 'abend';
  return 'snack';
}

export const fmtG = (v: number | null | undefined, digits = 0) =>
  v == null ? '–' : v.toLocaleString('de-DE', { maximumFractionDigits: v < 10 && digits === 0 ? 1 : digits });
