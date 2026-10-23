<script lang="ts">
  import { startMobilityNow, dismissMobilityNag } from '../app.svelte';
</script>

<div class="backdrop" role="presentation" onclick={dismissMobilityNag}></div>
<div class="nag" role="dialog" aria-modal="true" aria-label="Mobility-Erinnerung">
  <p class="eyebrow">Mobility</p>
  <h3>Heute noch offen</h3>
  <p class="muted">Deine Stretching-/Mobility-Routine für heute wartet noch.</p>
  <div class="actions">
    <button class="btn ghost" onclick={dismissMobilityNag}>Später</button>
    <button class="btn primary" onclick={startMobilityNow}>Jetzt starten</button>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; touch-action: none; background: rgba(0,0,0,.4); z-index: 24; animation: fade .2s; }
  .nag { position: fixed; left: 16px; right: 16px; bottom: calc(env(safe-area-inset-bottom) + 86px); z-index: 25;
         max-width: 608px; margin: 0 auto; background: var(--card); border-radius: 20px; padding: 16px 18px;
         box-shadow: 0 10px 30px rgba(0,0,0,.2); animation: up .25s cubic-bezier(.2,.9,.3,1); }
  @keyframes up { from { transform: translateY(20px); opacity: 0; } }
  @keyframes fade { from { opacity: 0; } }
  .eyebrow { margin: 0; color: var(--accent); font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; }
  h3 { margin: 2px 0 4px; font-size: 18px; }
  .muted { color: var(--muted); font-size: 14px; margin: 0; }
  .actions { display: grid; grid-template-columns: 1fr 1.6fr; gap: 10px; margin-top: 12px; }
</style>
