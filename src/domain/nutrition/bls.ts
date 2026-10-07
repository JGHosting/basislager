/**
 * BLS 4.0 (Max Rubner-Institut, CC BY 4.0): wird als Datei mit der App ausgeliefert
 * (public/data/bls-4.0.json, offline über den Service Worker) und im Speicher durchsucht.
 * In die Datenbank kommt ein BLS-Lebensmittel erst, wenn es benutzt oder favorisiert wird.
 */
import MiniSearch from 'minisearch';
import type { Food } from '../../core/db';
import { guessPieceGrams } from './calc';

export const BLS_ATTRIBUTION = 'Max Rubner-Institut (2025): Bundeslebensmittelschlüssel (BLS), Version 4.0 – Deutsche Nährstoffdatenbank. Karlsruhe. DOI: 10.25826/Data20251217-134202-0. Lizenz CC BY 4.0. Auszug, für Basislager umgewandelt.';

type Row = [string, string, number | null, number | null, number | null, number | null, number | null, number | null, number | null];
interface BlsFile { v: string; cats: Record<string, string>; rows: Row[] }

let loading: Promise<void> | null = null;
let rows = new Map<string, Row>();
let cats: Record<string, string> = {};
let index: MiniSearch<{ id: string; name: string; squash: string }> | null = null;

/** Umlaute/ß vereinheitlichen, damit "Hanchen", "Hähnchen" und "Haehnchen" sich finden. */
export function fold(s: string) {
  return s.toLowerCase().replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss').replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u');
}
/** Häufige Alltagsbegriffe → BLS-Bezeichnung. */
const SYNONYMS: Record<string, string> = {
  ei: 'huhnerei', eier: 'huhnerei', huhn: 'hahnchen', huhnchen: 'hahnchen', hendl: 'hahnchen', nudeln: 'teigwaren', pasta: 'teigwaren',
  semmel: 'brotchen', semmeln: 'brotchen', kartoffeln: 'kartoffel', mohren: 'mohre', karotten: 'karotte', tomaten: 'tomate',
  haferflocken: 'haferflocken hafer flocken', quark: 'speisequark quark', hack: 'hackfleisch', reis: 'reis'
};

export function loadBls(): Promise<void> {
  loading ??= (async () => {
    const res = await fetch('./data/bls-4.0.json');
    const data: BlsFile = await res.json();
    cats = data.cats;
    rows = new Map(data.rows.map(r => [r[0], r]));
    index = new MiniSearch({
      fields: ['name', 'squash'], storeFields: [],
      processTerm: t => fold(t),
      tokenize: s => s.split(/[\s,()/\-–.]+/).filter(Boolean)
    });
    index.addAll(data.rows.map(r => ({
      id: r[0], name: r[1],
      // ganzer Name ohne Leerzeichen bis zum ersten Komma: "Hafer Flocken" → "haferflocken"
      squash: fold(r[1].split(',')[0].replace(/[\s\-]/g, ''))
    })));
  })();
  return loading;
}

export function blsToFood(r: Row): Food {
  const now = Date.now();
  return {
    id: 'bls:' + r[0], source: 'bls', sourceId: r[0], name: r[1], category: cats[r[0][0]],
    kcal: r[2], protein: r[3], fat: r[4], carbs: r[5], fiber: r[6], sugar: r[7], salt: r[8],
    per: /getränk|saft|nektar|milch(?!reis|brötchen|schokolade|pulver)|wein|bier|tee\b|kaffee|limonade|schorle|wasser/i.test(r[1]) && !/käse|joghurt|quark/i.test(r[1]) ? 'ml' : 'g',
    pieceGrams: guessPieceGrams(r[1]), servingSize: null, servingLabel: null,
    fav: 0, useCount: 0, lastUpdated: now, createdAt: now, updatedAt: now
  };
}

export function getBls(code: string): Food | null { const r = rows.get(code); return r ? blsToFood(r) : null; }

/** Fehlertolerante Suche; kürzere, "rohe"/Grund-Lebensmittel stehen weiter oben. */
export function searchBls(q: string, limit = 30): { food: Food; score: number }[] {
  if (!index) return [];
  const terms = fold(q).split(/\s+/).filter(Boolean).map(t => SYNONYMS[t] ?? t).join(' ');
  const opts = {
    prefix: (t: string) => t.length >= 3, fuzzy: (t: string) => (t.length >= 5 ? 0.25 : t.length >= 4 ? 0.15 : 0),
    boost: { squash: 2 },
    boostDocument: (id: unknown) => { const name = rows.get(id as string)?.[1] ?? ''; return 1 / (1 + name.length / 40) * (/\broh\b/.test(name) ? 1.15 : 1); }
  };
  // Erst alle Wörter (UND), nur wenn nichts gefunden wird: irgendein Wort (ODER)
  let hits = index.search(terms, { ...opts, combineWith: 'AND' });
  // Zusammengesetzte Wörter zerlegen: "hähnchencurry" → "hähnchen curry", "gemüsesuppe" → "gemüse suppe"
  const words = terms.split(' ');
  if (hits.length < 3 && words.length === 1 && words[0].length >= 8) {
    const w = words[0]; const seen = new Set(hits.map(h => h.id));
    for (let i = 4; i <= w.length - 4; i++) {
      for (const h of index.search(`${w.slice(0, i)} ${w.slice(i)}`, { ...opts, combineWith: 'AND' })) {
        if (!seen.has(h.id)) { seen.add(h.id); hits.push(h); }
      }
    }
    hits.sort((a, b) => b.score - a.score);
  }
  if (!hits.length) hits = index.search(terms, { ...opts, combineWith: 'OR' });
  return hits.slice(0, limit).map(h => ({ food: blsToFood(rows.get(h.id as string)!), score: h.score }));
}
