/**
 * Übungsbibliothek für Stretching/Mobility.
 * Bilder (public/mobility/<id>.webp) stammen aus dem RepDB Free Tier (repdb.co, Namensnennung
 * siehe Mehr → Über & Lizenzen) – nur Übungen ohne Geräte wurden übernommen. Ergänzend eigene
 * Übungen für Faszienrolle, Sprunggelenk, Nacken und Becken, da RepDB dafür keine passenden hat – deren Fotos
 * (Start- und Endposition) stammen aus Free Exercise DB (github.com/yuhonas/free-exercise-db, Unlicense).
 * Übungen ohne Bild werden nicht ausgewählt.
 */
import type { Movement } from '../../core/db';

/** Körperregion – zugleich die Rotation für den "ganzer Körper"-Anteil der Routine. */
export type Region = 'hüfte' | 'rueckseite' | 'bws_schultern' | 'sprunggelenk' | 'nacken' | 'rumpf';
export const REGIONS: { id: Region; label: string }[] = [
  { id: 'hüfte', label: 'Hüfte / tiefe Hocke' },
  { id: 'rueckseite', label: 'Rückseite / Hamstrings' },
  { id: 'bws_schultern', label: 'Brustwirbelsäule / Schultern' },
  { id: 'sprunggelenk', label: 'Sprunggelenk' },
  { id: 'nacken', label: 'Nacken / Haltung' },
  { id: 'rumpf', label: 'Rumpf / Becken' }
];

/** Feste Ziele. "hohlkreuz" ist zielgerichtet (zieht aus mehreren Regionen), die anderen entsprechen je einer Region. */
export type GoalId = Region | 'hohlkreuz';
export const GOALS: { id: GoalId; label: string; hint?: string }[] = [
  { id: 'hohlkreuz', label: 'Hohlkreuz', hint: 'Hüftbeuger, Gesäß, Rumpfkontrolle, BWS-Mobilisation' },
  { id: 'hüfte', label: 'Hüfte / tiefe Hocke' },
  { id: 'bws_schultern', label: 'Brustwirbelsäule / Schultern' },
  { id: 'rueckseite', label: 'Rückseite / Hamstrings' },
  { id: 'sprunggelenk', label: 'Sprunggelenk' },
  { id: 'nacken', label: 'Nacken / Haltung' }
];

export type MobilityCategory = 'dehnung' | 'mobilisation' | 'aktivierung';
export type Equipment = 'keins' | 'matte' | 'faszienrolle';

export interface MobilityExercise {
  id: string;
  name: string;
  source: 'repdb' | 'fedb' | 'custom';
  category: MobilityCategory;
  equipment: Equipment;
  regions: Region[];
  /** Zusätzlich zur Region besonders für dieses Ziel relevant (z. B. Hüftbeuger → hohlkreuz). */
  goals: GoalId[];
  difficulty: 0 | 1 | 2;
  sides: boolean;              // Seitenwechsel im Player nötig
  holdSec?: number;            // Basis-Haltezeit (Stufe 0); dehnende/haltende Übungen
  reps?: number;                // Basis-Wiederholungen (Stufe 0); dynamische Übungen statt Haltezeit
  cue?: string;                 // wichtiger Ausführungshinweis
  instructions: string;
  /** Bewegungen, bei denen die Übung bei aktiver Verletzung ausgeschlossen wird. */
  avoid?: Movement[];
  image?: string;                // public/mobility/<image>.webp
  /** Zweites Bild (Endposition), bei Übungen aus Free Exercise DB. */
  image2?: string;
}

/** Haltezeit/Wiederholungen je Level (0 Standard, 1 und 2 nach Fortschritt in den Selbsttests). */
export function scaledHold(e: MobilityExercise, level: 0 | 1 | 2): number | undefined {
  if (e.holdSec == null) return undefined;
  return Math.round(e.holdSec * (level === 0 ? 1 : level === 1 ? 1.4 : 1.8));
}
export function scaledReps(e: MobilityExercise, level: 0 | 1 | 2): number | undefined {
  if (e.reps == null) return undefined;
  return e.reps + level * 4;
}

