/**
 * Signalton für den Halte-Timer.
 *
 * iOS schaltet Web Audio mit dem Lautlos-Schalter stumm, ein <audio>-Element mit Medien-Wiedergabe
 * aber nicht (wie bei Timer-/Musik-Apps). Deshalb wird der Ton als kleine WAV-Datei im Speicher erzeugt
 * und über ein <audio>-Element abgespielt. iOS erlaubt das Abspielen später (ohne Tippen) nur, wenn das
 * Element vorher in einer Nutzeraktion einmal gestartet wurde → unlockAudio() beim Tippen auf „Start“.
 */
let el: HTMLAudioElement | null = null;
let unlocked = false;

/** Drei kurze Pieptöne (880 Hz, 880 Hz, 1320 Hz) als WAV-Blob. */
function makeWav(): string {
  const rate = 22050;
  const tones: [number, number, number][] = [[0, 0.18, 880], [0.28, 0.18, 880], [0.56, 0.35, 1320]];   // Start, Länge, Frequenz
  const total = Math.ceil(rate * 1.0);
  const data = new Int16Array(total);
  for (const [t0, len, f] of tones) {
    const a = Math.floor(t0 * rate), n = Math.floor(len * rate);
    for (let i = 0; i < n; i++) {
      const env = Math.min(1, i / (0.01 * rate), (n - i) / (0.03 * rate));   // weiches Ein-/Ausblenden
      data[a + i] = Math.round(Math.sin((2 * Math.PI * f * i) / rate) * env * 0.8 * 32767);
    }
  }
  const buf = new ArrayBuffer(44 + data.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + data.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, data.length * 2, true);
  new Int16Array(buf, 44).set(data);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

/** Muss in einer Nutzeraktion (Tippen auf „Start“) aufgerufen werden. */
export function unlockAudio() {
  try {
    // iOS 17+: Wiedergabe-Kategorie „playback“ → Ton auch bei Lautlos
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    if (nav.audioSession) nav.audioSession.type = 'playback';
    if (!el) { el = new Audio(makeWav()); el.preload = 'auto'; }
    if (unlocked) return;
    el.muted = true;
    void el.play().then(() => { el!.pause(); el!.currentTime = 0; el!.muted = false; unlocked = true; })
      .catch(() => { if (el) el.muted = false; });
  } catch { /* kein Ton möglich */ }
}

export function beep() {
  try {
    navigator.vibrate?.([200, 100, 200]);
    if (!el) return;
    el.muted = false;
    el.currentTime = 0;
    void el.play().catch(() => {});
  } catch { /* ignorieren */ }
}
