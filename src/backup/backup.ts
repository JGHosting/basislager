/**
 * Komplett-Backup als JSON: Export, Prüfung, Migration, Import, Prüfroutine.
 *
 * Regeln:
 * - Jede Tabelle der Datenbank muss in BACKUP_TABLES stehen (außer EXCLUDED_TABLES).
 *   Die Prüfroutine schlägt fehl, wenn eine Tabelle fehlt → nichts geht unbemerkt verloren.
 * - Der intervals.icu-API-Schlüssel wird bewusst NICHT exportiert (Backup liegt in iCloud/Dateien).
 * - Ein Import schreibt alles in EINER Transaktion: entweder komplett oder gar nicht.
 * - Vor jedem Import wird eine interne Sicherheitskopie angelegt.
 */
import type { BasislagerDB, Activity, MorningEntry, SettingRow, StrengthSession, SplitTemplate, Food, FoodLogEntry, NutritionDay, Injury } from '../core/db';
import { db as mainDb, BasislagerDB as DBClass, setSetting } from '../core/db';
import Dexie from 'dexie';

export const SCHEMA_VERSION = 7;
export const BACKUP_TABLES = ['settings', 'activities', 'morning', 'strength', 'splits', 'foods', 'foodlog', 'nutritionDays', 'injuries'] as const;
export const EXCLUDED_TABLES = ['snapshots'];
/** Einstellungen, die nicht ins Backup gehören (Geheimnisse, gerätespezifisch). */
const EXCLUDED_SETTINGS = new Set(['intervals']);

export type TableName = typeof BACKUP_TABLES[number];
export interface BackupFile {
  app: 'basislager';
  schemaVersion: number;
  exportedAt: string;
  tables: { settings: SettingRow[]; activities: Activity[]; morning: MorningEntry[]; strength: StrengthSession[]; splits: SplitTemplate[]; foods: Food[]; foodlog: FoodLogEntry[]; nutritionDays: NutritionDay[]; injuries: Injury[] };
}

/* ---------- Export ---------- */

export async function exportBackup(d: BasislagerDB = mainDb): Promise<BackupFile> {
  return d.transaction('r', [d.settings, d.activities, d.morning, d.strength, d.splits, d.foods, d.foodlog, d.nutritionDays, d.injuries], async () => ({
    app: 'basislager' as const,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    tables: {
      settings: (await d.settings.toArray()).filter(s => !EXCLUDED_SETTINGS.has(s.key)),
      activities: await d.activities.toArray(),
      morning: await d.morning.toArray(),
      strength: await d.strength.toArray(),
      splits: await d.splits.toArray(),
      foods: await d.foods.toArray(),
      foodlog: await d.foodlog.toArray(),
      nutritionDays: await d.nutritionDays.toArray(),
      injuries: await d.injuries.toArray()
    }
  }));
}

export function backupFileName(ext = 'json', what = 'backup') {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `basislager-${what}-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.${ext}`;
}

/* ---------- Prüfen + Migrieren ---------- */

export interface Preview {
  ok: boolean;
  fatal?: string;                    // Datei unbrauchbar → Import nicht möglich
  warnings: string[];                // einzelne fehlerhafte Datensätze (werden übersprungen)
  schemaVersion?: number;
  exportedAt?: string;
  counts: Record<TableName, number>;
  range?: { from: string; to: string };
  data?: BackupFile;                 // bereinigt + migriert, bereit zum Import
}

const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const empty = (): Record<TableName, number> => ({ settings: 0, activities: 0, morning: 0, strength: 0, splits: 0, foods: 0, foodlog: 0, nutritionDays: 0, injuries: 0 });

