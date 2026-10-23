/**
 * Verpflegung für lange Einheiten: vorher, unterwegs, danach.
 * Eigene, regelbasierte Umsetzung allgemeiner sportwissenschaftlicher Richtwerte
 * (Kohlenhydrate pro Stunde nach Dauer und Intensität, nicht nach Körpergewicht;
 * Gewicht nur für Mahlzeit davor, Trinken und Regeneration; Wärme v. a. für Trinken und Salz).
 * Keine individuelle Ernährungsberatung.
 */
import { db, getSetting, setSetting, type Nutrients } from '../../core/db';
import { addDays, today } from '../../core/dates';
import type { PlanSession } from '../planner/plan';

export const FUEL_MIN_MINUTES = 75;

/* ---------- Einstellungen ---------- */
export type GutLevel = 'neu' | 'manchmal' | 'trainiert';
export type SaltLevel = 'kaum' | 'normal' | 'salzig';
export type FoodStyle = 'mix' | 'echt' | 'gels';
export interface FuelSettings {
  gut: GutLevel; salt: SaltLevel; style: FoodStyle;
  noGluten: boolean; noDairy: boolean; noCaffeine: boolean;
  /** Essenszeitpunkte als Schritte ins Garmin-Workout schreiben. */
  watch: boolean;
}
export const DEFAULT_FUEL: FuelSettings = { gut: 'manchmal', salt: 'normal', style: 'mix', noGluten: false, noDairy: false, noCaffeine: false, watch: true };
export const getFuelSettings = async (): Promise<FuelSettings> => ({ ...DEFAULT_FUEL, ...(await getSetting<Partial<FuelSettings>>('fueling')) });
export const saveFuelSettings = (s: FuelSettings) => setSetting('fueling', { ...s });

/* ---------- Belastung ---------- */
export type FuelLevel = 'z2' | 'mittel' | 'hart' | 'wettkampf';
export const LEVEL_LABEL: Record<FuelLevel, string> = { z2: 'Locker (Z2)', mittel: 'Mittel', hart: 'Hart', wettkampf: 'Wettkampf' };
export function levelOf(s: Pick<PlanSession, 'intensity' | 'sport' | 'title'>): FuelLevel {
  if (s.sport === 'wettkampf' || s.intensity === 'wettkampf') return 'wettkampf';
  if (s.intensity === 'hart') return 'hart';
  if (s.intensity === 'mittel' && !/\(locker\)|Lang/.test(s.title)) return 'mittel';
  return 'z2';
}
export const fuelSport = (s: Pick<PlanSession, 'sport'>) => s.sport === 'rad' ? 'rad' : s.sport === 'schwimmen' ? 'schwimmen' : s.sport === 'gehen' ? 'gehen' : 'lauf';
export const needsFuelPlan = (s: Pick<PlanSession, 'sport' | 'minutes' | 'race'>) => s.sport === 'wettkampf' ? !!s.race : s.sport !== 'kraft' && s.minutes >= FUEL_MIN_MINUTES;
export type LegSport = 'schwimmen' | 'rad' | 'lauf' | 'gehen';
export const LEG_LABEL: Record<LegSport, string> = { schwimmen: 'Schwimmen', rad: 'Rad', lauf: 'Laufen', gehen: 'Gehen' };

