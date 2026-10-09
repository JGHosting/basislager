/**
 * Vereinfachte GPS-Route einer Aktivität für die kleine Vorschau.
 * Wird einmal von intervals.icu geholt (latlng-Stream), vereinfacht und lokal gespeichert
 * (Teil von activity.extra, also offline verfügbar und im Backup). Danach kein Netz mehr nötig.
 */
import { db, getSetting, type Activity } from '../../core/db';
import { icu, type Credentials } from '../../sources/intervals/client';

/** Sportarten mit GPS-Spur draußen (Indoor/Virtual ausgeschlossen). */
export const hasGps = (t: string) =>
  /Run|Ride|Walk|Hike|Ski|Snowboard|Snowshoe|OpenWaterSwim|Kayak|Canoe|Row|Surf|Paddl|Climb|Golf|InlineSkate|IceSkate/.test(t)
  && !/Virtual/.test(t);

/** latlng → auf 0..1 normierte Punkte (Seitenverhältnis erhalten, y nach unten). */
export function projectRoute(latlng: [number, number][]): [number, number][] | null {
  const pts = latlng.filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) && (p[0] !== 0 || p[1] !== 0));
  if (pts.length < 10) return null;
  const lat0 = pts[Math.floor(pts.length / 2)][0] * Math.PI / 180;
  const cos = Math.cos(lat0);
  const xy = pts.map(([la, lo]) => [lo * cos, -la] as [number, number]);   // y invertiert = Norden oben
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of xy) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  // gleichmäßig auf ~64 Punkte ausdünnen
  const norm = xy.map(([x, y]) => [(x - minX) / span, (y - minY) / span] as [number, number]);
  const step = Math.max(1, Math.floor(norm.length / 64));
  const out = norm.filter((_, i) => i % step === 0);
  if (out[out.length - 1] !== norm[norm.length - 1]) out.push(norm[norm.length - 1]);
  return out.length >= 5 ? out : null;
}

let chain: Promise<unknown> = Promise.resolve();
const inflight = new Set<string>();

/** Route holen (oder aus dem Cache). Gibt die Punkte zurück oder null. Rate-begrenzt und seriell. */
export async function ensureRoute(a: Activity): Promise<[number, number][] | null> {
  if (a.extra?.route !== undefined) return a.extra.route;
  if (!hasGps(a.sportType)) { await save(a, null); return null; }
  if (!navigator.onLine || inflight.has(a.id)) return null;
  inflight.add(a.id);
  const run = chain.then(async () => {
    try {
      const c = await getSetting<Credentials>('intervals');
      if (!c) return null;
      const st = await icu.streams(c, a.sourceId, ['latlng']);
      const data = st.find(x => x.type === 'latlng')?.data as unknown as [number, number][] | undefined;
      const route = data ? projectRoute(data) : null;
      await save(a, route);
      return route;
    } catch { return null; }   // keine Spur verfügbar – nicht als "null" speichern, später erneut versuchen
    finally { inflight.delete(a.id); await new Promise(r => setTimeout(r, 250)); }
  });
  chain = run.catch(() => {});
  return run;
}

async function save(a: Activity, route: [number, number][] | null) {
  const cur = await db.activities.get(a.id);
  if (!cur) return;
  await db.activities.update(a.id, { extra: { ...(cur.extra ?? { fetchedAt: Date.now() }), route }, updatedAt: Date.now() });
}
