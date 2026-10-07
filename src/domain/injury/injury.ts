/**
 * Verletzungsmodus – bewusst ohne Diagnosen. Die App merkt sich nur, was du selbst einträgst:
 * Region, Schweregrad, welche Bewegungen gehen, und gibt die Rückkehr stufenweise frei, wenn DU es entscheidest.
 * Reine Funktionen → später vom Planer genutzt.
 */
import type { Injury, Movement, MoveStatus, MorningEntry } from '../../core/db';
import { addDays } from '../../core/dates';

export const REGIONS = [
  'Fuß / Sprunggelenk', 'Achillessehne / Wade', 'Schienbein', 'Knie', 'Oberschenkel', 'Hüfte / Leiste',
  'Unterer Rücken', 'Oberer Rücken / Nacken', 'Schulter', 'Ellbogen / Arm', 'Hand / Handgelenk', 'Sonstiges'
];
export const MOVEMENTS: { id: Movement; label: string }[] = [
  { id: 'gehen', label: 'Gehen / Wandern' }, { id: 'laufen', label: 'Laufen' }, { id: 'bergab', label: 'Bergab' },
  { id: 'springen', label: 'Springen' }, { id: 'rad', label: 'Radfahren' }, { id: 'schwimmen', label: 'Schwimmen' },
  { id: 'beinkraft', label: 'Beinkraft' }, { id: 'oberkoerper', label: 'Oberkörperkraft' }
];
/** Im Dialog gezeigte Bewegungen. Kraft wird nicht an Verletzungen angepasst (entscheidest du im Training). */
export const SHOWN_MOVEMENTS = MOVEMENTS.filter(m => m.id !== 'beinkraft' && m.id !== 'oberkoerper');
export const STATUS_LABEL: Record<MoveStatus, string> = { geht: 'geht', eingeschraenkt: 'eingeschränkt', nicht: 'geht nicht' };

export const allBlocked = (): Record<Movement, MoveStatus> =>
  ({ gehen: 'nicht', laufen: 'nicht', bergab: 'nicht', springen: 'nicht', rad: 'nicht', schwimmen: 'nicht', beinkraft: 'nicht', oberkoerper: 'nicht' });
export const isOutage = (i: Injury) => i.mode === 'ausfall';

/** Startvorschlag je Region (nur Vorbelegung – du passt es an). */
export function movementPreset(region: string): Record<Movement, MoveStatus> {
  const all: Record<Movement, MoveStatus> = { gehen: 'geht', laufen: 'geht', bergab: 'geht', springen: 'geht', rad: 'geht', schwimmen: 'geht', beinkraft: 'geht', oberkoerper: 'geht' };
  const legs = ['Fuß / Sprunggelenk', 'Achillessehne / Wade', 'Schienbein', 'Knie', 'Oberschenkel', 'Hüfte / Leiste'];
  if (legs.includes(region)) Object.assign(all, { laufen: 'nicht', springen: 'nicht', bergab: 'eingeschraenkt', beinkraft: 'eingeschraenkt', gehen: 'eingeschraenkt' });
  if (region === 'Unterer Rücken') Object.assign(all, { laufen: 'eingeschraenkt', springen: 'nicht', beinkraft: 'eingeschraenkt', oberkoerper: 'eingeschraenkt' });
  if (['Schulter', 'Ellbogen / Arm', 'Hand / Handgelenk', 'Oberer Rücken / Nacken'].includes(region)) Object.assign(all, { oberkoerper: 'nicht', schwimmen: 'eingeschraenkt' });
  return all;
}

/** Rückkehrstufen. Freigabe der nächsten Stufe immer manuell. */
export const STAGES = [
  { label: 'Pause', hint: 'Nur Alltagsbewegung. Schonen, Schmerz beobachten.' },
  { label: 'Alternativtraining', hint: 'Nur Bewegungen, die „geht“ sind – z. B. Rad oder Schwimmen statt Laufen.' },
  { label: 'Laufen mit Gehpausen', hint: 'Kurze Laufabschnitte mit Gehpausen, locker, flach.' },
  { label: '50 % Umfang', hint: 'Halber gewohnter Umfang, nur locker.' },
  { label: '70 % Umfang', hint: 'Etwas mehr Umfang, weiterhin locker.' },
  { label: '85 % Umfang', hint: 'Fast normaler Umfang, erste kurze zügige Abschnitte.' },
  { label: '100 % Umfang', hint: 'Voller Umfang, Intensität vorsichtig steigern.' },
  { label: 'Normalplan', hint: 'Verletzung abgeschlossen.' }
];
export const LAST_STAGE = STAGES.length - 1;
/** Anteil des gewohnten Umfangs je Stufe (für den Planer). */
export const STAGE_VOLUME = [0, 0.3, 0.35, 0.5, 0.7, 0.85, 1, 1];

