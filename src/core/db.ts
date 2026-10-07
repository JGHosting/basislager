/**
 * Lokale Datenbank (IndexedDB über Dexie).
 * Jede Schema-Änderung bekommt eine neue version(n) – alte Stände werden
 * automatisch migriert. Neue Tabellen müssen immer auch in Export/Import.
 */
import Dexie, { type Table } from 'dexie';

export interface SettingRow { key: string; value: unknown }

export class BasislagerDB extends Dexie {
  settings!: Table<SettingRow, string>;
  constructor() {
    super('basislager');
    this.version(1).stores({ settings: 'key' });
  }
}

export const db = new BasislagerDB();

export async function getSetting<T>(key: string): Promise<T | undefined> {
  return (await db.settings.get(key))?.value as T | undefined;
}
export async function setSetting(key: string, value: unknown) {
  await db.settings.put({ key, value });
}
export async function deleteSetting(key: string) {
  await db.settings.delete(key);
}

/** Bittet den Browser, die Daten nicht automatisch zu löschen. */
export async function requestPersistence(): Promise<'granted' | 'denied' | 'unsupported'> {
  if (!navigator.storage?.persist) return 'unsupported';
  if (await navigator.storage.persisted()) return 'granted';
  return (await navigator.storage.persist()) ? 'granted' : 'denied';
}
