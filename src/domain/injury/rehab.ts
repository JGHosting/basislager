/**
 * Physiotherapie & Rückkehrstufen.
 *
 * Eine Physio-Einheit in Garmin (eigene Aktivität „Physiotherapie“) wird beim Abgleich erkannt. Sie ist KEIN Beweis
 * für Fortschritt: Die App fragt nach, was gemacht wurde, wie es sich angefühlt hat und welche Reha-Ziele der
 * aktuellen Stufe erreicht wurden. Erst wenn genug Einheiten die Kriterien erfüllen und nichts dagegen spricht
 * (Schmerz, zu kurz auf der Stufe, Schmerz am Folgemorgen), schlägt die App die nächste Stufe vor.
 * Die Freigabe bestätigst immer du (assistiert, nicht automatisch). Manuell weiterschalten geht wie bisher.
 * Reine Funktionen, keine Diagnosen.
 */
import type { Activity, Injury, MorningEntry, RehabCheck } from '../../core/db';
import { addDays } from '../../core/dates';
import { STAGES, LAST_STAGE, advanceCheck, isOutage } from './injury';

/** Erkennung über Sportart oder Aktivitätsnamen (Garmin-Profil „Physiotherapie“, „Reha“, „Krankengymnastik“). */
export const PHYSIO_RE = /physio|\breha\b|rehab|krankengymnastik/i;
export const isPhysioName = (a: Pick<Activity, 'sportType' | 'name'>) => PHYSIO_RE.test(a.sportType) || PHYSIO_RE.test(a.name ?? '');

/** Alle Aktivitäten, die als Physio gelten: per Name erkannt oder von dir als Physio bewertet. */
export function physioIds(activities: Activity[], injuries: Injury[]): Set<string> {
  const ids = new Set(activities.filter(isPhysioName).map(a => a.id));
  for (const i of injuries) for (const c of i.rehab ?? []) if (c.activityId && !c.ignored) ids.add(c.activityId);
  return ids;
}

export const EXERCISES = ['Mobilisation', 'Dehnen', 'Kräftigung', 'Stabilität / Gleichgewicht', 'Sprünge / Plyometrie', 'Lauf-/Sportspezifisch', 'Manuelle Therapie'];

const UPPER = ['Schulter', 'Ellbogen / Arm', 'Hand / Handgelenk', 'Oberer Rücken / Nacken'];
/**
 * Reha-Ziele, um von einer Stufe zur nächsten zu kommen. Bewusst als prüfbare Aussagen formuliert,
 * die du (mit deiner Physio) beantworten kannst – keine Diagnose.
 */
export function rehabCriteria(inj: Pick<Injury, 'region' | 'stage'>): string[] {
  const done = 'Übungen vollständig geschafft (alle Sätze und Wiederholungen)';
  if (UPPER.includes(inj.region)) {
    if (inj.stage === 0) return [done, 'Alltagsbewegungen fast schmerzfrei, kein Ruheschmerz', 'Keine Schwellung mehr'];
    if (inj.stage >= LAST_STAGE - 1) return [done, 'Voller Umfang ohne Beschwerden', 'Kraft und Beweglichkeit seitengleich (Test der Physio)'];
    return [done, 'Bewegung im vollen Umfang ohne Schmerz', 'Belastung dieser Stufe ohne Schmerzzunahme'];
  }
  switch (inj.stage) {
    case 0: return [done, 'Gehen und Treppen fast schmerzfrei, kein Ruheschmerz', 'Keine Schwellung mehr'];
    case 1: return [done, '30 min zügig gehen ohne Schmerz', '10× einbeinig hüpfen (bzw. Belastungstest der Physio) ohne Schmerz'];
    case 2: return [done, 'Laufen mit Gehpausen ohne Schmerzzunahme', 'Am Morgen danach nicht schlimmer als vorher'];
    case 6: return [done, 'Voller Umfang ohne Beschwerden', 'Kraft und Stabilität seitengleich (Test der Physio)'];
    default: return [done, 'Läufe dieser Stufe ohne Schmerzzunahme', 'Am Morgen danach nicht schlimmer als vorher'];
  }
}

/** Seit wann gilt die aktuelle Stufe? */
export const stageSince = (inj: Injury) => [...inj.stageHistory].reverse().find(h => h.stage === inj.stage)?.date ?? inj.startDate;
/** Bewertete Einheiten der aktuellen Stufe (ohne „nicht bewerten“). */
export const checksOnStage = (inj: Injury) =>
  (inj.rehab ?? []).filter(c => !c.ignored && c.stage === inj.stage && c.date >= stageSince(inj)).sort((a, b) => a.date.localeCompare(b.date));