export const activeInjury = (list: Injury[]) => list.filter(i => !i.endDate).sort((a, b) => b.startDate.localeCompare(a.startDate))[0] ?? null;
export const daysSince = (from: string, today: string) => Math.round((Date.parse(today) - Date.parse(from)) / 86400000);

/** Welche Bewegungsarten belastet eine Sportart? (für Konflikte mit dem Plan) */
export function movementsOfSport(sport: string): Movement[] {
  if (/TrailRun/.test(sport)) return ['laufen', 'bergab', 'springen'];
  if (/Run/.test(sport)) return ['laufen'];
  if (/Ride/.test(sport)) return ['rad'];
  if (/Swim/.test(sport)) return ['schwimmen'];
  if (/Weight|Workout/.test(sport)) return ['beinkraft', 'oberkoerper'];
  if (/Hike|Walk|Snowshoe/.test(sport)) return ['gehen', 'bergab'];
  if (/Ski|Snowboard/.test(sport)) return ['beinkraft', 'bergab'];
  return [];
}
/** Bewertung einer geplanten Einheit: ok / eingeschränkt / nicht erlaubt, plus Alternativen. */
export function checkSport(inj: Injury, sport: string): { status: MoveStatus; alternatives: string[] } {
  const ms = movementsOfSport(sport);
  let worst: MoveStatus = ms.some(m => inj.movement[m] === 'nicht') ? 'nicht' : ms.some(m => inj.movement[m] === 'eingeschraenkt') ? 'eingeschraenkt' : 'geht';
  // Krafttraining lässt sich anpassen: Geht wenigstens ein Teil (z. B. Oberkörper), ist es "eingeschränkt" statt verboten
  if (/Weight|Workout/.test(sport) && worst === 'nicht' && ms.some(m => inj.movement[m] !== 'nicht')) worst = 'eingeschraenkt';
  const alt = (['rad', 'schwimmen', 'gehen', 'oberkoerper'] as Movement[]).filter(m => inj.movement[m] === 'geht' && !ms.includes(m)).map(m => MOVEMENTS.find(x => x.id === m)!.label);
  // Ernste Verletzung: allein die Bewegungsliste zählt. Stufe „Pause“: gar kein Training, keine Alternativen.
  if (isOutage(inj)) return { status: worst, alternatives: alt };
  return { status: inj.stage === 0 ? 'nicht' : worst, alternatives: inj.stage === 0 ? [] : alt };
}

/** Hinweis auf Arzt/Physio – nie eine Diagnose, nur ein Anstoß. */
export function doctorHint(inj: Injury, morning: MorningEntry[], today: string): string | null {
  const pains = morning.filter(m => m.date >= inj.startDate && m.pain != null).sort((a, b) => a.date.localeCompare(b.date));
  const last3 = pains.filter(p => p.date >= addDays(today, -2));
  const days = daysSince(inj.startDate, today);
  if (last3.some(p => p.pain! >= 7)) return 'Starke Schmerzen in den letzten Tagen. Bitte lass das ärztlich oder physiotherapeutisch abklären.';
  if (isOutage(inj)) return null;   // bei Bruch/Bänderriss ist ärztliche Betreuung ohnehin gegeben
  if (inj.severity === 'schwer' && !inj.medicalNote) return 'Bei einer schweren Verletzung ist eine ärztliche Einschätzung sinnvoll.';
  if (days >= 21 && inj.stage <= 1) return 'Die Beschwerden halten schon über drei Wochen an. Eine Abklärung bei Arzt oder Physio ist sinnvoll.';
  if (pains.length >= 6) {
    const first = pains.slice(0, 3).reduce((s, p) => s + p.pain!, 0) / 3, last = pains.slice(-3).reduce((s, p) => s + p.pain!, 0) / 3;
    if (days >= 14 && last >= first && last >= 3) return 'Der Schmerz wird seit zwei Wochen nicht weniger. Bitte ärztlich oder physiotherapeutisch abklären lassen.';
  }
  return null;
}

/** Hinweis vor der Freigabe der nächsten Stufe (keine Sperre – du entscheidest). */
export function advanceCheck(inj: Injury, morning: MorningEntry[], today: string): string | null {
  const since = inj.stageHistory.at(-1)?.date ?? inj.startDate;
  const recent = morning.filter(m => m.date >= addDays(today, -2) && m.pain != null);
  if (recent.some(m => m.pain! >= 4)) return 'In den letzten Tagen lag der Schmerz bei 4 oder mehr. Lieber noch auf dieser Stufe bleiben?';
  if (daysSince(since, today) < 2) return 'Du bist erst seit kurzem auf dieser Stufe. Üblich sind ein paar schmerzarme Tage, bevor es weitergeht.';
  return null;
}