/** Bringt ältere Backups auf den aktuellen Stand. Für jede Schema-Änderung hier einen Schritt ergänzen. */
function migrate(raw: any): any {
  let v = raw.schemaVersion;
  // Beispiel für künftige Änderungen:
  // if (v === 3) { raw.tables.neueTabelle = []; v = 4; }
  if (v < 2) { raw.tables.activities ??= []; raw.tables.morning ??= []; v = 2; }
  if (v < 3) { v = 3; } // v3 brachte nur die interne Tabelle "snapshots"
  if (v < 4) {           // v4: alte Garmin-Gewichte vor 07.09.2026 entfernen
    for (const m of raw.tables.morning ?? []) if (m?.date < '2026-09-07' && m.weight != null && m.sources?.weight !== 'manual') { m.weight = null; if (m.sources) delete m.sources.weight; }
    v = 4;
  }
  if (v < 5) { raw.tables.strength ??= []; raw.tables.splits ??= []; v = 5; }
  if (v < 6) { raw.tables.foods ??= []; raw.tables.foodlog ??= []; raw.tables.nutritionDays ??= []; v = 6; }
  if (v < 7) { raw.tables.injuries ??= []; v = 7; }
  raw.schemaVersion = v;
  return raw;
}

export function checkBackup(text: string): Preview {
  const fail = (fatal: string): Preview => ({ ok: false, fatal, warnings: [], counts: empty() });
  let raw: any;
  try { raw = JSON.parse(text); } catch { return fail('Die Datei ist kein gültiges JSON (beschädigt oder falsche Datei).'); }
  if (!raw || raw.app !== 'basislager') return fail('Das ist kein Basislager-Backup.');
  if (typeof raw.schemaVersion !== 'number') return fail('Im Backup fehlt die Versionsangabe.');
  if (raw.schemaVersion > SCHEMA_VERSION)
    return fail(`Das Backup stammt aus einer neueren App-Version (${raw.schemaVersion}). Bitte die App erst aktualisieren.`);
  if (!raw.tables || typeof raw.tables !== 'object') return fail('Im Backup fehlen die Daten.');
  const fromVersion = raw.schemaVersion;
  raw = migrate(raw);

  const warnings: string[] = [];
  if (fromVersion < SCHEMA_VERSION) warnings.push(`Backup von Version ${fromVersion} wurde auf Version ${SCHEMA_VERSION} umgewandelt.`);
  for (const t of BACKUP_TABLES) {
    if (!Array.isArray(raw.tables[t])) return fail(`Tabelle „${t}“ fehlt oder ist beschädigt.`);
  }
  const bad: Record<string, number> = {};
  const keep = <T>(t: string, rows: any[], valid: (r: any) => boolean): T[] =>
    rows.filter(r => { const ok = r && typeof r === 'object' && valid(r); if (!ok) bad[t] = (bad[t] ?? 0) + 1; return ok; });

  const settings = keep<SettingRow>('Einstellungen', raw.tables.settings, r => typeof r.key === 'string' && !EXCLUDED_SETTINGS.has(r.key));
  const activities = keep<Activity>('Aktivitäten', raw.tables.activities, r =>
    typeof r.id === 'string' && typeof r.sourceId === 'string' && isDate(r.date) && typeof r.start === 'string');
  const morning = keep<MorningEntry>('Morgenwerte', raw.tables.morning, r => isDate(r.date));
  const strength = keep<StrengthSession>('Krafteinheiten', raw.tables.strength, r => typeof r.id === 'string' && isDate(r.date) && Array.isArray(r.muscleGroups));
  const splits = keep<SplitTemplate>('Split-Vorlagen', raw.tables.splits, r => typeof r.id === 'string' && Array.isArray(r.days));
  const foods = keep<Food>('Lebensmittel', raw.tables.foods, r => typeof r.id === 'string' && typeof r.name === 'string');
  const foodlog = keep<FoodLogEntry>('Ernährungseinträge', raw.tables.foodlog, r => typeof r.id === 'string' && isDate(r.date) && typeof r.grams === 'number' && r.snapshot);
  const nutritionDays = keep<NutritionDay>('Tracking-Tage', raw.tables.nutritionDays, r => isDate(r.date));
  const injuries = keep<Injury>('Verletzungen', raw.tables.injuries, r => typeof r.id === 'string' && isDate(r.startDate) && r.movement && typeof r.stage === 'number');
  for (const [t, n] of Object.entries(bad)) warnings.push(`${n} fehlerhafte(r) Eintrag/Einträge bei ${t} werden übersprungen.`);

  const dates = [...activities.map(a => a.date), ...morning.map(m => m.date)].sort();
  return {
    ok: true, warnings,
    schemaVersion: fromVersion,
    exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : undefined,
    counts: { settings: settings.length, activities: activities.length, morning: morning.length, strength: strength.length, splits: splits.length, foods: foods.length, foodlog: foodlog.length, nutritionDays: nutritionDays.length, injuries: injuries.length },
    range: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : undefined,
    data: { app: 'basislager', schemaVersion: SCHEMA_VERSION, exportedAt: raw.exportedAt, tables: { settings, activities, morning, strength, splits, foods, foodlog, nutritionDays, injuries } }
  };
}

