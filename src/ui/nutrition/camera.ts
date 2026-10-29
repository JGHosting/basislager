/**
 * Kamera-Stream wiederverwenden: iOS fragt in Home-Bildschirm-Apps bei jedem neuen
 * getUserMedia erneut nach der Erlaubnis. Deshalb bleibt der Stream nach dem Scannen
 * im Hintergrund offen (Spur deaktiviert) und wird erst nach einigen Minuten ohne
 * Scan oder beim Verlassen der App geschlossen.
 */
const IDLE_MS = 5 * 60 * 1000;
let master: MediaStream | null = null;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

function alive(s: MediaStream | null): s is MediaStream {
  return !!s && s.getVideoTracks().some((t) => t.readyState === 'live');
}

export function releaseCamera() {
  clearTimeout(idleTimer);
  master?.getTracks().forEach((t) => t.stop());
  master = null;
}

/** Liefert eine Kopie des offenen Streams (ZXing darf die Kopie beim Stoppen schließen). */
export async function acquireCamera(): Promise<MediaStream> {
  clearTimeout(idleTimer);
  if (!alive(master)) {
    master = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
      audio: false
    });
  }
  master.getVideoTracks().forEach((t) => (t.enabled = true));
  return master.clone();
}

/** Scanner geschlossen: Kamera ruhen lassen, nach Leerlauf ganz freigeben. */
export function parkCamera() {
  master?.getVideoTracks().forEach((t) => (t.enabled = false));
  clearTimeout(idleTimer);
  idleTimer = setTimeout(releaseCamera, IDLE_MS);
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') releaseCamera();
  });
}
