/**
 * Minimaler Client für die intervals.icu-API.
 * Anmeldung: HTTP Basic Auth, Benutzer "API_KEY", Passwort = persönlicher Schlüssel.
 * Es wird nur mit intervals.icu gesprochen, keine weiteren Dienste.
 */
const BASE = 'https://intervals.icu/api/v1';

export interface Credentials { athleteId: string; apiKey: string }

export interface IcuAthlete { id: string; name?: string; firstname?: string }
export interface IcuActivity {
  id: string;
  start_date_local: string;
  type: string;
  name?: string;
  moving_time?: number | null;
  elapsed_time?: number | null;
  distance?: number | null;
  total_elevation_gain?: number | null;
  average_heartrate?: number | null;
  max_heartrate?: number | null;
  icu_training_load?: number | null;
  source?: string;
}
export interface IcuWellness {
  id: string;                // Datum YYYY-MM-DD
  hrv?: number | null;
  restingHR?: number | null;
  sleepScore?: number | null;
  sleepSecs?: number | null;
  weight?: number | null;
}

/** Kalendereintrag (geplantes Training, Notiz, Wettkampf). */
export interface IcuEvent {
  id: number | string;
  start_date_local: string;
  category: string;          // WORKOUT, NOTE, RACE_A/B/C, HOLIDAY, SICK …
  name?: string;
  type?: string;             // Sportart bei WORKOUT
  moving_time?: number | null;
  distance?: number | null;
  icu_training_load?: number | null;
  description?: string | null;
  external_id?: string | null;
}

export class IcuError extends Error {
  constructor(message: string, public kind: 'auth' | 'notfound' | 'network' | 'ratelimit' | 'other') {
    super(message);
  }
}

async function get<T>(cred: Credentials, path: string, method = 'GET', body?: unknown): Promise<T> {
  let res: Response;
  try {
    const headers: Record<string, string> = { Authorization: 'Basic ' + btoa('API_KEY:' + cred.apiKey.trim()) };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new IcuError('Keine Verbindung zu intervals.icu. Bist du offline?', 'network');
  }
  if (res.status === 401 || res.status === 403)
    throw new IcuError('API-Schlüssel oder Athlete-ID passen nicht zusammen.', 'auth');
  if (res.status === 404) throw new IcuError('Athlete-ID nicht gefunden.', 'notfound');
  if (res.status === 429) throw new IcuError('Zu viele Anfragen. Bitte in einer Minute nochmal.', 'ratelimit');
  if (!res.ok) throw new IcuError(`intervals.icu antwortet mit Fehler ${res.status}.`, 'other');
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export const icu = {
  athlete: (c: Credentials) => get<IcuAthlete>(c, `/athlete/${c.athleteId}`),
  /** Aktivitäten zwischen zwei Tagen (jeweils inklusive). */
  activities: (c: Credentials, oldest: string, newest: string) =>
    get<IcuActivity[]>(c, `/athlete/${c.athleteId}/activities?oldest=${oldest}&newest=${newest}`),
  events: (c: Credentials, oldest: string, newest: string) =>
    get<IcuEvent[]>(c, `/athlete/${c.athleteId}/events?oldest=${oldest}&newest=${newest}`),
  /** Vollständige Daten einer Aktivität (Zonen, Trittfrequenz, Leistung, Kalorien …). */
  activity: (c: Credentials, id: string) => get<Record<string, unknown>>(c, `/activity/${encodeURIComponent(id)}`),
  /** Zeitreihen einer Aktivität (hier: Puls + Zeit), für eigene Zonenberechnung. */
  streams: (c: Credentials, id: string, types: string[]) =>
    get<{ type: string; data: (number | null)[] }[]>(c, `/activity/${encodeURIComponent(id)}/streams?types=${types.join(',')}`),
  wellness: (c: Credentials, oldest: string, newest: string) =>
    get<IcuWellness[]>(c, `/athlete/${c.athleteId}/wellness?oldest=${oldest}&newest=${newest}`),
  /** Beste Pace-Kurven (Laufen) über die angegebenen Zeiträume, z. B. ['all', '1y']. */
  paceCurves: (c: Credentials, curves: string[]) =>
    get<{ list?: { id?: string; label?: string; distance?: number[]; values?: number[]; secs?: number[]; activity_id?: string[] }[]; activities?: Record<string, unknown> }>(
      c, `/athlete/${c.athleteId}/pace-curves.json?type=Run&curves=${curves.join(',')}`),
  /** Geplante Workouts anlegen/aktualisieren (Abgleich über external_id). */
  upsertEvents: (c: Credentials, events: IcuEventIn[]) =>
    get<IcuEvent[]>(c, `/athlete/${c.athleteId}/events/bulk?upsert=true`, 'POST', events),
  updateEvent: (c: Credentials, id: number | string, ev: IcuEventIn) =>
    get<IcuEvent>(c, `/athlete/${c.athleteId}/events/${id}`, 'PUT', ev),
  deleteEvents: (c: Credentials, refs: ({ id: number | string } | { external_id: string })[]) =>
    get<unknown>(c, `/athlete/${c.athleteId}/events/bulk-delete`, 'PUT', refs)
};

export interface IcuEventIn {
  category: 'WORKOUT'; start_date_local: string; type: string; name: string;
  description: string; moving_time: number; external_id: string;
}

/** Normalisiert die Eingabe: "i123456", "123456" oder ganze URL → "i123456". */
export function normalizeAthleteId(input: string): string {
  const m = input.trim().match(/i?(\d+)/);
  return m ? 'i' + m[1] : input.trim();
}