/* ---------- Import ---------- */

export type ImportMode = 'replace' | 'merge';
export interface ImportResult { added: number; updated: number; unchanged: number }

const newer = (a?: { updatedAt?: number }, b?: { updatedAt?: number }) => (a?.updatedAt ?? 0) > (b?.updatedAt ?? 0);

/**
 * Spielt ein geprüftes Backup ein.
 * replace: alle Daten (außer Zugangsdaten) werden durch das Backup ersetzt.
 * merge:   neue Datensätze kommen dazu; bei gleichen Datensätzen gewinnt der neuere Stand (updatedAt).
 */
export async function importBackup(data: BackupFile, mode: ImportMode, d: BasislagerDB = mainDb, makeSnapshot = true): Promise<ImportResult> {
  if (makeSnapshot) await createSnapshot(mode === 'replace' ? 'Vor Import (Ersetzen)' : 'Vor Import (Zusammenführen)', d);
  const res: ImportResult = { added: 0, updated: 0, unchanged: 0 };
  // Reine Kopie der Daten (entfernt UI-Proxys, die IndexedDB nicht speichern kann)
  const t: BackupFile['tables'] = JSON.parse(JSON.stringify(data.tables));

  await d.transaction('rw', [d.settings, d.activities, d.morning, d.strength, d.splits, d.foods, d.foodlog, d.nutritionDays, d.injuries], async () => {
    if (mode === 'replace') {
      const keepSettings = (await d.settings.toArray()).filter(s => EXCLUDED_SETTINGS.has(s.key));
      await Promise.all([d.settings.clear(), d.activities.clear(), d.morning.clear(), d.strength.clear(), d.splits.clear(), d.foods.clear(), d.foodlog.clear(), d.nutritionDays.clear(), d.injuries.clear()]);
      await d.settings.bulkPut([...t.settings, ...keepSettings]);
      await d.activities.bulkPut(t.activities);
      await d.morning.bulkPut(t.morning);
      await d.strength.bulkPut(t.strength);
      await d.splits.bulkPut(t.splits);
      await d.foods.bulkPut(t.foods);
      await d.foodlog.bulkPut(t.foodlog);
      await d.nutritionDays.bulkPut(t.nutritionDays);
      await d.injuries.bulkPut(t.injuries);
      res.added = BACKUP_TABLES.reduce((n, k) => n + t[k].length, 0);
      return;
    }
    // Zusammenführen: Einstellungen nur ergänzen, nichts Vorhandenes überschreiben
    for (const s of t.settings) {
      if (await d.settings.get(s.key)) res.unchanged++; else { await d.settings.put(s); res.added++; }
    }
    // Aktivitäten: gleiche Aktivität = gleiche sourceId (auch wenn die eigene ID abweicht)
    const existing = new Map((await d.activities.toArray()).map(a => [a.sourceId, a]));
    const puts: Activity[] = [];
    for (const a of t.activities) {
      const e = existing.get(a.sourceId);
      if (!e) { puts.push(a); res.added++; }
      else if (newer(a, e)) { puts.push({ ...a, id: e.id, createdAt: e.createdAt }); res.updated++; }
      else res.unchanged++;
    }
    await d.activities.bulkPut(puts);
    const mExisting = new Map((await d.morning.toArray()).map(m => [m.date, m]));
    const mPuts: MorningEntry[] = [];
    for (const m of t.morning) {
      const e = mExisting.get(m.date);
      if (!e) { mPuts.push(m); res.added++; }
      else if (newer(m, e)) { mPuts.push(m); res.updated++; }
      else res.unchanged++;
    }
    await d.morning.bulkPut(mPuts);
    // Krafteinheiten + Vorlagen: über ID; bei gleicher verknüpfter Aktivität zählt der neuere Stand
    for (const k of t.strength) {
      const e = (await d.strength.get(k.id)) ?? (k.activityId ? await d.strength.where('activityId').equals(k.activityId).first() : undefined);
      if (!e) { await d.strength.put(k); res.added++; }
      else if (newer(k, e)) { await d.strength.delete(e.id); await d.strength.put(k); res.updated++; }
      else res.unchanged++;
    }
    // Vorlagen, Lebensmittel, Einträge, Tracking-Tage: über Schlüssel, neuerer Stand gewinnt
    const mergeByKey = async <T extends { updatedAt?: number }>(table: import('dexie').Table<T, string>, rows: T[], key: (r: T) => string) => {
      for (const r of rows) {
        const e = await table.get(key(r));
        if (!e) { await table.put(r); res.added++; }
        else if (newer(r, e)) { await table.put(r); res.updated++; }
        else res.unchanged++;
      }
    };
    await mergeByKey(d.splits, t.splits, r => r.id);
    await mergeByKey(d.foods, t.foods, r => r.id);
    await mergeByKey(d.foodlog, t.foodlog, r => r.id);
    await mergeByKey(d.nutritionDays, t.nutritionDays, r => r.date);
    await mergeByKey(d.injuries, t.injuries, r => r.id);
  });
  return res;
}

