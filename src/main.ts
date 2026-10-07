import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';


mount(App, { target: document.getElementById('app')! });

// iOS ignoriert user-scalable=no teilweise → Pinch-Zoom-Gesten zusätzlich abfangen
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, e => e.preventDefault(), { passive: false });
document.addEventListener('touchmove', e => { if ((e as TouchEvent).touches.length > 1) e.preventDefault(); }, { passive: false });
