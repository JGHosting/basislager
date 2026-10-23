<script lang="ts">
  import { startMobilityNow, skipMobilityToday } from '../app.svelte';
  let confirmSkip = $state(false);
</script>

<div class="lock" role="dialog" aria-modal="true" aria-label="Mobility-Sperre">
  <p class="eyebrow">Mobility · Stufe „Brutal“</p>
  <h2>Erst die Routine, dann der Rest</h2>
  <p class="muted">Die App ist gesperrt, bis die heutige Mobility-Routine erledigt ist.</p>
  {#if !confirmSkip}
    <button class="btn primary wide" onclick={startMobilityNow}>Routine starten</button>
    <button class="btn ghost wide" onclick={() => (confirmSkip = true)}>Heute aussetzen</button>
  {:else}
    <p class="warn">Aussetzen kostet deine Streak. Sicher?</p>
    <div class="row">
      <button class="btn ghost" onclick={() => (confirmSkip = false)}>Abbrechen</button>
      <button class="btn primary" onclick={skipMobilityToday}>Trotzdem aussetzen</button>
    </div>
  {/if}
</div>

<style>
  .lock { position: fixed; inset: 0; z-index: 26; background: var(--bg); display: flex; flex-direction: column;
          justify-content: center; align-items: center; text-align: center; padding: 24px calc(env(safe-area-inset-top) + 24px); gap: 6px; }
  .eyebrow { margin: 0; color: var(--accent); font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; }
  h2 { margin: 2px 0 6px; font-size: 24px; letter-spacing: -0.02em; max-width: 320px; }
  .muted { color: var(--muted); margin: 0 0 20px; max-width: 320px; }
  .wide { width: 100%; max-width: 320px; margin-top: 10px; }
  .warn { color: var(--red); font-weight: 600; margin: 10px 0; }
  .row { display: flex; gap: 10px; max-width: 320px; width: 100%; }
  .row .btn { flex: 1; }
</style>
