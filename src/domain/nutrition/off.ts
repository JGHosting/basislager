/**
 * Open Food Facts (ODbL). Übertragen wird nur der Suchbegriff bzw. der Barcode – keine persönlichen Daten.
 * Grenzen von OFF: Suche max. 10/min, Produktabfrage max. 15/min → eigene Bremse, nie Suche bei jedem Tastendruck.
 */
import type { Food } from '../../core/db';
import { guessPieceGrams } from './calc';

export const OFF_ATTRIBUTION = 'Daten aus Open Food Facts (openfoodfacts.org), Lizenz: Open Database License (ODbL); Inhalte: Database Contents License.';
const BASE = 'https://world.openfoodfacts.org';
const FIELDS = 'code,product_name,product_name_de,generic_name_de,brands,categories_tags,nutriments,serving_size,serving_quantity,quantity,image_front_small_url';
const APP = 'app_name=Basislager&app_version=1';

export class OffError extends Error { constructor(msg: string, public kind: 'offline' | 'limit' | 'busy' | 'other') { super(msg); } }

/** Gleitendes Fenster: höchstens n Anfragen pro Minute und Art. */
const calls: Record<string, number[]> = { search: [], product: [] };
function take(kind: 'search' | 'product', max: number) {
  const now = Date.now(); calls[kind] = calls[kind].filter(t => now - t < 60000);
  if (calls[kind].length >= max) {
    const wait = Math.ceil((60000 - (now - calls[kind][0])) / 1000);
    throw new OffError(`Open Food Facts erlaubt nur wenige Suchen pro Minute. Bitte ${wait} s warten.`, 'limit');
  }
  calls[kind].push(now);
}

async function get(url: string): Promise<any> {
  if (!navigator.onLine) throw new OffError('Offline – Online-Suche nicht verfügbar.', 'offline');
  let res: Response;
  try { res = await fetch(url); } catch { throw new OffError('Open Food Facts nicht erreichbar.', 'offline'); }
  if (res.status === 429) throw new OffError('Zu viele Anfragen an Open Food Facts. Bitte kurz warten.', 'limit');
  if (res.status === 503 || res.status === 502) throw new OffError('Open Food Facts ist gerade ausgelastet. Bitte gleich nochmal.', 'busy');
  if (!res.ok) throw new OffError(`Open Food Facts antwortet mit Fehler ${res.status}.`, 'other');
  return res.json();
}

const n = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && isFinite(+v) ? +v : null);

export function offToFood(p: any): Food | null {
  const name = (p.product_name_de || p.product_name || p.generic_name_de || '').trim();
  if (!name || !p.code) return null;
  const nu = p.nutriments ?? {};
  const kcal = n(nu['energy-kcal_100g']) ?? (n(nu['energy-kj_100g']) != null ? n(nu['energy-kj_100g'])! / 4.184 : n(nu['energy_100g']) != null ? n(nu['energy_100g'])! / 4.184 : null);
  const isLiquid = /\b\d+([.,]\d+)?\s*(ml|cl|l)\b/i.test(p.quantity ?? '') || /beverages|getranke|drinks/.test((p.categories_tags ?? []).join(' '));
  const serving = n(p.serving_quantity);
  const now = Date.now();
  return {
    id: 'off:' + p.code, source: 'off', sourceId: String(p.code), barcode: String(p.code),
    name, brand: (p.brands ?? '').split(',')[0].trim() || undefined,
    kcal, protein: n(nu.proteins_100g), carbs: n(nu.carbohydrates_100g), fat: n(nu.fat_100g),
    fiber: n(nu.fiber_100g), sugar: n(nu.sugars_100g), salt: n(nu.salt_100g) ?? (n(nu.sodium_100g) != null ? n(nu.sodium_100g)! * 2.54 : null),
    per: isLiquid ? 'ml' : 'g',
    servingSize: serving && serving > 0 ? serving : null, servingLabel: p.serving_size || null,
    pieceGrams: guessPieceGrams(name), imageUrl: p.image_front_small_url || null,
    fav: 0, useCount: 0, lastUpdated: now, createdAt: now, updatedAt: now
  };
}

export async function offSearch(q: string): Promise<Food[]> {
  take('search', 8);
  const url = `${BASE}/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=24&lc=de&sort_by=unique_scans_n&fields=${FIELDS}&${APP}`;
  const data = await get(url);
  return (data.products ?? []).map(offToFood).filter((f: Food | null): f is Food => !!f && f.kcal != null);
}

/** Produkt per Barcode; null = nicht gefunden. */
export async function offProduct(code: string): Promise<Food | null> {
  take('product', 12);
  const data = await get(`${BASE}/api/v2/product/${encodeURIComponent(code)}.json?fields=${FIELDS}&${APP}`);
  if (data.status !== 1 || !data.product) return null;
  return offToFood({ ...data.product, code: data.product.code ?? code });
}