/* ---------- Verpflegungsmittel ---------- */
export interface FuelItem {
  id: string; name: string; short: string; carbs: number; grams: number; per: 'g' | 'ml';
  /** Nährwerte pro 100 g/ml (für den Eintrag ins Ernährungstagebuch). */
  n: Nutrients;
  kind: 'gel' | 'echt' | 'drink'; gluten?: boolean; dairy?: boolean; caffeine?: boolean; noRun?: boolean;
}
const nut = (kcal: number, carbs: number, protein = 0, fat = 0, salt = 0, sugar = carbs, fiber = 0): Nutrients => ({ kcal, carbs, protein, fat, salt, sugar, fiber });
export const FUEL_ITEMS: FuelItem[] = [
  { id: 'gel', name: 'Energie-Gel', short: 'Gel', carbs: 25, grams: 40, per: 'g', n: nut(250, 62, 0, 0, 0.2, 30), kind: 'gel' },
  { id: 'gel-koffein', name: 'Energie-Gel mit Koffein', short: 'Koffein-Gel', carbs: 25, grams: 40, per: 'g', n: nut(250, 62, 0, 0, 0.2, 30), kind: 'gel', caffeine: true },
  { id: 'iso', name: 'Iso-Getränk (500 ml)', short: 'Iso 500 ml', carbs: 30, grams: 500, per: 'ml', n: nut(24, 6, 0, 0, 0.1, 6), kind: 'drink' },
  { id: 'banane', name: 'Banane', short: 'Banane', carbs: 25, grams: 120, per: 'g', n: nut(93, 20, 1.2, 0.2, 0, 17, 2), kind: 'echt' },
  { id: 'datteln', name: 'Datteln (3 Stück)', short: '3 Datteln', carbs: 27, grams: 40, per: 'g', n: nut(290, 66, 2, 0.4, 0, 63, 7), kind: 'echt' },
  { id: 'fruchtgummi', name: 'Fruchtgummi', short: 'Fruchtgummi', carbs: 30, grams: 40, per: 'g', n: nut(340, 77, 6, 0.2, 0.1, 46), kind: 'echt' },
  { id: 'riegel', name: 'Müsli-/Energieriegel', short: 'Riegel', carbs: 28, grams: 45, per: 'g', n: nut(390, 62, 6, 10, 0.2, 30, 4), kind: 'echt', gluten: true },
  { id: 'laugen', name: 'Laugenbrezel', short: 'Brezel', carbs: 35, grams: 70, per: 'g', n: nut(270, 50, 8, 2, 2.5, 1, 2), kind: 'echt', gluten: true, noRun: true },
  { id: 'reiskuchen', name: 'Reiskuchen (selbst gemacht)', short: 'Reiskuchen', carbs: 30, grams: 80, per: 'g', n: nut(160, 36, 3, 1.5, 0.5, 8), kind: 'echt', noRun: true }
];
const ITEM = Object.fromEntries(FUEL_ITEMS.map(i => [i.id, i])) as Record<string, FuelItem>;