/** Erfüllt eine Einheit alle Ziele bei geringem Schmerz? */
export const qualifies = (c: RehabCheck, total: number) => c.criteria.length >= total && (c.painDuring ?? 0) <= 3;

/** Schmerz am Morgen nach der Einheit deutlich höher (≥ 2 Punkte) als am Tag der Einheit bzw. davor? */
export function painRoseAfter(c: RehabCheck, morning: MorningEntry[]): boolean {
  const p = (d: string) => morning.find(m => m.date === d)?.pain ?? null;
  const before = p(c.date) ?? p(addDays(c.date, -1)), after = p(addDays(c.date, 1));
  return before != null && after != null && after - before >= 2;
}

export const NEEDED = 2;   // Einheiten mit allen Zielen; mit Freigabe der Physio genügt eine
export interface RehabAssessment {
  status: 'bereit' | 'fast' | 'nein' | 'keine';
  reasons: string[];
  qualifying: number; needed: number; nextLabel: string | null;
}

/**
 * Bewertung für den Vorschlag „nächste Stufe“. Bereit nur, wenn:
 *  – mind. 2 Einheiten auf dieser Stufe alle Ziele bei Schmerz ≤ 3/10 erreicht haben (1 genügt mit Freigabe der Physio),
 *  – die letzte Einheit nicht schmerzhaft war (≥ 5/10) und der Schmerz am Folgemorgen nicht deutlich stieg,
 *  – die üblichen Prüfungen passen (nicht erst seit gestern auf der Stufe, kein Schmerz ≥ 4 in den letzten Tagen).
 */
export function assessRehab(inj: Injury, morning: MorningEntry[], today: string): RehabAssessment {
  const nextLabel = !isOutage(inj) && inj.stage < LAST_STAGE ? STAGES[inj.stage + 1].label : null;
  const checks = checksOnStage(inj);
  const total = rehabCriteria(inj).length;
  if (isOutage(inj) || !checks.length || inj.stage >= LAST_STAGE) return { status: 'keine', reasons: [], qualifying: 0, needed: NEEDED, nextLabel };
  const ok = checks.filter(c => qualifies(c, total));
  const needed = ok.some(c => c.cleared) ? 1 : NEEDED;
  const reasons: string[] = [];
  const last = checks.at(-1)!;
  if ((last.painDuring ?? 0) >= 5) reasons.push(`Bei der letzten Einheit lag der Schmerz bei ${last.painDuring}/10 – erst wieder ruhiger werden lassen.`);
  const rose = checks.filter(c => painRoseAfter(c, morning));
  if (rose.length) reasons.push('Am Morgen nach einer Physio-Einheit war der Schmerz deutlich höher als vorher.');
  const general = advanceCheck(inj, morning, today);
  if (general) reasons.push(general.replace(' Lieber noch auf dieser Stufe bleiben?', ''));
  if (reasons.length) return { status: 'nein', reasons, qualifying: ok.length, needed, nextLabel };
  if (ok.length >= needed) return { status: 'bereit', reasons: [], qualifying: ok.length, needed, nextLabel };
  const missing = needed - ok.length;
  if (ok.length) return { status: 'fast', reasons: [`Noch ${missing} weitere Einheit${missing > 1 ? 'en' : ''} mit allen Zielen nötig (oder Freigabe der Physio).`], qualifying: ok.length, needed, nextLabel };
  const best = Math.max(...checks.map(c => c.criteria.length));
  return { status: 'nein', reasons: [best < total ? `Bisher ${best} von ${total} Zielen erreicht.` : 'Schmerz bei den Übungen noch über 3/10.'], qualifying: 0, needed, nextLabel };
}

/** Erkannte Physio-Aktivitäten seit Verletzungsbeginn (max. 14 Tage zurück), die noch nicht bewertet wurden. */
export function pendingPhysio(inj: Injury, activities: Activity[], today: string): Activity[] {
  const done = new Set((inj.rehab ?? []).map(c => c.activityId).filter(Boolean));
  const from = [inj.startDate, addDays(today, -14)].sort().at(-1)!;
  return activities.filter(a => isPhysioName(a) && a.date >= from && a.date <= today && !done.has(a.id)).sort((a, b) => b.start.localeCompare(a.start));
}
