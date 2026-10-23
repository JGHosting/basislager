import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { registerSW } from 'virtual:pwa-register';


mount(App, { target: document.getElementById('app')! });

// Neue Version sofort übernehmen: sobald der neue Service Worker aktiv ist, lädt die App einmal neu
// (vorher war erst beim zweiten Öffnen nach einem Update die neue Version sichtbar).
registerSW({ immediate: true });

// iOS ignoriert user-scalable=no teilweise → Pinch-Zoom-Gesten zusätzlich abfangen
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, e => e.preventDefault(), { passive: false });
document.addEventListener('touchmove', e => { if ((e as TouchEvent).touches.length > 1) e.preventDefault(); }, { passive: false });