/** Alle definierten Übungen – auch eigene ohne Bild (derzeit nicht in Gebrauch). */
const ALL: MobilityExercise[] = [
  /* ---------- Hüfte / tiefe Hocke ---------- */
  { id: 'kneeling-hip-flexor-stretch', name: 'Kniende Hüftbeuger-Dehnung', source: 'repdb', category: 'dehnung', equipment: 'keins',
    regions: ['hüfte'], goals: ['hüfte', 'hohlkreuz'], difficulty: 0, sides: true, holdSec: 30,
    cue: 'Gesäß der hinteren Seite fest anspannen und Becken aufrichten – sonst dehnt sich der untere Rücken statt der Hüfte.',
    instructions: 'Im Ausfallschritt-Kniestand, hinteres Knie am Boden. Becken nach vorn unten kippen, dabei Gesäß anspannen und Oberkörper aufrecht lassen.',
    avoid: ['laufen', 'springen'], image: 'kneeling-hip-flexor-stretch' },
  { id: 'half-kneeling-hip-flexor-rock', name: 'Hüftbeuger-Wippen im Halbkniestand', source: 'repdb', category: 'mobilisation', equipment: 'keins',
    regions: ['hüfte'], goals: ['hüfte', 'hohlkreuz'], difficulty: 1, sides: true, reps: 10,
    cue: 'Becken bleibt beim Wippen aufgerichtet, nicht ins Hohlkreuz fallen lassen.',
    instructions: 'Wie die kniende Hüftbeuger-Dehnung, dabei leicht nach vorn und zurück wippen statt nur zu halten.',
    avoid: ['laufen', 'springen'], image: 'half-kneeling-hip-flexor-rock' },
  { id: 'low-lunge', name: 'Tiefer Ausfallschritt', source: 'repdb', category: 'dehnung', equipment: 'matte',
    regions: ['hüfte'], goals: ['hüfte'], difficulty: 1, sides: true, holdSec: 30,
    instructions: 'Großer Ausfallschritt, hinteres Knie am Boden, Hände neben dem vorderen Fuß. Hüfte sinkt nach vorn unten.',
    avoid: ['laufen', 'springen'], image: 'low-lunge' },
  { id: 'pigeon-stretch', name: 'Tauben-Dehnung', source: 'repdb', category: 'dehnung', equipment: 'matte',
    regions: ['hüfte'], goals: ['hüfte'], difficulty: 2, sides: true, holdSec: 30,
    instructions: 'Vorderes Bein angewinkelt vor dem Körper, hinteres Bein lang nach hinten. Oberkörper aufrecht oder langsam nach vorn sinken lassen.',
    avoid: ['laufen', 'springen'], image: 'pigeon-stretch' },
  { id: 'butterfly-stretch', name: 'Schmetterlings-Dehnung', source: 'repdb', category: 'dehnung', equipment: 'matte',
    regions: ['hüfte'], goals: ['hüfte'], difficulty: 0, sides: false, holdSec: 30,
    instructions: 'Sitzend, Fußsohlen aneinander, Knie sinken zur Seite. Mit geradem Rücken leicht nach vorn beugen.',
    image: 'butterfly-stretch' },
  { id: '90-90-hold', name: '90/90-Sitz', source: 'repdb', category: 'mobilisation', equipment: 'matte',
    regions: ['hüfte'], goals: ['hüfte'], difficulty: 1, sides: true, holdSec: 25,
    instructions: 'Sitzend, vorderes Bein 90° angewinkelt vor dem Körper, hinteres Bein 90° angewinkelt seitlich. Aufrecht sitzen.',
    image: '90-90-hold' },
  { id: 'lizard-stretch', name: 'Eidechsen-Dehnung', source: 'repdb', category: 'dehnung', equipment: 'matte',
    regions: ['hüfte'], goals: ['hüfte'], difficulty: 2, sides: true, holdSec: 30,
    instructions: 'Großer Ausfallschritt, vorderer Fuß außen neben der Hand, Unterarme sinken auf den Boden.',
    avoid: ['laufen', 'springen'], image: 'lizard-stretch' },
  { id: 'deep-squat-hold', name: 'Tiefer Kniebeuge-Halt', source: 'repdb', category: 'mobilisation', equipment: 'keins',
    regions: ['hüfte'], goals: ['hüfte'], difficulty: 1, sides: false, holdSec: 30,
    cue: 'Fersen bleiben am Boden, Rücken lang.', instructions: 'In die tiefe Hocke sinken, Ellbogen drücken von innen gegen die Knie, Fersen am Boden.',
    avoid: ['beinkraft'], image: 'deep-squat-hold' },
  { id: 'squat-hold', name: 'Kniebeuge-Halt', source: 'repdb', category: 'mobilisation', equipment: 'keins',
    regions: ['hüfte'], goals: ['hüfte'], difficulty: 0, sides: false, holdSec: 30,
    instructions: 'In einer bequemen Kniebeuge-Tiefe halten, Rücken lang, Gewicht auf dem ganzen Fuß.', image: 'squat-hold' },
  { id: 'faszienrolle-oberschenkel-vorne', name: 'Faszienrolle Oberschenkel vorne', source: 'fedb', category: 'mobilisation', equipment: 'faszienrolle',
    regions: ['hüfte'], goals: ['hüfte'], difficulty: 1, sides: true, reps: 10,
    instructions: 'Bauchlage, Rolle unter dem vorderen Oberschenkel. Langsam von Hüfte bis knapp über dem Knie rollen.',
    avoid: ['laufen'], image: 'faszienrolle-oberschenkel-vorne', image2: 'faszienrolle-oberschenkel-vorne-2' },
  { id: 'faszienrolle-gesaess', name: 'Faszienrolle Gesäß', source: 'fedb', category: 'mobilisation', equipment: 'faszienrolle',
    regions: ['hüfte'], goals: ['hüfte', 'hohlkreuz'], difficulty: 1, sides: true, reps: 10,
    instructions: 'Sitzend auf der Rolle, ein Fuß über das gegenüberliegende Knie legen, zur belasteten Seite neigen und leicht rollen.', image: 'faszienrolle-gesaess', image2: 'faszienrolle-gesaess-2' },

  /* ---------- Rückseite / Hamstrings ---------- */
  { id: 'seated-forward-fold', name: 'Sitzende Vorbeuge', source: 'repdb', category: 'dehnung', equipment: 'matte',
    regions: ['rueckseite'], goals: ['rueckseite'], difficulty: 0, sides: false, holdSec: 30,
    instructions: 'Sitzend, Beine lang ausgestreckt. Mit langem Rücken aus der Hüfte nach vorn beugen, so weit wie angenehm.', image: 'seated-forward-fold' },
  { id: 'standing-forward-fold', name: 'Stehende Vorbeuge', source: 'repdb', category: 'dehnung', equipment: 'keins',
    regions: ['rueckseite'], goals: ['rueckseite'], difficulty: 0, sides: false, holdSec: 30,
    instructions: 'Im Stand aus der Hüfte nach vorn beugen, Knie leicht gebeugt, locker hängen lassen.', image: 'standing-forward-fold' },
  { id: 'wide-legged-forward-fold', name: 'Weite Vorbeuge im Stand', source: 'repdb', category: 'dehnung', equipment: 'keins',
    regions: ['rueckseite'], goals: ['rueckseite'], difficulty: 1, sides: false, holdSec: 30,
    instructions: 'Füße weit auseinander, aus der Hüfte nach vorn beugen, Hände auf dem Boden oder an den Schienbeinen.', image: 'wide-legged-forward-fold' },
  { id: 'head-to-knee-pose', name: 'Kopf-zum-Knie-Haltung', source: 'repdb', category: 'dehnung', equipment: 'matte',
    regions: ['rueckseite'], goals: ['rueckseite'], difficulty: 1, sides: true, holdSec: 30,
    instructions: 'Sitzend, ein Bein lang, das andere angewinkelt zur Seite. Über das lange Bein nach vorn beugen.', image: 'head-to-knee-pose' },
  { id: 'seated-straddle-stretch', name: 'Sitzende Grätsche', source: 'repdb', category: 'dehnung', equipment: 'matte',
    regions: ['rueckseite'], goals: ['rueckseite'], difficulty: 2, sides: false, holdSec: 30,
    instructions: 'Sitzend, Beine weit gegrätscht, mit langem Rücken nach vorn beugen.', image: 'seated-straddle-stretch' },
  { id: 'happy-baby', name: 'Glückliches Baby', source: 'repdb', category: 'dehnung', equipment: 'matte',
    regions: ['rueckseite'], goals: ['rueckseite'], difficulty: 0, sides: false, holdSec: 30,
    instructions: 'Rückenlage, Knie zur Brust, Füße greifen und sanft nach unten ziehen.', image: 'happy-baby' },
  { id: 'legs-up-the-wall', name: 'Beine an der Wand', source: 'repdb', category: 'dehnung', equipment: 'matte',
    regions: ['rueckseite'], goals: ['rueckseite'], difficulty: 0, sides: false, holdSec: 45,
    instructions: 'Rückenlage nah an der Wand, Beine senkrecht an der Wand ablegen, entspannen.', image: 'legs-up-the-wall' },
  { id: 'downward-dog', name: 'Herabschauender Hund', source: 'repdb', category: 'dehnung', equipment: 'matte',
    regions: ['rueckseite', 'bws_schultern'], goals: ['rueckseite'], difficulty: 1, sides: false, holdSec: 30,
    instructions: 'Aus dem Vierfüßlerstand Gesäß nach oben schieben, Fersen Richtung Boden, Rücken lang.', image: 'downward-dog' },
  { id: 'downward-dog-pedal', name: 'Fersenwippen im herabschauenden Hund', source: 'repdb', category: 'mobilisation', equipment: 'matte',
    regions: ['rueckseite', 'sprunggelenk'], goals: ['rueckseite', 'sprunggelenk'], difficulty: 1, sides: true, reps: 10,
    instructions: 'Im herabschauenden Hund abwechselnd ein Knie beugen und die andere Ferse Richtung Boden drücken.', image: 'downward-dog-pedal' },

  /* ---------- Brustwirbelsäule / Schultern ---------- */
  { id: 'cat-cow', name: 'Katze-Kuh', source: 'repdb', category: 'mobilisation', equipment: 'matte',
    regions: ['bws_schultern'], goals: ['bws_schultern', 'hohlkreuz', 'nacken'], difficulty: 0, sides: false, reps: 10,
    instructions: 'Vierfüßlerstand. Abwechselnd Rücken rund machen (ausatmen) und durchhängen lassen (einatmen), fließend.', image: 'cat-cow' },
  { id: 'cat-stretch', name: 'Katzen-Dehnung', source: 'repdb', category: 'dehnung', equipment: 'matte',
    regions: ['bws_schultern'], goals: ['bws_schultern'], difficulty: 0, sides: false, holdSec: 25,
    instructions: 'Aus dem Vierfüßlerstand nach hinten in Richtung Fersen sinken, Arme lang ausgestreckt, Brustkorb sinkt.', image: 'cat-stretch' },
  { id: 'thread-the-needle', name: 'Nadelöhr-Drehung', source: 'repdb', category: 'mobilisation', equipment: 'matte',
    regions: ['bws_schultern'], goals: ['bws_schultern', 'hohlkreuz'], difficulty: 1, sides: true, holdSec: 20,
    instructions: 'Vierfüßlerstand, einen Arm unter dem Körper durchfädeln, Schulter und Schläfe sinken zum Boden, andere Hand bleibt gestützt.', image: 'thread-the-needle' },
  { id: 'doorway-chest-stretch', name: 'Türrahmen-Brustdehnung', source: 'repdb', category: 'dehnung', equipment: 'keins',
    regions: ['bws_schultern'], goals: ['bws_schultern'], difficulty: 0, sides: true, holdSec: 25,
    instructions: 'Unterarm am Türrahmen, Körper leicht nach vorn drehen, bis sich die Brust dehnt.', image: 'doorway-chest-stretch' },
  { id: 'cow-face-pose', name: 'Kuhgesicht-Haltung (Arme)', source: 'repdb', category: 'dehnung', equipment: 'keins',
    regions: ['bws_schultern'], goals: ['bws_schultern'], difficulty: 1, sides: true, holdSec: 20,
    instructions: 'Einen Arm von oben, den anderen von unten hinter dem Rücken verschränken oder mit Handtuch annähern.', image: 'cow-face-pose' },
  { id: 'cross-body-shoulder-stretch', name: 'Schulterdehnung über den Körper', source: 'repdb', category: 'dehnung', equipment: 'keins',
    regions: ['bws_schultern'], goals: ['bws_schultern'], difficulty: 0, sides: true, holdSec: 25,
    instructions: 'Einen Arm gestreckt vor dem Körper, mit dem anderen Arm sanft zur Brust ziehen.', image: 'cross-body-shoulder-stretch' },
  { id: 'puppy-pose', name: 'Welpen-Haltung', source: 'repdb', category: 'dehnung', equipment: 'matte',
    regions: ['bws_schultern'], goals: ['bws_schultern'], difficulty: 1, sides: false, holdSec: 30,
    instructions: 'Aus dem Kniestand Arme weit nach vorn ausstrecken, Brustkorb sinkt Richtung Boden, Gesäß bleibt über den Knien.', image: 'puppy-pose' },
  { id: 'wall-slides', name: 'Wandschieben (Wall Slides)', source: 'custom', category: 'mobilisation', equipment: 'keins',
    regions: ['bws_schultern'], goals: ['bws_schultern'], difficulty: 1, sides: false, reps: 10,
    cue: 'Unterarme bleiben an der Wand – wo das nicht mehr geht, ist der Bewegungsumfang erreicht.',
    instructions: 'Rücken und Arme an der Wand, Unterarme im rechten Winkel anlegen. Arme langsam über den Kopf gleiten lassen und zurück, Kontakt zur Wand halten.' },
  { id: 'open-book', name: 'Buch öffnen (Open Book)', source: 'custom', category: 'mobilisation', equipment: 'matte',
    regions: ['bws_schultern'], goals: ['bws_schultern', 'hohlkreuz'], difficulty: 1, sides: true, reps: 10,
    instructions: 'Seitenlage, Knie angewinkelt übereinander. Oberen Arm wie ein Buch aufklappen und dem Blick folgen, bis die Schulter den Boden berührt, dann zurück.' },
  { id: 'faszienrolle-bws', name: 'Faszienrolle Brustwirbelsäule', source: 'fedb', category: 'mobilisation', equipment: 'faszienrolle',
    regions: ['bws_schultern'], goals: ['bws_schultern', 'hohlkreuz'], difficulty: 1, sides: false, reps: 8,
    cue: 'Nur im Bereich der Brustwirbelsäule rollen, nicht über den unteren Rücken.',
    instructions: 'Rückenlage, Rolle quer unter der Brustwirbelsäule, Hände stützen den Kopf. Langsam vor- und zurückrollen, dabei leicht über die Rolle strecken.',
    avoid: ['oberkoerper'], image: 'faszienrolle-bws', image2: 'faszienrolle-bws-2' },

  /* ---------- Sprunggelenk ---------- */
  { id: 'standing-calf-stretch', name: 'Stehende Wadendehnung', source: 'repdb', category: 'dehnung', equipment: 'keins',
    regions: ['sprunggelenk'], goals: ['sprunggelenk'], difficulty: 0, sides: true, holdSec: 30,
    instructions: 'Ausfallschritt, hinteres Bein gestreckt, Ferse am Boden, Fuß zeigt nach vorn. Oberkörper leicht nach vorn lehnen.',
    avoid: ['laufen'], image: 'standing-calf-stretch' },
  { id: 'knie-zur-wand', name: 'Knie-zur-Wand (Sprunggelenk)', source: 'custom', category: 'mobilisation', equipment: 'keins',
    regions: ['sprunggelenk'], goals: ['sprunggelenk'], difficulty: 1, sides: true, reps: 10,
    cue: 'Ferse bleibt die ganze Zeit am Boden.',
    instructions: 'Im Ausfallschritt vor einer Wand, vorderer Fuß nah an der Wand. Knie wiederholt zur Wand führen, ohne die Ferse abzuheben; Abstand zur Wand je nach Beweglichkeit anpassen.',
    avoid: ['laufen'] },
  { id: 'ankle-circles', name: 'Sprunggelenk kreisen', source: 'fedb', category: 'mobilisation', equipment: 'keins',
    regions: ['sprunggelenk'], goals: ['sprunggelenk'], difficulty: 0, sides: true, reps: 10,
    instructions: 'Stehend, an Wand oder Stuhl festhalten. Einen Fuß knapp vom Boden abheben und mit der großen Zehe große Kreise malen, dann Richtung wechseln.', image: 'ankle-circles', image2: 'ankle-circles-2' },
  { id: 'faszienrolle-wade', name: 'Faszienrolle Wade', source: 'fedb', category: 'mobilisation', equipment: 'faszienrolle',
    regions: ['sprunggelenk'], goals: ['sprunggelenk'], difficulty: 1, sides: true, reps: 10,
    instructions: 'Sitzend, Rolle unter der Wade, Hände stützen hinter dem Körper. Von der Kniekehle bis knapp über der Ferse rollen, dabei den Fuß leicht beugen und strecken.', image: 'faszienrolle-wade', image2: 'faszienrolle-wade-2' },

  /* ---------- Nacken / Haltung ---------- */
  { id: 'neck-side-stretch', name: 'Seitliche Nackendehnung', source: 'repdb', category: 'dehnung', equipment: 'keins',
    regions: ['nacken'], goals: ['nacken'], difficulty: 0, sides: true, holdSec: 20,
    instructions: 'Aufrecht sitzen oder stehen, Kopf sanft zur Seite zum Ohr neigen, Hand zieht leicht nach, gegenseitige Schulter sinkt nach unten.', image: 'neck-side-stretch' },
  { id: 'kinn-einziehen', name: 'Kinn einziehen', source: 'custom', category: 'aktivierung', equipment: 'keins',
    regions: ['nacken'], goals: ['nacken'], difficulty: 0, sides: false, reps: 10,
    cue: 'Kopf schiebt gerade nach hinten, nickt nicht nach unten.',
    instructions: 'Aufrecht sitzen, Kinn gerade nach hinten einziehen (Doppelkinn), 2 Sekunden halten, lösen. Kräftigt die tiefe Nackenmuskulatur gegen den Vorschub des Kopfes.' },
  { id: 'overhead-triceps-stretch', name: 'Trizeps-Dehnung über Kopf', source: 'repdb', category: 'dehnung', equipment: 'keins',
    regions: ['nacken', 'bws_schultern'], goals: ['nacken', 'bws_schultern'], difficulty: 0, sides: true, holdSec: 25,
    instructions: 'Einen Arm über den Kopf beugen, mit der anderen Hand den Ellbogen sanft nach hinten unten ziehen.', image: 'overhead-triceps-stretch' },

  /* ---------- Rumpf / Becken ---------- */
  { id: 'dead-bug', name: 'Dead Bug', source: 'repdb', category: 'aktivierung', equipment: 'matte',
    regions: ['rumpf'], goals: ['rumpf', 'hohlkreuz'], difficulty: 1, sides: true, reps: 8,
    cue: 'Unterer Rücken bleibt die ganze Zeit am Boden – lieber kleinere Bewegung als Hohlkreuz zulassen.',
    instructions: 'Rückenlage, Arme zur Decke, Knie 90° angewinkelt. Gegengleich Arm und Bein langsam absenken, ohne dass sich der Rücken vom Boden löst.',
    avoid: ['oberkoerper', 'beinkraft'], image: 'dead-bug' },
  { id: 'bird-dog', name: 'Bird-Dog', source: 'repdb', category: 'aktivierung', equipment: 'matte',
    regions: ['rumpf'], goals: ['rumpf', 'hohlkreuz'], difficulty: 1, sides: true, holdSec: 15,
    cue: 'Becken bleibt ruhig und waagerecht, nicht zur Seite kippen.',
    instructions: 'Vierfüßlerstand, gegengleich Arm und Bein gerade ausstrecken, Becken stabil halten, dann wechseln.',
    avoid: ['oberkoerper', 'beinkraft'], image: 'bird-dog' },
  { id: 'glute-bridge', name: 'Glute Bridge', source: 'repdb', category: 'aktivierung', equipment: 'matte',
    regions: ['rumpf'], goals: ['hüfte', 'hohlkreuz'], difficulty: 0, sides: false, reps: 12,
    cue: 'Oben Gesäß anspannen statt ins Hohlkreuz zu drücken.', instructions: 'Rückenlage, Füße aufgestellt. Becken anheben, oben Gesäß anspannen, langsam ablegen.',
    avoid: ['beinkraft'], image: 'glute-bridge' },
  { id: 'single-leg-glute-bridge', name: 'Einbeinige Glute Bridge', source: 'repdb', category: 'aktivierung', equipment: 'matte',
    regions: ['rumpf'], goals: ['hüfte', 'hohlkreuz'], difficulty: 2, sides: true, reps: 8,
    instructions: 'Wie Glute Bridge, ein Fuß vom Boden abheben und das Becken einbeinig anheben, dabei waagerecht halten.',
    avoid: ['beinkraft'], image: 'single-leg-glute-bridge' },
  { id: 'thoracic-bridge', name: 'Thorakale Brücke', source: 'repdb', category: 'mobilisation', equipment: 'matte',
    regions: ['rumpf', 'bws_schultern'], goals: ['rumpf', 'bws_schultern'], difficulty: 2, sides: true, holdSec: 10,
    instructions: 'Seitstütz auf dem Unterarm, freien Arm unter dem Körper durchführen und dann weit nach oben öffnen, Blick folgt der Hand.', image: 'thoracic-bridge' },
  { id: 'plank', name: 'Plank', source: 'repdb', category: 'aktivierung', equipment: 'matte',
    regions: ['rumpf'], goals: ['rumpf', 'hohlkreuz'], difficulty: 1, sides: false, holdSec: 25,
    cue: 'Becken leicht einrollen, kein Durchhängen ins Hohlkreuz.', instructions: 'Unterarmstütz, Körper eine gerade Linie von Kopf bis Fersen, Bauch und Gesäß aktiv anspannen.',
    avoid: ['oberkoerper'], image: 'plank' },
  { id: 'side-plank', name: 'Side Plank', source: 'repdb', category: 'aktivierung', equipment: 'matte',
    regions: ['rumpf'], goals: ['rumpf'], difficulty: 2, sides: true, holdSec: 20,
    instructions: 'Seitstütz auf dem Unterarm, Körper eine gerade Linie, Hüfte anheben und halten.', avoid: ['oberkoerper'], image: 'side-plank' },
  { id: 'wall-sit', name: 'Wandsitzen', source: 'repdb', category: 'aktivierung', equipment: 'keins',
    regions: ['rumpf'], goals: ['hüfte'], difficulty: 1, sides: false, holdSec: 30,
    instructions: 'Rücken an der Wand, in die Kniebeuge sinken bis die Oberschenkel etwa waagerecht sind, halten.',
    avoid: ['beinkraft'], image: 'wall-sit' },
  { id: 'clamshells', name: 'Clamshells', source: 'repdb', category: 'aktivierung', equipment: 'matte',
    regions: ['rumpf'], goals: ['hüfte'], difficulty: 1, sides: true, reps: 12,
    instructions: 'Seitenlage, Knie angewinkelt übereinander, Füße zusammen. Oberes Knie wie eine Muschel öffnen, Becken bleibt stabil.',
    avoid: ['beinkraft'], image: 'clamshells' },
  { id: 'torso-twists', name: 'Rumpfdrehungen', source: 'repdb', category: 'mobilisation', equipment: 'keins',
    regions: ['rumpf'], goals: ['rumpf'], difficulty: 0, sides: false, reps: 12,
    instructions: 'Im Stand, Hüfte stabil, Oberkörper locker von einer Seite zur anderen drehen, Arme schwingen mit.', image: 'torso-twists' },
  { id: 'standing-side-bend', name: 'Stehende Seitneige', source: 'repdb', category: 'dehnung', equipment: 'keins',
    regions: ['rumpf'], goals: ['rumpf'], difficulty: 0, sides: true, holdSec: 20,
    instructions: 'Im Stand einen Arm über den Kopf strecken und zur Seite neigen, die andere Hand sinkt am Bein entlang.', image: 'standing-side-bend' },
  { id: 'seated-spinal-twist', name: 'Sitzende Wirbelsäulendrehung', source: 'repdb', category: 'mobilisation', equipment: 'matte',
    regions: ['rumpf'], goals: ['rumpf', 'bws_schultern'], difficulty: 1, sides: true, holdSec: 20,
    instructions: 'Sitzend, ein Bein über das andere kreuzen, Oberkörper zur angewinkelten Seite drehen, Hand stützt hinten ab.', image: 'seated-spinal-twist' },
  { id: 'supine-spinal-twist', name: 'Liegende Wirbelsäulendrehung', source: 'repdb', category: 'dehnung', equipment: 'matte',
    regions: ['rumpf'], goals: ['rumpf'], difficulty: 0, sides: true, holdSec: 25,
    instructions: 'Rückenlage, Knie angewinkelt zu einer Seite ablegen, Arme seitlich ausgestreckt, Blick zur Gegenseite.', image: 'supine-spinal-twist' },
  { id: 'cobra-stretch', name: 'Kobra-Dehnung', source: 'repdb', category: 'dehnung', equipment: 'matte',
    regions: ['rumpf'], goals: [], difficulty: 0, sides: false, holdSec: 20,
    instructions: 'Bauchlage, Hände unter den Schultern aufstützen, Oberkörper leicht aufrichten, Becken bleibt am Boden.', image: 'cobra-stretch' },
  { id: 'becken-aufrichten', name: 'Becken aufrichten im Stand', source: 'fedb', category: 'aktivierung', equipment: 'keins',
    regions: ['rumpf'], goals: ['hohlkreuz'], difficulty: 0, sides: false, reps: 10,
    cue: 'Bewusst zwischen Hohlkreuz und aufgerichtetem Becken wechseln, den Unterschied spüren.',
    instructions: 'Im Stand das Becken abwechselnd leicht nach vorn (Hohlkreuz) und nach hinten kippen (Gesäß anspannen, Bauch aktiv), dann in der aufgerichteten Position halten.', image: 'becken-aufrichten', image2: 'becken-aufrichten-2' },
  { id: 'childs-pose', name: 'Stellung des Kindes', source: 'repdb', category: 'dehnung', equipment: 'matte',
    regions: ['rumpf', 'bws_schultern'], goals: [], difficulty: 0, sides: false, holdSec: 30,
    instructions: 'Kniend, Gesäß sinkt Richtung Fersen, Arme lang nach vorn, Stirn sinkt zum Boden. Entspannt atmen.', image: 'childs-pose' },

  /* ---------- Handgelenk (kurze Ergänzung, kein eigenes Ziel) ---------- */
  { id: 'kneeling-wrist-stretch', name: 'Kniende Handgelenkdehnung', source: 'repdb', category: 'dehnung', equipment: 'matte',
    regions: ['bws_schultern'], goals: [], difficulty: 0, sides: true, holdSec: 15,
    instructions: 'Kniend, Hand mit der Innenfläche nach oben auf den Boden legen, Finger zum Körper, sanft zurücklehnen.', image: 'kneeling-wrist-stretch' },
  /* ---------- Ergänzungen aus Free Exercise DB (Fotos Start/Ende) ---------- */
  { id: 'faszienrolle-hamstrings', name: 'Faszienrolle Oberschenkel hinten', source: 'fedb', category: 'mobilisation', equipment: 'faszienrolle',
    regions: ['rueckseite'], goals: ['rueckseite'], difficulty: 0, sides: true, reps: 10,
    instructions: 'Sitzend, Rolle unter den hinteren Oberschenkeln, Hände stützen hinter dem Körper. Hüfte anheben, Gewicht auf ein Bein verlagern und langsam von unterhalb des Gesäßes bis über die Kniekehle rollen. An festen Stellen 10–30 s verweilen.',
    image: 'faszienrolle-hamstrings', image2: 'faszienrolle-hamstrings-2' },
  { id: 'faszienrolle-latissimus', name: 'Faszienrolle seitlicher Rücken', source: 'fedb', category: 'mobilisation', equipment: 'faszienrolle',
    regions: ['bws_schultern'], goals: ['bws_schultern'], difficulty: 0, sides: true, holdSec: 30,
    instructions: 'Seitlich liegen, Rolle knapp unter der Achsel, Arm nach oben ausgestreckt. Oberkörper vom Boden lösen, Gewicht auf die Rolle geben und leicht vor- und zurückrollen bzw. an festen Stellen halten.',
    image: 'faszienrolle-latissimus', image2: 'faszienrolle-latissimus-2' },
  { id: 'faszienrolle-oberschenkel-aussen', name: 'Faszienrolle Oberschenkel außen', source: 'fedb', category: 'mobilisation', equipment: 'faszienrolle',
    regions: ['hüfte'], goals: ['hüfte'], difficulty: 1, sides: true, reps: 8,
    cue: 'Nur so viel Gewicht, dass du entspannt bleiben kannst – das obere Bein vorne aufstellen nimmt Druck raus.',
    instructions: 'Seitlich liegen, Rolle unter der Außenseite des Oberschenkels zwischen Hüfte und Knie, auf den Unterarm stützen. Langsam von der Hüfte bis knapp über das Knie rollen, an festen Stellen kurz halten.',
    image: 'faszienrolle-oberschenkel-aussen', image2: 'faszienrolle-oberschenkel-aussen-2' },
  { id: 'faszienrolle-adduktoren', name: 'Faszienrolle Oberschenkel innen', source: 'fedb', category: 'mobilisation', equipment: 'faszienrolle',
    regions: ['hüfte'], goals: ['hüfte'], difficulty: 0, sides: true, reps: 10,
    instructions: 'Bauchlage auf den Unterarmen, ein Bein seitlich angewinkelt, Rolle an der Innenseite des Oberschenkels. Zwischen Knie und Leiste hin- und herrollen, an festen Stellen 10–30 s halten.',
    image: 'faszienrolle-adduktoren', image2: 'faszienrolle-adduktoren-2' },
  { id: 'faszienrolle-wade-aussen', name: 'Faszienrolle Unterschenkel außen', source: 'fedb', category: 'mobilisation', equipment: 'faszienrolle',
    regions: ['sprunggelenk'], goals: ['sprunggelenk'], difficulty: 1, sides: true, reps: 10,
    instructions: 'Seitlich liegen, auf den Unterarm gestützt, Rolle unter der Außenseite des Unterschenkels. Hüfte anheben und von unterhalb des Knies bis über den Knöchel rollen.',
    image: 'faszienrolle-wade-aussen', image2: 'faszienrolle-wade-aussen-2' },
  { id: 'wadendehnung-sitzend', name: 'Wadendehnung im Sitzen', source: 'fedb', category: 'dehnung', equipment: 'matte',
    regions: ['sprunggelenk', 'rueckseite'], goals: ['sprunggelenk'], difficulty: 0, sides: true, holdSec: 30,
    instructions: 'Aufrecht sitzen, ein Bein aufgestellt, das andere gestreckt. Fußspitze des gestreckten Beins mit der Hand (oder einem Handtuch) zu dir ziehen, Rücken lang lassen.',
    image: 'wadendehnung-sitzend', image2: 'wadendehnung-sitzend-2' },
  { id: 'kinn-zur-brust', name: 'Kinn zur Brust', source: 'fedb', category: 'dehnung', equipment: 'keins',
    regions: ['nacken'], goals: ['nacken'], difficulty: 0, sides: false, holdSec: 25,
    cue: 'Nur mit dem Gewicht der Hände ziehen, nicht drücken.',
    instructions: 'Aufrecht sitzen, Hände am Hinterkopf verschränken, Ellbogen nach vorn. Den Kopf langsam Richtung Brust sinken lassen und halten.',
    image: 'kinn-zur-brust', image2: 'kinn-zur-brust-2' },
  { id: 'beckenkippen-bruecke', name: 'Beckenkippen in die Brücke', source: 'fedb', category: 'aktivierung', equipment: 'matte',
    regions: ['rumpf'], goals: ['hohlkreuz'], difficulty: 1, sides: false, reps: 8,
    cue: 'Erst nur das Becken kippen (Steißbein hoch, unterer Rücken an den Boden), dann Wirbel für Wirbel hochrollen.',
    instructions: 'Rückenlage, Füße aufgestellt, Fersen unter den Knien. Bauch anspannen, Steißbein anheben, dann die Wirbelsäule bis auf den Nacken abheben. Langsam Wirbel für Wirbel wieder ablegen.',
    image: 'beckenkippen-bruecke', image2: 'beckenkippen-bruecke-2' },
  { id: 'schulterkreisen', name: 'Schulterkreisen', source: 'fedb', category: 'mobilisation', equipment: 'keins',
    regions: ['nacken', 'bws_schultern'], goals: ['nacken'], difficulty: 0, sides: false, reps: 10,
    instructions: 'Arme locker hängen lassen. Schultern langsam nach vorn, oben, hinten und unten kreisen, dann Richtung wechseln.',
    image: 'schulterkreisen', image2: 'schulterkreisen-2' }
];

export const byId = (id: string) => LIBRARY.find(e => e.id === id);
export const usedImageIds = () => LIBRARY.filter(e => e.image).map(e => e.id);

/** Nur Übungen mit Bild: ohne Bild ist unklar, was zu tun ist (Nutzerwunsch). */
export const LIBRARY: MobilityExercise[] = ALL.filter(e => !!e.image);
