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
  moving_time?: number;      // Sekunden
  elapsed_time?: number;
  distance?: number;         // Meter
  total_elevation_gain?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  icu_training_load?: number;
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

export class IcuError extends Error {
  constructor(message: string, public kind: 'auth' | 'notfound' | 'network' | 'other') {
    super(message);
  }
}

async function get<T>(cred: Credentials, path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      headers: { Authorization: 'Basic ' + btoa('API_KEY:' + cred.apiKey.trim()) }
    });
  } catch {
    throw new IcuError('Keine Verbindung zu intervals.icu (offline oder vom Browser blockiert).', 'network');
  }
  if (res.status === 401 || res.status === 403)
    throw new IcuError('API-Schlüssel oder Athlete-ID passen nicht zusammen.', 'auth');
  if (res.status === 404) throw new IcuError('Athlete-ID nicht gefunden.', 'notfound');
  if (!res.ok) throw new IcuError(`intervals.icu antwortet mit Fehler ${res.status}.`, 'other');
  return res.json() as Promise<T>;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };

export const icu = {
  athlete: (c: Credentials) => get<IcuAthlete>(c, `/athlete/${c.athleteId}`),
  activities: (c: Credentials, days = 30) =>
    get<IcuActivity[]>(c, `/athlete/${c.athleteId}/activities?oldest=${iso(daysAgo(days))}&newest=${iso(new Date())}`),
  wellness: (c: Credentials, days = 7) =>
    get<IcuWellness[]>(c, `/athlete/${c.athleteId}/wellness?oldest=${iso(daysAgo(days))}&newest=${iso(new Date())}`)
};

/** Normalisiert die Eingabe: "i123456", "123456" oder ganze URL → "i123456". */
export function normalizeAthleteId(input: string): string {
  const m = input.trim().match(/i?(\d+)/);
  return m ? 'i' + m[1] : input.trim();
}
