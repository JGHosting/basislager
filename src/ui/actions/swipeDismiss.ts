/**
 * Svelte-Action: Fenster (Sheet) durch Herunterziehen schließen – wie bei iOS.
 * Ziehen startet nur, wenn der Inhalt ganz oben steht (sonst wird normal gescrollt).
 * Weit genug (> 110 px) oder schnell genug nach unten → schließen, sonst zurückfedern.
 */
export function swipeDismiss(node: HTMLElement, onclose: () => void) {
  let startY = 0, startT = 0, dy = 0, dragging = false, tracking = false;
  let close = onclose;

  const backdrop = () => node.previousElementSibling as HTMLElement | null;
  const setY = (y: number, anim = false) => {
    node.style.transition = anim ? 'transform .25s cubic-bezier(.2,.9,.3,1)' : 'none';
    node.style.transform = y ? `translateY(${y}px)` : '';
    const b = backdrop(); if (b) { b.style.transition = node.style.transition.replace('transform', 'opacity'); b.style.opacity = String(Math.max(0, 1 - y / 400)); }
  };

  function start(e: TouchEvent) {
    if (e.touches.length !== 1) return;
    const t = e.target as HTMLElement;
    // Nicht aus Eingabefeldern, Kamera oder horizontal scrollbaren Bereichen heraus ziehen
    if (t.closest('input, textarea, select, video, .no-swipe')) return;
    tracking = node.scrollTop <= 0;
    startY = e.touches[0].clientY; startT = Date.now(); dy = 0; dragging = false;
  }
  function move(e: TouchEvent) {
    if (!tracking) return;
    const d = e.touches[0].clientY - startY;
    if (!dragging) {
      if (d > 8 && node.scrollTop <= 0) dragging = true;          // nach unten am oberen Rand → Ziehen
      else if (d < -4) { tracking = false; return; }               // nach oben → normal scrollen
      else return;
    }
    e.preventDefault();
    dy = Math.max(0, d - 8);
    setY(dy * (dy > 200 ? 0.85 : 1));
  }
  function end() {
    if (!dragging) { tracking = false; return; }
    const v = dy / Math.max(1, Date.now() - startT);              // px pro ms
    dragging = tracking = false;
    if (dy > 110 || (v > 0.6 && dy > 30)) {
      setY(window.innerHeight, true);
      (document.activeElement as HTMLElement | null)?.blur?.();
      setTimeout(() => close(), 200);
    } else setY(0, true);
  }

  node.addEventListener('touchstart', start, { passive: true });
  node.addEventListener('touchmove', move, { passive: false });
  node.addEventListener('touchend', end);
  node.addEventListener('touchcancel', end);
  return {
    update(fn: () => void) { close = fn; },
    destroy() {
      node.removeEventListener('touchstart', start); node.removeEventListener('touchmove', move);
      node.removeEventListener('touchend', end); node.removeEventListener('touchcancel', end);
    }
  };
}
