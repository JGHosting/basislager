/**
 * Verbindung Mobility ↔ Verletzungsmodus.
 *
 * Je Verletzungsregion (Regionen aus domain/injury) ist festgelegt, welche Übungen die Stelle
 * - direkt belasten (dehnen/tragen genau diesen Bereich) → ausgeschlossen, solange die Verletzung aktiv ist;
 *   erst ab Stufe „100 % Umfang“ sind leichte Varianten (Schwierigkeit 0) wieder erlaubt,
 * - indirekt belasten (Abstützen, Knien, Mitbewegen) → ausgeschlossen bis einschließlich Stufe „50 % Umfang“,
 *   bei schwerer Verletzung oder Ausfall-Modus dauerhaft.
 * Zusätzlich gilt weiter die Bewegungsliste der Verletzung (Übung.avoid ↔ „geht nicht“).
 * Bei Stufe „Pause“ ruht Mobility ganz (Pausenmodus, siehe app.svelte.ts).
 */
import type { Injury } from '../../core/db';
import type { MobilityExercise } from './library';

type Load = { direct: string[]; indirect: string[] };
const QUADRUPED = ['cat-cow', 'cat-stretch', 'bird-dog', 'thread-the-needle', 'puppy-pose', 'childs-pose', 'kneeling-wrist-stretch'];
const KNEELING = ['kneeling-hip-flexor-stretch', 'half-kneeling-hip-flexor-rock', 'low-lunge', 'lizard-stretch', ...QUADRUPED];
const HAMSTRING = ['seated-forward-fold', 'standing-forward-fold', 'wide-legged-forward-fold', 'head-to-knee-pose', 'seated-straddle-stretch'];
const HIP_FLEXOR = ['kneeling-hip-flexor-stretch', 'half-kneeling-hip-flexor-rock', 'low-lunge', 'lizard-stretch'];
const HANDS = ['downward-dog', 'downward-dog-pedal', 'thoracic-bridge', 'cobra-stretch', 'kneeling-wrist-stretch'];

