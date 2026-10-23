/**
 * Selbsttests: alle `testIntervalWeeks` Wochen fällig. Jeder Test ist einer Region zugeordnet;
 * das Ergebnis im Vergleich zum letzten Test beeinflusst die Gewichtung der Routine (schwächere
 * Region bekommt mehr Übungen) und schaltet bei Verbesserung die nächste Progressionsstufe frei.
 */
import { db } from '../../core/db';
import { newId } from '../../core/ids';
import { today, addDays } from '../../core/dates';
import type { Region } from './library';

export type TestInput = 'cm' | 'stufe';
export interface MobilityTestDef {
  id: string; label: string; region: Region; input: TestInput;
  /** Stufen-Tests: Beschriftung je Stufe (0 = am wenigsten beweglich). */
  stages?: string[];
  /** true = kleinerer Wert ist besser (z. B. Finger-Boden-Abstand in cm). */
  lowerIsBetter?: boolean;
  hint: string;
  sides?: boolean;
}

export const TESTS: MobilityTestDef[] = [
  { id: 'tiefe-hocke', label: 'Tiefe Hocke', region: 'hüfte', input: 'stufe', lowerIsBetter: false,
    stages: ['Fersen heben deutlich ab', 'Fersen heben leicht ab', 'Fersen bleiben unten, Rücken rund', 'Aufrecht in der vollen Hocke, Fersen unten'],
    hint: 'Barfuß, Füße hüftbreit, so tief wie möglich in die Hocke sinken.' },
  { id: 'finger-boden', label: 'Finger-Boden-Abstand', region: 'rueckseite', input: 'cm', lowerIsBetter: true,
    hint: 'Im Stand, Beine durchgestreckt, mit den Fingerspitzen so weit wie möglich Richtung Boden reichen. Abstand in cm messen (0 = Boden berührt, negativ = flache Hand möglich).' },
  { id: 'ueberkopf', label: 'Überkopfreichweite an der Wand', region: 'bws_schultern', input: 'stufe', lowerIsBetter: false,
    stages: ['Arm erreicht die Wand nicht gestreckt', 'Arm berührt die Wand, Rücken wölbt sich', 'Arm gestreckt an der Wand, Rücken bleibt flach', 'Beide Arme gestreckt an der Wand, Rücken flach'],
    hint: 'Rücken flach an der Wand, Arme über den Kopf strecken, ohne dass sich der untere Rücken wölbt.' },
  { id: 'sprunggelenk', label: 'Knie-zur-Wand', region: 'sprunggelenk', input: 'cm', lowerIsBetter: false, sides: true,
    hint: 'Im Ausfallschritt zur Wand: größter Abstand der Zehen zur Wand, bei dem das Knie die Wand noch berührt, ohne die Ferse abzuheben.' },
  { id: 'hueftbeuger', label: 'Hüftbeuger-Test (liegend)', region: 'hüfte', input: 'stufe', lowerIsBetter: false, sides: true,
    stages: ['Bein hebt sich deutlich vom Tisch/Bett ab', 'Bein liegt knapp nicht auf', 'Bein liegt flach auf, Knie 90°', 'Bein liegt flach auf, Knie deutlich über 90° beugbar'],
    hint: 'Auf der Tischkante sitzen, ein Knie zur Brust ziehen, anderes Bein nach hinten sinken lassen (Thomas-Test).' },
  { id: 'becken', label: 'Becken aufrichten im Stand', region: 'rumpf', input: 'stufe', lowerIsBetter: false,
    stages: ['Gelingt nicht erkennbar', 'Gelingt mit Mühe/kurz', 'Gelingt sauber und haltbar'],
    hint: 'Becken aus dem Hohlkreuz bewusst aufrichten (Gesäß anspannen) und die Position 10 Sekunden halten.' },
  { id: 'nacken', label: 'Nacken: Kinn zur Brust & Drehung', region: 'nacken', input: 'stufe', lowerIsBetter: false,
    stages: ['Deutlich eingeschränkt', 'Leicht eingeschränkt', 'Kinn erreicht die Brust, Drehung ca. 80°'],
    hint: 'Kinn zur Brust senken, dann den Kopf so weit wie möglich zu beiden Seiten drehen.' }
];

export async function lastTest(): Promise<{ date: string; results: Record<string, number> } | null> {
  const row = await db.mobilityTests.orderBy('date').last();
  return row ? { date: row.date, results: row.results } : null;
}
export async function testDue(intervalWeeks: number): Promise<boolean> {
  const last = await lastTest();
  if (!last) return true;
  return today() >= addDays(last.date, intervalWeeks * 7);
}
export async function saveTestResult(results: Record<string, number>) {
  await db.mobilityTests.add({ id: newId(), date: today(), results, createdAt: Date.now() });
}

/** 0 (schlecht) .. 1 (gut) je Region, normiert aus dem jeweiligen Test-Ergebnis. */
export function regionScore(results: Record<string, number>): Partial<Record<Region, number>> {
  const out: Partial<Record<Region, number>> = {};
  for (const t of TESTS) {
    const v = results[t.id]; if (v == null) continue;
    let s: number;
    if (t.input === 'stufe') s = t.stages ? v / (t.stages.length - 1) : 0.5;
    else s = t.lowerIsBetter ? Math.max(0, Math.min(1, 1 - v / 30)) : Math.max(0, Math.min(1, v / 15));
    out[t.region] = Math.min(out[t.region] ?? 1, s);   // schlechtester Wert der Region zählt
  }
  return out;
}
/** Gewichtungs-Multiplikator je Region aus dem letzten Test (0.8–1.5; unbekannt = 1). */
export function regionWeightBoost(scores: Partial<Record<Region, number>>, region: Region): number {
  const s = scores[region]; if (s == null) return 1;
  return 1.5 - 0.7 * s;   // s=0 → 1.5×, s=1 → 0.8×
}
/** Vergleich mit dem vorletzten Test: deutliche Verbesserung in mind. 2 Regionen → eine Stufe schwerer. */
export async function suggestedLevel(current: 0 | 1 | 2): Promise<0 | 1 | 2> {
  const rows = await db.mobilityTests.orderBy('date').reverse().limit(2).toArray();
  if (rows.length < 2) return current;
  const a = regionScore(rows[1].results), b = regionScore(rows[0].results);
  let improved = 0;
  for (const r of Object.keys(b) as Region[]) if ((b[r] ?? 0) - (a[r] ?? 0) >= 0.15) improved++;
  if (improved >= 2 && current < 2) return (current + 1) as 0 | 1 | 2;
  return current;
}
