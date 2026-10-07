/** Detaildaten einer Aktivität: einmal von intervals.icu laden, dann lokal gespeichert (offline verfügbar, im Backup). */
import { db, getSetting, type Activity, type ActivityExtra } from '../../core/db';
import { icu, type Credentials } from '../../sources/intervals/client';

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export async function loadDetails(a: Activity, force = false): Promise<ActivityExtra | null> {
  if (a.extra && !force) return a.extra;
  const c = await getSetting<Credentials>('intervals');
  if (!c || !navigator.onLine) return a.extra ?? null;
  const d = await icu.activity(c, a.sourceId);
  const extra: ActivityExtra = {
    calories: num(d.calories), avgSpeed: num(d.average_speed), maxSpeed: num(d.max_speed),
    cadence: num(d.average_cadence), avgWatts: num(d.icu_average_watts ?? d.average_watts), npWatts: num(d.icu_weighted_avg_watts),
    elevLoss: num(d.total_elevation_loss), altMin: num(d.min_altitude), altMax: num(d.max_altitude), avgTemp: num(d.average_temp),
    hrZoneTimes: Array.isArray(d.icu_hr_zone_times) ? (d.icu_hr_zone_times as unknown[]).map(x => num(x) ?? 0) : null,
    hrZones: Array.isArray(d.icu_hr_zones) ? (d.icu_hr_zones as unknown[]).map(x => num(x) ?? 0) : null,
    intensity: num(d.icu_intensity), rpe: num(d.icu_rpe), feel: num(d.feel),
    device: typeof d.device_name === 'string' ? d.device_name : null, laps: num(d.icu_lap_count),
    description: typeof d.description === 'string' && d.description.trim() ? d.description.trim() : null,
    fetchedAt: Date.now()
  };
  await db.activities.update(a.id, { extra, updatedAt: Date.now() });
  return extra;
}