const LOAD: Record<string, Load> = {
  'Fuß / Sprunggelenk': {
    direct: ['standing-calf-stretch', 'knie-zur-wand', 'ankle-circles', 'faszienrolle-wade', 'downward-dog-pedal', 'deep-squat-hold', 'squat-hold'],
    indirect: ['downward-dog', 'wall-sit', 'low-lunge', 'lizard-stretch', 'standing-forward-fold', 'wide-legged-forward-fold', 'standing-side-bend', 'becken-aufrichten', 'childs-pose']
  },
  'Achillessehne / Wade': {
    direct: ['standing-calf-stretch', 'knie-zur-wand', 'faszienrolle-wade', 'downward-dog', 'downward-dog-pedal', 'deep-squat-hold', 'squat-hold'],
    indirect: ['ankle-circles', 'wall-sit', 'low-lunge', 'lizard-stretch', 'childs-pose']
  },
  'Schienbein': {
    direct: ['knie-zur-wand', 'faszienrolle-wade', 'deep-squat-hold', 'squat-hold'],
    indirect: ['standing-calf-stretch', 'downward-dog-pedal', 'wall-sit', 'childs-pose', ...KNEELING]
  },
  'Knie': {
    direct: ['deep-squat-hold', 'squat-hold', 'wall-sit', 'kneeling-hip-flexor-stretch', 'half-kneeling-hip-flexor-rock', 'low-lunge', 'lizard-stretch', 'pigeon-stretch', 'faszienrolle-oberschenkel-vorne', 'knie-zur-wand', 'childs-pose'],
    indirect: ['90-90-hold', 'butterfly-stretch', 'happy-baby', 'head-to-knee-pose', 'single-leg-glute-bridge', 'glute-bridge', ...QUADRUPED]
  },
  'Oberschenkel': {
    direct: [...HAMSTRING, ...HIP_FLEXOR, 'faszienrolle-oberschenkel-vorne', 'downward-dog', 'deep-squat-hold', 'wall-sit', 'single-leg-glute-bridge'],
    indirect: ['squat-hold', 'happy-baby', 'legs-up-the-wall', 'glute-bridge', 'pigeon-stretch', 'downward-dog-pedal']
  },
  'Hüfte / Leiste': {
    direct: [...HIP_FLEXOR, 'pigeon-stretch', 'butterfly-stretch', '90-90-hold', 'deep-squat-hold', 'seated-straddle-stretch', 'wide-legged-forward-fold', 'faszienrolle-gesaess', 'clamshells', 'happy-baby'],
    indirect: ['squat-hold', 'faszienrolle-oberschenkel-vorne', 'glute-bridge', 'single-leg-glute-bridge', 'wall-sit', 'bird-dog', 'head-to-knee-pose', 'seated-forward-fold', 'becken-aufrichten']
  },
  'Unterer Rücken': {
    direct: ['seated-forward-fold', 'standing-forward-fold', 'wide-legged-forward-fold', 'head-to-knee-pose', 'cobra-stretch', 'seated-spinal-twist', 'supine-spinal-twist', 'torso-twists', 'standing-side-bend'],
    indirect: ['plank', 'side-plank', 'bird-dog', 'dead-bug', 'thoracic-bridge', 'glute-bridge', 'single-leg-glute-bridge', 'cat-cow', 'pigeon-stretch', 'seated-straddle-stretch', 'downward-dog', 'becken-aufrichten']
  },
  'Oberer Rücken / Nacken': {
    direct: ['neck-side-stretch', 'faszienrolle-bws', 'thread-the-needle', 'open-book', 'thoracic-bridge'],
    indirect: ['kinn-einziehen', 'cat-cow', 'cat-stretch', 'puppy-pose', 'overhead-triceps-stretch', 'cow-face-pose', 'downward-dog', 'plank', 'side-plank', 'torso-twists']
  },
  'Schulter': {
    direct: ['doorway-chest-stretch', 'cow-face-pose', 'cross-body-shoulder-stretch', 'overhead-triceps-stretch', 'wall-slides', 'puppy-pose', 'thread-the-needle', 'thoracic-bridge', 'downward-dog', 'downward-dog-pedal', 'plank', 'side-plank'],
    indirect: ['bird-dog', 'cat-cow', 'cat-stretch', 'open-book', 'childs-pose', 'cobra-stretch', 'faszienrolle-bws', 'kneeling-wrist-stretch']
  },
  'Ellbogen / Arm': {
    direct: ['overhead-triceps-stretch', 'cow-face-pose', 'kneeling-wrist-stretch'],
    indirect: ['plank', 'side-plank', 'cobra-stretch', ...HANDS, ...QUADRUPED, 'faszienrolle-oberschenkel-vorne', 'faszienrolle-wade', 'faszienrolle-gesaess']
  },
  'Hand / Handgelenk': {
    direct: [...HANDS],
    indirect: [...QUADRUPED, 'plank', 'side-plank', 'faszienrolle-oberschenkel-vorne', 'faszienrolle-wade', 'faszienrolle-gesaess', 'cow-face-pose']
  }
};

