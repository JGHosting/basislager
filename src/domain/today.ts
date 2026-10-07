/**
 * Bündelt alles, was "Heute" und das Morgenpopup brauchen: Pulsprofil, Belastung, Ampel.
 * Wird bei Datenänderungen automatisch neu berechnet (liveQuery).
 */
import { db, getSetting } from '../core/db';
import { today } from '../core/dates';
import { hrProfile, loadSeries, describeLoad } from './load/load';
import { computeRecovery } from './recovery/recovery';

export async function computeToday() {
  const t = today();
  const [activities, morning, manualMax, manualRest, strength] = await Promise.all([
    db.activities.toArray(), db.morning.orderBy('date').toArray(),
    getSetting<number | null>('hrMax'), getSetting<number | null>('hrRest'), db.strength.toArray()
  ]);
  const intensities = new Map(strength.filter(s => s.activityId).map(s => [s.activityId!, s.intensity]));
  const hr = hrProfile(activities, morning.filter(m => m.restingHr != null).map(m => m.restingHr!), { max: manualMax, rest: manualRest }, t);
  const series = loadSeries(activities, hr, t, intensities);
  const load = series.at(-1);
  const recovery = computeRecovery(t, morning, load);
  return {
    hr, recovery,
    load: load ? { day: load, ...describeLoad(load, series.length), recent: series.slice(-42) } : null
  };
}
