/**
 * Indoor-Nachfrage: Laufband-Qualitätseinheiten (Tempo im Hauptteil) und Indoor-Radfahrten (Distanz).
 * Garmins Laufband-Distanz ist geschätzt und meist falsch – deshalb fragt die App nach.
 */
import { db, type Activity, type IndoorKind } from '../../core/db';
import { today, addDays, weekStart } from '../../core/dates';
import { planWeeks } from '../planner/repo';

/** Ab hier wird gefragt (ältere Einheiten nicht nachträglich). */
const FEATURE_START = '2026-10-26';
const LOOKBACK_DAYS = 7;

export interface IndoorAsk {
  activity: Activity;
  type: 'lauf' | 'rad';
  /** Laufen: Titel der geplanten Qualitätseinheit. */
  title?: string;
  kind?: IndoorKind | null;
}

/** Art der Qualitätseinheit aus dem Titel. */
export function kindOf(title: string): IndoorKind | null {
  if (/Berg/.test(title)) return 'berg';
  if (/Intervall/.test(title)) return 'intervall';
  if (/Schwelle/.test(title)) return 'schwelle';
  if (/Tempodauerlauf/.test(title)) return 'tempo';
  if (/Wettkampftempo|Kurz & knackig/.test(title)) return 'wettkampf';
  if (/Fahrtspiel/.test(title)) return 'fahrtspiel';
  return null;
}

/** Was im Hauptteil gemeint ist – für den Fragetext. */
export const KIND_HINT: Record<IndoorKind, string> = {
  intervall: 'in den schnellen Intervallen', schwelle: 'in den Schwellen-Blöcken', tempo: 'im Tempoteil',
  wettkampf: 'im Wettkampftempo', fahrtspiel: 'in den zügigen Minuten', berg: 'in den Bergintervallen'
};

export async function pendingIndoor(): Promise<IndoorAsk[]> {
  const t = today();
  const from = [addDays(t, -LOOKBACK_DAYS), FEATURE_START].sort()[1];
  const acts = (await db.activities.where('date').between(from, t, true, true).toArray()).filter(a => !a.manual);
  const out: IndoorAsk[] = acts.filter(a => a.sportType === 'VirtualRide').map(a => ({ activity: a, type: 'rad' as const }));
  const runs = acts.filter(a => a.sportType === 'VirtualRun');
  if (runs.length) {
    const ws = weekStart(from), n = Math.round((Date.parse(weekStart(t)) - Date.parse(ws)) / 604800000) + 1;
    const { weeks } = await planWeeks(ws, n);
    const quality = weeks.flatMap(w => w.sessions).filter(s => s.status === 'erledigt' && s.activityId && /:run-q\d*$/.test(s.key));
    for (const a of runs) {
      const s = quality.find(q => q.activityId === a.id);
      if (s) out.push({ activity: a, type: 'lauf', title: s.title, kind: kindOf(s.title) });
    }
  }
  return out.sort((x, y) => x.activity.start.localeCompare(y.activity.start));
}

/** Antwort speichern. km/kmh = null → nicht angegeben. Ohne beides = übersprungen. */
export async function saveIndoor(ask: IndoorAsk, distKm: number | null, kmh: number | null) {
  const a = await db.activities.get(ask.activity.id);
  if (!a) return;
  const distance = distKm != null && distKm > 0 ? Math.round(distKm * 1000) : null;
  const speed = kmh != null && kmh > 0 ? Math.round(kmh * 10) / 10 : null;
  const manual = { done: true as const, ...(distance ? { distance } : {}), ...(speed ? { speed, kind: ask.kind ?? null } : {}) };
  await db.activities.put(JSON.parse(JSON.stringify({ ...a, manual, distance: distance ?? a.distance, updatedAt: Date.now() })));
}
