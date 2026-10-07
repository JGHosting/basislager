/**
 * Pulszonen nach Prozent vom Maximalpuls (klassisches 5-Zonen-Modell + Zone 0).
 * Grenzen hängen am Maximalpuls aus "Mehr → Pulswerte" (automatisch oder selbst eingetragen).
 */
export const ZONES = [
  { id: 0, label: 'Sehr leicht', from: 0, to: 0.5 },
  { id: 1, label: 'Regeneration', from: 0.5, to: 0.6 },
  { id: 2, label: 'Grundlage', from: 0.6, to: 0.7 },
  { id: 3, label: 'Aerob', from: 0.7, to: 0.8 },
  { id: 4, label: 'Schwelle', from: 0.8, to: 0.9 },
  { id: 5, label: 'Maximal', from: 0.9, to: 1.0 }
];
export const zoneBpm = (max: number) => ZONES.map(z => ({ ...z, lo: Math.round(z.from * max), hi: Math.round(z.to * max) }));

/** Puls-Histogramm aus Zeitreihe: Sekunden je bpm (Lücken > 10 s werden nicht gezählt). */
export function histogram(hr: (number | null)[], time?: (number | null)[]): [number, number][] {
  const m = new Map<number, number>();
  for (let i = 0; i < hr.length; i++) {
    const v = hr[i]; if (v == null || v < 30 || v > 230) continue;
    const dt = time && time[i + 1] != null && time[i] != null ? Math.min(10, Math.max(0, time[i + 1]! - time[i]!)) : 1;
    m.set(Math.round(v), (m.get(Math.round(v)) ?? 0) + dt);
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0]);
}

/** Sekunden je Zone (Index = Zone 0–5). Über dem Maximalpuls zählt zu Zone 5. */
export function zoneTimes(hist: [number, number][], max: number): number[] {
  const out = ZONES.map(() => 0);
  for (const [bpm, secs] of hist) {
    const p = bpm / max;
    const z = p >= 0.9 ? 5 : p >= 0.8 ? 4 : p >= 0.7 ? 3 : p >= 0.6 ? 2 : p >= 0.5 ? 1 : 0;
    out[z] += secs;
  }
  return out;
}
