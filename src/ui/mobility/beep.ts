/**
 * Signalton für den Halte-Timer (Web Audio, kein Audiofile nötig).
 * iOS erlaubt Ton nur, wenn der AudioContext in einer Nutzeraktion gestartet wurde → unlockAudio() beim Tippen auf „Start“.
 */
let ctx: AudioContext | null = null;

export function unlockAudio() {
  try {
    // iOS 17+: Ton auch bei Stummschalter (wie eine Timer-App)
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    if (nav.audioSession) nav.audioSession.type = 'playback';
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    if (ctx.state === 'suspended') void ctx.resume();
    // stiller Ton, damit der Kontext auf iOS wirklich "entsperrt" ist
    const o = ctx.createOscillator(); const g = ctx.createGain();
    g.gain.value = 0; o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.01);
  } catch { /* kein Ton möglich */ }
}

/** Drei kurze Pieptöne, der letzte höher. */
export function beep() {
  try {
    navigator.vibrate?.([200, 100, 200]);
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume();
    const t0 = ctx.currentTime + 0.05;
    [0, 0.28, 0.56].forEach((dt, i) => {
      const o = ctx!.createOscillator(); const g = ctx!.createGain();
      o.type = 'sine'; o.frequency.value = i === 2 ? 1320 : 880;
      const t = t0 + dt, len = i === 2 ? 0.35 : 0.18;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.connect(g).connect(ctx!.destination);
      o.start(t); o.stop(t + len + 0.02);
    });
  } catch { /* ignorieren */ }
}
