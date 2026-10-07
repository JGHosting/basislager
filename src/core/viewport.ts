/**
 * Setzt --app-h auf die echte Bildschirmhöhe.
 * iOS-Bug: In der installierten Web-App (Statusleiste "black-translucent") ist der Layout-Viewport
 * teils kürzer als der Bildschirm. Im Vollbild-Modus ist screen.height die verlässliche Höhe.
 */
export function isStandalone(): boolean {
  return matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
}
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function appHeight(): number {
  let h = window.innerHeight;
  if (isStandalone() && isIOS()) {
    const portrait = matchMedia('(orientation: portrait)').matches;
    const screenH = portrait ? Math.max(screen.height, screen.width) : Math.min(screen.height, screen.width);
    h = Math.max(h, screenH);
  }
  return h;
}

export function fitViewport() {
  const set = () => document.documentElement.style.setProperty('--app-h', appHeight() + 'px');
  set();
  addEventListener('resize', set);
  addEventListener('orientationchange', () => setTimeout(set, 300));
  visualViewport?.addEventListener('resize', set);
}

/** Messwerte für die Fehlersuche (Mehr → Gerät). */
export function viewportInfo() {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);visibility:hidden';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const info = {
    innerHeight: innerHeight, screenHeight: screen.height,
    appHeight: Math.round(document.getElementById('app')?.getBoundingClientRect().height ?? 0),
    navBottom: Math.round(document.querySelector('nav')?.getBoundingClientRect().bottom ?? 0),
    safeTop: parseFloat(cs.paddingTop), safeBottom: parseFloat(cs.paddingBottom)
  };
  probe.remove();
  return info;
}