/* Ergänzungen (Free-Exercise-DB-Übungen) */
const extra: [string, 'direct' | 'indirect', string[]][] = [
  ['faszienrolle-hamstrings', 'direct', ['Oberschenkel']], ['faszienrolle-hamstrings', 'indirect', ['Knie', 'Hand / Handgelenk', 'Ellbogen / Arm']],
  ['faszienrolle-latissimus', 'direct', ['Schulter']], ['faszienrolle-latissimus', 'indirect', ['Oberer Rücken / Nacken']],
  ['faszienrolle-oberschenkel-aussen', 'direct', ['Oberschenkel', 'Hüfte / Leiste']], ['faszienrolle-oberschenkel-aussen', 'indirect', ['Knie', 'Ellbogen / Arm', 'Schulter']],
  ['faszienrolle-adduktoren', 'direct', ['Hüfte / Leiste', 'Oberschenkel']], ['faszienrolle-adduktoren', 'indirect', ['Knie', 'Ellbogen / Arm']],
  ['faszienrolle-wade-aussen', 'direct', ['Fuß / Sprunggelenk', 'Achillessehne / Wade', 'Schienbein']], ['faszienrolle-wade-aussen', 'indirect', ['Ellbogen / Arm', 'Schulter']],
  ['wadendehnung-sitzend', 'direct', ['Achillessehne / Wade', 'Fuß / Sprunggelenk']], ['wadendehnung-sitzend', 'indirect', ['Schienbein', 'Oberschenkel', 'Unterer Rücken']],
  ['kinn-zur-brust', 'direct', ['Oberer Rücken / Nacken']],
  ['beckenkippen-bruecke', 'indirect', ['Unterer Rücken', 'Hüfte / Leiste']],
  ['schulterkreisen', 'indirect', ['Schulter', 'Oberer Rücken / Nacken']],
  /* Erweiterung 2026-10 */
  ['wadendehnung-wand', 'direct', ['Achillessehne / Wade', 'Fuß / Sprunggelenk']], ['wadendehnung-wand', 'indirect', ['Schienbein', 'Hand / Handgelenk']],
  ['soleus-dehnung', 'direct', ['Achillessehne / Wade', 'Fuß / Sprunggelenk', 'Schienbein']], ['soleus-dehnung', 'indirect', ['Knie']],
  ['knie-kreisen', 'direct', ['Knie', 'Fuß / Sprunggelenk']], ['knie-kreisen', 'indirect', ['Achillessehne / Wade', 'Schienbein']],
  ['hueftbeuger-stand', 'direct', ['Hüfte / Leiste']], ['hueftbeuger-stand', 'indirect', ['Knie', 'Fuß / Sprunggelenk', 'Oberschenkel']],
  ['hueftkreisen-stand', 'direct', ['Hüfte / Leiste']], ['hueftkreisen-stand', 'indirect', ['Knie', 'Fuß / Sprunggelenk', 'Achillessehne / Wade']],
  ['figur-vier-liegend', 'direct', ['Hüfte / Leiste']], ['figur-vier-liegend', 'indirect', ['Knie', 'Unterer Rücken']],
  ['knie-zur-brust-einbeinig', 'indirect', ['Hüfte / Leiste', 'Knie', 'Unterer Rücken']],
  ['adduktoren-seitlage', 'direct', ['Hüfte / Leiste', 'Oberschenkel']], ['adduktoren-seitlage', 'indirect', ['Knie', 'Schulter']],
  ['quad-dehnung-seitlage', 'direct', ['Oberschenkel', 'Knie']], ['quad-dehnung-seitlage', 'indirect', ['Hüfte / Leiste', 'Schulter']],
  ['quad-dehnung-vierfuss', 'direct', ['Oberschenkel', 'Knie']], ['quad-dehnung-vierfuss', 'indirect', ['Hüfte / Leiste', 'Unterer Rücken', 'Schulter', 'Hand / Handgelenk', 'Ellbogen / Arm']],
  ['hueftkreisen-vierfuss', 'direct', ['Hüfte / Leiste']], ['hueftkreisen-vierfuss', 'indirect', ['Knie', 'Hand / Handgelenk', 'Ellbogen / Arm', 'Schulter', 'Unterer Rücken']],
  ['worlds-greatest-stretch', 'direct', ['Hüfte / Leiste', 'Oberschenkel']], ['worlds-greatest-stretch', 'indirect', ['Knie', 'Fuß / Sprunggelenk', 'Achillessehne / Wade', 'Unterer Rücken', 'Oberer Rücken / Nacken', 'Schulter', 'Hand / Handgelenk']],
  ['ausfallschritt-rotation', 'direct', ['Knie', 'Hüfte / Leiste']], ['ausfallschritt-rotation', 'indirect', ['Fuß / Sprunggelenk', 'Achillessehne / Wade', 'Oberschenkel', 'Unterer Rücken']],
  ['skorpion', 'direct', ['Unterer Rücken', 'Hüfte / Leiste']], ['skorpion', 'indirect', ['Schulter', 'Knie']],
  ['adduktoren-einrollen', 'direct', ['Hüfte / Leiste']], ['adduktoren-einrollen', 'indirect', ['Unterer Rücken', 'Knie', 'Oberer Rücken / Nacken']],
  ['beinstrecken-9090', 'direct', ['Oberschenkel']], ['beinstrecken-9090', 'indirect', ['Knie']],
  ['laeufer-dehnung', 'direct', ['Oberschenkel', 'Hüfte / Leiste', 'Achillessehne / Wade']], ['laeufer-dehnung', 'indirect', ['Knie', 'Fuß / Sprunggelenk', 'Hand / Handgelenk', 'Unterer Rücken']],
  ['inchworm', 'direct', ['Oberschenkel', 'Hand / Handgelenk', 'Schulter']], ['inchworm', 'indirect', ['Unterer Rücken', 'Ellbogen / Arm', 'Achillessehne / Wade']],
  ['oberschenkel-umarmen', 'direct', ['Unterer Rücken']], ['oberschenkel-umarmen', 'indirect', ['Oberschenkel', 'Oberer Rücken / Nacken']],
  ['rumpfdrehung-stand', 'direct', ['Unterer Rücken']], ['rumpfdrehung-stand', 'indirect', ['Oberer Rücken / Nacken']],
  ['armschwingen', 'direct', ['Schulter']], ['armschwingen', 'indirect', ['Oberer Rücken / Nacken', 'Ellbogen / Arm']],
  ['seitdehnung-liegend', 'direct', ['Schulter']], ['seitdehnung-liegend', 'indirect', ['Unterer Rücken', 'Hüfte / Leiste', 'Ellbogen / Arm']],
  ['lat-dehnung-wand', 'direct', ['Schulter']], ['lat-dehnung-wand', 'indirect', ['Ellbogen / Arm', 'Oberer Rücken / Nacken']],
  ['strecken-nach-oben', 'direct', ['Schulter']], ['strecken-nach-oben', 'indirect', ['Oberer Rücken / Nacken', 'Unterer Rücken']],
  ['drehsitz', 'direct', ['Unterer Rücken']], ['drehsitz', 'indirect', ['Hüfte / Leiste', 'Knie', 'Hand / Handgelenk', 'Oberer Rücken / Nacken']],
  ['knie-umarmen', 'indirect', ['Knie', 'Unterer Rücken', 'Hüfte / Leiste']],
  ['windmuehle', 'direct', ['Unterer Rücken', 'Hüfte / Leiste']], ['windmuehle', 'indirect', ['Oberschenkel', 'Schulter', 'Knie']],
  ['superman', 'direct', ['Unterer Rücken']], ['superman', 'indirect', ['Oberer Rücken / Nacken', 'Schulter']],
  ['schultern-heben', 'indirect', ['Schulter', 'Oberer Rücken / Nacken']],
  ['oberer-ruecken-rund', 'direct', ['Oberer Rücken / Nacken']], ['oberer-ruecken-rund', 'indirect', ['Schulter', 'Hand / Handgelenk']],
  ['ellbogen-zurueck', 'direct', ['Schulter']], ['ellbogen-zurueck', 'indirect', ['Oberer Rücken / Nacken', 'Ellbogen / Arm', 'Hand / Handgelenk']],
  ['knie-ueber-koerper', 'direct', ['Unterer Rücken']], ['knie-ueber-koerper', 'indirect', ['Hüfte / Leiste', 'Knie', 'Schulter']]
];
for (const [id, kind, regions] of extra) for (const r of regions) LOAD[r][kind].push(id);