/* ---------- Ergebnis ---------- */
export interface Intake { min: number; item: FuelItem; leg?: LegSport }
export interface FuelPlan {
  level: FuelLevel; minutes: number; legs: { sport: LegSport; minutes: number }[]; tempC: number | null; weight: number;
  carbsPerHour: number; optional: boolean;
  fluidPerHour: number; sodiumPerHour: number | null;
  intakes: Intake[]; isoPerHour: number; isoBottles: number;
  totals: { carbs: number; kcal: number; fluid: number };
  before: string[]; during: string[]; after: string[]; dayBefore: string | null;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const r5 = (v: number) => Math.round(v / 5) * 5;
const r50 = (v: number) => Math.round(v / 50) * 50;

/** Kohlenhydrate pro Stunde nach Dauer und Belastung (Training ist zurückhaltender als Wettkampf). */
export function carbRate(level: FuelLevel, minutes: number, gut: GutLevel, sport: string): { rate: number; optional: boolean } {
  let rate = 0, optional = false;
  if (level === 'z2') { if (minutes > 180) rate = 40; else if (minutes > 120) { rate = 25; optional = true; } }
  else if (level === 'mittel') rate = minutes < 90 ? 30 : minutes < 150 ? 45 : 60;
  else if (level === 'hart') rate = minutes < 90 ? 40 : minutes < 150 ? 60 : 75;
  else rate = minutes < 75 ? 0 : minutes < 90 ? 45 : minutes < 150 ? 60 : 80;
  const cap = gut === 'neu' ? 60 : gut === 'manchmal' ? 75 : 90;
  if (sport === 'lauf' && gut !== 'trainiert') rate = Math.min(rate, 70);   // laufend verträgt der Magen weniger
  if (sport === 'schwimmen') rate = level === 'wettkampf' ? 0 : Math.min(rate, 30);
  return { rate: Math.min(rate, cap), optional };
}

export function fluidRate(tempC: number | null, level: FuelLevel, weight: number, sport: string): number {
  const t = tempC ?? 15;
  let ml = t < 10 ? 400 : t < 20 ? 500 : t < 25 ? 650 : 800;
  if (level === 'hart' || level === 'wettkampf') ml += 100;
  if (sport === 'schwimmen') ml -= 150;
  return r50(clamp(ml * clamp(weight / 70, 0.85, 1.2), 300, 1000));
}

function pickItems(st: FuelSettings, sport: string, level: FuelLevel, n: number): FuelItem[] {
  const ok = (i: FuelItem) => !(st.noGluten && i.gluten) && !(st.noDairy && i.dairy) && !(st.noCaffeine && i.caffeine) && !(sport !== 'rad' && i.noRun) && i.kind !== 'drink';
  const gels = FUEL_ITEMS.filter(i => i.kind === 'gel' && !i.caffeine && ok(i));
  let real = FUEL_ITEMS.filter(i => i.kind === 'echt' && ok(i));
  if (sport === 'lauf') real = real.filter(i => i.id === 'banane' || i.id === 'fruchtgummi' || i.id === 'datteln');
  const caffeine = ok(ITEM['gel-koffein']) && st.style !== 'echt' && (level === 'hart' || level === 'wettkampf') ? ITEM['gel-koffein'] : null;
  const out: FuelItem[] = [];
  for (let k = 0; k < n; k++) {
    const late = k >= n * 0.6;
    let list: FuelItem[];
    if (st.style === 'gels') list = gels;
    else if (st.style === 'echt') list = real;
    // Mischung: früh eher echtes Essen (Rad) bzw. abwechselnd, später Gels (schneller, magenschonender bei Ermüdung)
    else list = sport === 'rad' ? (late ? gels : real) : (k % 2 ? real : gels);
    if (!list.length) list = gels.length ? gels : real;
    out.push(caffeine && k === Math.floor(n * 0.7) && n >= 3 ? caffeine : list[k % list.length]);
  }
  return out;
}

export interface FuelInput { session: Pick<PlanSession, 'sport' | 'minutes' | 'intensity' | 'title'>; legs?: { sport: LegSport; minutes: number }[]; level?: FuelLevel; tempC: number | null; weight: number | null; settings: FuelSettings }

export function buildFuelPlan({ session: s, legs: lg, level: lv, tempC, weight: w, settings: st }: FuelInput): FuelPlan {
  const level = lv ?? levelOf(s);
  const legs = lg?.length ? lg : [{ sport: fuelSport(s) as LegSport, minutes: s.minutes }];
  const multi = legs.length > 1;
  const minutes = legs.reduce((a, l) => a + l.minutes, 0);
  const main = [...legs].sort((x, y) => (x.sport === 'schwimmen' ? 1 : 0) - (y.sport === 'schwimmen' ? 1 : 0) || y.minutes - x.minutes)[0];
  const sport = main.sport;
  const weight = w && w > 30 ? w : 70;
  const { rate, optional } = carbRate(level, minutes, st.gut, sport);
  const fluid = fluidRate(tempC, level, weight, sport);
  const hot = (tempC ?? 15) >= 22;
  const sodiumPerL = st.salt === 'kaum' ? 300 : st.salt === 'salzig' ? 900 : 500;
  const sodium = minutes >= 120 || hot ? r50(sodiumPerL * fluid / 1000) : null;

  // Pro Abschnitt planen: Schwimmen im Rennen nichts, im Training nur Iso am Beckenrand.
  // Iso-Getränk deckt bei höheren Mengen einen Teil ab (außer "nur echtes Essen").
  const intakes: Intake[] = [];
  let isoCount = 0, isoPerHour = 0, start = 0;
  legs.forEach((leg, li) => {
    const end = start + leg.minutes;
    const r = carbRate(level, minutes, st.gut, leg.sport).rate;
    if (leg.sport === 'schwimmen') {
      if (!multi && level !== 'wettkampf' && r) { isoPerHour = r; isoCount += Math.round(leg.minutes / 60 * r / 30 * 2) / 2; }
      start = end; return;
    }
    const iso = r >= 50 && st.style !== 'echt' ? 30 : 0;
    isoPerHour = Math.max(isoPerHour, iso);
    isoCount += iso ? Math.round(leg.minutes / 60 * iso / 30 * 2) / 2 : 0;
    const foodRate = r - iso;
    if (foodRate > 0) {
      const every = clamp(Math.round(26 / foodRate * 60 / 5) * 5, 20, 50);   // ~26 g pro Portion
      const first = li === 0 ? (level === 'z2' ? 45 : 30) : 10;
      const times: number[] = [];
      for (let t = start + first; t <= end - (li === legs.length - 1 ? 15 : 10); t += every) times.push(t);
      const items = pickItems(st, leg.sport, level, times.length);
      times.forEach((t, k) => intakes.push({ min: t, item: items[k], leg: multi ? leg.sport : undefined }));
    }
    start = end;
  });
  const hours = minutes / 60;
  const carbs = Math.round(intakes.reduce((a, i) => a + i.item.carbs, 0) + isoCount * 30);
  const kcal = Math.round(intakes.reduce((a, i) => a + (i.item.n.kcal ?? 0) * i.item.grams / 100, 0) + isoCount * 120);
  const fluidTotal = r50(fluid * hours);

  const race = level === 'wettkampf';
  const preKh = r5(weight * (race ? 2 : level === 'z2' ? 1 : 1.5));
  const before = level === 'z2' && minutes <= 120
    ? ['Normal essen, keine extra Kohlenhydrate nötig.', 'Letzte größere Mahlzeit 2–3 h vorher, danach nur noch etwas Leichtes.']
    : [`2–3 h vorher: ca. ${preKh} g Kohlenhydrate (z. B. Haferflocken, Brot mit Honig, Reis), wenig Fett und Ballaststoffe.`,
       'Vorher ca. 300–500 ml trinken.', ...(race ? ['Nur Lebensmittel, die du kennst – nichts Neues am Wettkampftag.', ...(minutes >= 90 && !st.noCaffeine ? ['10–15 min vor dem Start: optional 1 Gel und ein paar Schlucke.'] : minutes >= 90 ? ['10–15 min vor dem Start: optional 1 Gel ohne Koffein und ein paar Schlucke.'] : [])] : [])];
  const during: string[] = [];
  if (!rate) during.push(sport === 'schwimmen' && level === 'wettkampf' ? 'Im Rennen nichts essen – vorher gut essen und trinken.' : 'Kein Essen nötig – Wasser nach Durst reicht.');
  else {
    during.push(optional ? `Optional ca. ${rate} g Kohlenhydrate pro Stunde – hält die Qualität am Ende hoch und hilft der Erholung.` : `Ca. ${rate} g Kohlenhydrate pro Stunde, früh anfangen statt aufholen.`);
    if (multi) during.push('Schwimmen: nichts. Rad: Hauptteil der Verpflegung, dort verträgt der Magen am meisten. Laufen: Gels und Iso, gern an den Verpflegungsstellen.');
    if (isoPerHour && sport !== 'schwimmen') during.push(`Davon ca. ${isoPerHour} g über Iso-Getränk (≈ 500 ml/h), Rest über die Snacks unten.`);
    if (sport === 'schwimmen' && !multi && level !== 'wettkampf') during.push('Im Wasser nichts essen – bei Pausen am Beckenrand Iso trinken.');
  }
  during.push(`Trinken: ca. ${fluid} ml pro Stunde${hot ? ', bei Wärme lieber etwas mehr' : ''} – nach Durst, nicht mehr als nötig.`);
  if (sodium) during.push(`Salz: ca. ${sodium} mg Natrium pro Stunde (Iso, Salztabletten, Brezel).`);
  if (rate > 60 && st.gut !== 'trainiert') during.push('Höhere Mengen vorher im Training üben, sonst drohen Magenprobleme.');
  const recKh = Math.round(weight * (level === 'z2' ? 0.8 : 1.0));
  const after = [
    `In den ersten 1–2 h: ca. ${recKh} g Kohlenhydrate und 20–30 g Eiweiß (z. B. Reis/Nudeln mit Hähnchen oder Joghurt mit Haferflocken und Obst).`,
    sodium ? 'Flüssigkeit auffüllen, gern mit etwas Salz (Brühe, salziges Essen).' : 'Nach Durst trinken.'
  ];
  const dayBefore = race && minutes >= 90 ? `Kohlenhydratbetont essen, ca. ${r5(weight * (minutes >= 150 ? 8 : 6))} g Kohlenhydrate über den Tag verteilt, wenig Ballaststoffe am Abend.` : null;

  return { level, minutes, legs, tempC, weight, carbsPerHour: rate, optional, fluidPerHour: fluid, sodiumPerHour: sodium, intakes, isoPerHour, isoBottles: isoCount,
    totals: { carbs, kcal, fluid: fluidTotal }, before, during, after, dayBefore };
}

/* ---------- Kontext laden (Gewicht, Einstellungen, Wetter) ---------- */
export const latestWeight = async () => (await db.morning.orderBy('date').reverse().filter(m => m.weight != null).first())?.weight ?? null;

export interface Loc { lat: number; lon: number }
interface WeatherCache { lat: number; lon: number; at: number; tmax: Record<string, number> }
export const getLoc = () => getSetting<Loc>('fuelLoc');
export const setLoc = (l: Loc | null) => setSetting('fuelLoc', l);

/** Tageshöchsttemperaturen der nächsten 16 Tage (Open-Meteo, kostenlos, ohne Schlüssel); 3 h gecacht. */
export async function forecastTemps(force = false): Promise<Record<string, number>> {
  const loc = await getLoc();
  const cache = await getSetting<WeatherCache>('fuelWeather');
  if (!loc) return cache?.tmax ?? {};
  const fresh = cache && cache.lat === loc.lat && cache.lon === loc.lon && Date.now() - cache.at < 3 * 3600e3;
  if (fresh && !force) return cache!.tmax;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat.toFixed(2)}&longitude=${loc.lon.toFixed(2)}&daily=temperature_2m_max&forecast_days=16&timezone=auto`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    const j = await res.json() as { daily?: { time: string[]; temperature_2m_max: (number | null)[] } };
    const tmax: Record<string, number> = {};
    j.daily?.time.forEach((d, i) => { const v = j.daily!.temperature_2m_max[i]; if (v != null) tmax[d] = v; });
    // vergangene Tage behalten (für die Nachfrage nach der Einheit)
    if (cache?.tmax) for (const [d, v] of Object.entries(cache.tmax)) if (!(d in tmax) && d >= addDays(today(), -3)) tmax[d] = v;
    await setSetting('fuelWeather', { lat: loc.lat, lon: loc.lon, at: Date.now(), tmax });
    return tmax;
  } catch { return cache?.tmax ?? {}; }
}
export const cachedTemps = async () => (await getSetting<WeatherCache>('fuelWeather'))?.tmax ?? {};

/** Eingriffe pro Einheit: Belastung bzw. Temperatur für den Tag ändern, Antwort auf "wie geplant gegessen?". */
export interface FuelOverride { level?: FuelLevel; tempC?: number; minutes?: number; logged?: 'ja' | 'nein'; at: number }
export async function getOverrides(): Promise<Record<string, FuelOverride>> { return (await getSetting<Record<string, FuelOverride>>('fuelOverrides')) ?? {}; }
export async function setOverride(key: string, change: Partial<FuelOverride> | null) {
  const all = await getOverrides();
  if (change === null) delete all[key]; else all[key] = { ...all[key], ...change, at: Date.now() };
  const cutoff = Date.now() - 60 * 86400e3;
  for (const [k, v] of Object.entries(all)) if (v.at < cutoff) delete all[k];
  await setSetting('fuelOverrides', JSON.parse(JSON.stringify(all)));
}

export interface FuelEnv { settings: FuelSettings; weight: number | null; temps: Record<string, number>; overrides: Record<string, FuelOverride> }
export async function loadFuelEnv(fetchWeather = false): Promise<FuelEnv> {
  const [settings, weight, temps, overrides] = await Promise.all([getFuelSettings(), latestWeight(), fetchWeather ? forecastTemps() : cachedTemps(), getOverrides()]);
  return { settings, weight, temps, overrides };
}
export function planFor(s: PlanSession, env: FuelEnv): FuelPlan {
  const o = env.overrides[s.key];
  let legs = s.race?.legs.map(l => ({ ...l })) as { sport: LegSport; minutes: number }[] | undefined;
  const est = legs ? legs.reduce((a, l) => a + l.minutes, 0) : s.minutes;
  if (o?.minutes && est > 0) legs = (legs ?? [{ sport: fuelSport(s) as LegSport, minutes: est }]).map(l => ({ ...l, minutes: Math.round(l.minutes * o.minutes! / est) }));
  return buildFuelPlan({ session: s, legs, level: o?.level, tempC: o?.tempC ?? env.temps[s.date] ?? null, weight: env.weight, settings: env.settings });
}

/* ---------- Garmin: Essenszeitpunkte als eigene Schritte ---------- */
const durMin = (d: string): number | null => {
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(d);
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  return (+(m[1] ?? 0)) * 60 + (+(m[2] ?? 0)) + (+(m[3] ?? 0)) / 60;
};
const fmtDur = (min: number) => { const s = Math.round(min * 60); const mm = Math.floor(s / 60), ss = s % 60; return mm && ss ? `${mm}m${ss}s` : mm ? `${mm}m` : `${ss}s`; };

/**
 * Fügt in den Hauptteil eines intervals.icu-Workouts (Zeilen nach "body()") kurze 1-min-Schritte
 * "Essen: Gel" zu den Essenszeitpunkten ein. Schritte in Wiederholungsblöcken werden nicht geteilt;
 * fällt ein Zeitpunkt dort hinein, rückt er an die nächste Grenze außerhalb des Blocks.
 */
export function insertIntakes(lines: string[], total: number, intakes: Intake[], hot = false): string[] {
  if (!intakes.length) return lines;
  interface Seg { start: number; dur: number; lines: string[]; step?: { cue: string; target: string } }
  const segs: Seg[] = [];
  let i = 0;
  while (i < lines.length) {
    const ln = lines[i];
    if (ln.trim() === '') { i++; continue; }
    const st = /^- (.*?)\s*(\d+h\d*m?\d*s?|\d+m\d*s?|\d+s)\s+(.*)$/.exec(ln) ?? /^- (.*?)\s*(\d+h\d*m?\d*s?|\d+m\d*s?|\d+s)$/.exec(ln);
    if (st && !/\d+x$/.test(ln)) { const d = durMin(st[2]); if (d != null) { segs.push({ start: 0, dur: d, lines: [ln], step: { cue: st[1].trim(), target: (st[3] ?? '').trim() } }); i++; continue; } }
    // Blockkopf bzw. sonstiger Text: alles bis zur nächsten Leerzeile ist ein Block
    const blk: string[] = [];
    while (i < lines.length && lines[i].trim() !== '') blk.push(lines[i++]);
    segs.push({ start: 0, dur: -1, lines: ['', ...blk, ''] });
  }
  const known = segs.filter(s => s.dur >= 0).reduce((a, s) => a + s.dur, 0);
  const blocks = segs.filter(s => s.dur < 0);
  for (const b of blocks) b.dur = Math.max(0, (total - known) / blocks.length);
  let t = 0; for (const s of segs) { s.start = t; t += s.dur; }

  // Zeitpunkte in Blöcken an die nähere Blockgrenze rücken, gleiche Zeitpunkte zusammenfassen
  const times = new Map<number, string[]>();
  for (const it of intakes) {
    let at = it.min;
    const blk = segs.find(sg => !sg.step && at > sg.start && at < sg.start + sg.dur);
    if (blk) at = at - blk.start <= blk.start + blk.dur - at ? blk.start : blk.start + blk.dur;
    at = Math.round(at * 60) / 60;
    times.set(at, [...(times.get(at) ?? []), it.item.short]);
  }
  const queue = [...times].sort((x, y) => x[0] - y[0]).map(([min, names]) => ({ min, label: `Essen: ${names.join(' + ')}${hot ? ' + trinken' : ''}` }));
  const out: string[] = [];
  let lastTarget = '';
  const line = (cue: string, d: number, target: string) => `- ${cue} ${fmtDur(d)} ${target}`.replace(/\s+/g, ' ').trim();
  for (const s of segs) {
    if (!s.step) {
      // Snack genau am Blockanfang: kurzer Schritt direkt davor
      while (queue.length && queue[0].min <= s.start + 0.01) out.push(line(queue.shift()!.label, 1, lastTarget));
      out.push(...s.lines);
      continue;
    }
    lastTarget = s.step.target;
    let pos = s.start; const end = s.start + s.dur;
    while (queue.length && queue[0].min < end - 2) {
      const q = queue.shift()!;
      const at = Math.max(pos, q.min);
      if (at - pos >= 2) out.push(line(s.step.cue, at - pos, s.step.target));
      const len = Math.min(1, end - at);
      out.push(line(q.label, len, s.step.target));
      pos = at + len;
    }
    if (end - pos > 0.05) out.push(pos === s.start ? s.lines[0] : line(s.step.cue, end - pos, s.step.target));
  }
  return out;
}