/* ---------- Sicherheitskopien ---------- */

const MAX_SNAPSHOTS = 3;
export async function createSnapshot(reason: string, d: BasislagerDB = mainDb) {
  const data = await exportBackup(d);
  await d.snapshots.add({ createdAt: Date.now(), reason, data });
  const all = await d.snapshots.orderBy('createdAt').primaryKeys();
  if (all.length > MAX_SNAPSHOTS) await d.snapshots.bulkDelete(all.slice(0, all.length - MAX_SNAPSHOTS));
}
export async function listSnapshots() {
  return (await mainDb.snapshots.orderBy('createdAt').reverse().toArray())
    .map(s => ({ seq: s.seq!, createdAt: s.createdAt, reason: s.reason, counts: countsOf(s.data as BackupFile) }));
}
export async function restoreSnapshot(seq: number) {
  const s = await mainDb.snapshots.get(seq);
  if (!s) throw new Error('Sicherheitskopie nicht gefunden.');
  await importBackup(s.data as BackupFile, 'replace', mainDb, true);
}
const countsOf = (b: BackupFile) => ({ activities: b.tables.activities.length, morning: b.tables.morning.length, strength: b.tables.strength?.length ?? 0, foodlog: b.tables.foodlog?.length ?? 0 });

/* ---------- Prüfroutine (Pflicht-Testfall) ---------- */

/** Stabile Textform eines Backups: Zeilen nach Schlüssel sortiert, Objekt-Schlüssel sortiert, ohne Zeitstempel des Exports. */
export function canonical(b: BackupFile): string {
  const sortKeys = (v: any): any => Array.isArray(v) ? v.map(sortKeys)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])])) : v;
  const key: Record<TableName, (r: any) => string> = { settings: r => r.key, activities: r => r.id, morning: r => r.date, strength: r => r.id, splits: r => r.id, foods: r => r.id, foodlog: r => r.id, nutritionDays: r => r.date, injuries: r => r.id };
  const tables: any = {};
  for (const t of BACKUP_TABLES) tables[t] = [...b.tables[t]].sort((x, y) => key[t](x).localeCompare(key[t](y))).map(sortKeys);
  return JSON.stringify({ schemaVersion: b.schemaVersion, tables });
}