/** Ab dieser Rückkehrstufe (100 % Umfang) sind leichte, direkt belastende Übungen wieder erlaubt. */
const DIRECT_OK_FROM = 6;
/** Bis einschließlich dieser Stufe (50 % Umfang) bleiben auch indirekt belastende Übungen weg. */
const INDIRECT_BLOCKED_UNTIL = 3;

export function injuryLoad(e: MobilityExercise, injury: Injury): 'direct' | 'indirect' | null {
  const l = LOAD[injury.region];
  if (!l) return null;
  if (l.direct.includes(e.id)) return 'direct';
  if (l.indirect.includes(e.id)) return 'indirect';
  return null;
}

/** Darf die Übung bei dieser Verletzung gerade gemacht werden? */
export function isExcluded(e: MobilityExercise, injury: Injury | null): boolean {
  if (!injury) return false;
  if (e.avoid?.some(m => injury.movement[m] === 'nicht')) return true;
  const strict = injury.mode === 'ausfall' || injury.severity === 'schwer';
  const load = injuryLoad(e, injury);
  if (load === 'direct') return strict || injury.stage < DIRECT_OK_FROM || e.difficulty > 0;
  if (load === 'indirect') return strict || injury.stage <= INDIRECT_BLOCKED_UNTIL;
  return false;
}