export interface RoundtripResult { ok: boolean; message: string; counts: Record<TableName, number>; ms: number }

/**
 * Export → als Datei-Text serialisieren → in LEERE Test-Datenbank importieren → erneut exportieren → vergleichen.
 * Deine echten Daten werden dabei nicht angefasst.
 */
export async function runRoundtripTest(): Promise<RoundtripResult> {
  const t0 = performance.now();
  const TEST = 'basislager-roundtrip-test';
  const counts = empty();
  // 1. Alle Tabellen abgedeckt?
  const missing = mainDb.tables.map(t => t.name).filter(n => !(BACKUP_TABLES as readonly string[]).includes(n) && !EXCLUDED_TABLES.includes(n));
  if (missing.length) return { ok: false, message: `Tabelle(n) fehlen im Backup: ${missing.join(', ')}`, counts, ms: 0 };

  const before = await exportBackup();
  for (const t of BACKUP_TABLES) counts[t] = before.tables[t].length;
  await Dexie.delete(TEST);
  const test = new DBClass(TEST);
  try {
    const preview = checkBackup(JSON.stringify(before));     // wie eine echte Datei
    if (!preview.ok || !preview.data) return { ok: false, message: 'Eigenes Backup nicht lesbar: ' + preview.fatal, counts, ms: 0 };
    if (preview.warnings.length) return { ok: false, message: 'Eigenes Backup enthält fehlerhafte Einträge: ' + preview.warnings.join(' '), counts, ms: 0 };
    await importBackup(preview.data, 'replace', test, false);
    const after = await exportBackup(test);
    const a = canonical(before), b = canonical(after);
    if (a !== b) {
      const only = (x: BackupFile, t: TableName) => canonical({ ...x, tables: { ...Object.fromEntries(BACKUP_TABLES.map(k => [k, []])), [t]: x.tables[t] } as BackupFile['tables'] });
      const diff = BACKUP_TABLES.filter(t => only(before, t) !== only(after, t));
      return { ok: false, message: `Unterschiede nach dem Import in: ${diff.join(', ') || 'unbekannt'}`, counts, ms: performance.now() - t0 };
    }
    return { ok: true, message: 'Export und Import sind identisch.', counts, ms: performance.now() - t0 };
  } finally {
    test.close();
    await Dexie.delete(TEST);
  }
}

/* ---------- Teilen / Speichern ---------- */

/** Öffnet das iOS-Teilen-Menü (Dateien, AirDrop …). Fallback: normaler Download. Gibt true zurück, wenn gespeichert. */
export async function shareFile(content: string, name: string, type: string): Promise<boolean> {
  const file = new File([content], name, { type });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return true; }
    catch (e) { if ((e as Error).name === 'AbortError') return false; /* sonst Fallback */ }
  }
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return true;
}

export async function markBackupDone() { await setSetting('lastBackupAt', Date.now()); }

/* ---------- CSV ---------- */

export function toCsv(rows: Record<string, unknown>[], cols: string[]): string {
  const esc = (v: unknown) => {
    if (v == null) return '';
    const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // Semikolon + Komma als Dezimaltrenner → öffnet sich in deutschem Excel/Numbers direkt richtig
  return '﻿' + [cols.join(';'), ...rows.map(r => cols.map(c => esc(r[c])).join(';'))].join('\n');
}
export async function activitiesCsv() {
  const rows = await mainDb.activities.orderBy('date').toArray();
  return toCsv(rows as any, ['date', 'start', 'sportType', 'name', 'duration', 'elapsed', 'distance', 'elevationGain', 'avgHr', 'maxHr', 'sourceLoad', 'sourceId']);
}
export async function morningCsv() {
  const rows = await mainDb.morning.orderBy('date').toArray();
  return toCsv(rows as any, ['date', 'hrv', 'restingHr', 'sleepScore', 'sleepSecs', 'weight', 'feltRecovery', 'pain']);
}
