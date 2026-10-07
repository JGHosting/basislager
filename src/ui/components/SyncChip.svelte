<script lang="ts">
  import { app, sync } from '../app.svelte';
  import { fmtAgo } from '../../core/dates';
  let tick = $state(0);
  $effect(() => { const t = setInterval(() => tick++, 30000); return () => clearInterval(t); });
  const text = $derived.by(() => {
    tick;
    if (app.syncing) return app.syncLabel || 'Synchronisiere …';
    if (app.syncError) return 'Sync fehlgeschlagen';
    if (app.syncState.lastSyncAt) return 'Aktualisiert ' + fmtAgo(app.syncState.lastSyncAt);
    return 'Noch nicht synchronisiert';
  });
</script>

{#if app.connected}
  <button class="chip" class:err={!!app.syncError} onclick={() => sync(true)} disabled={app.syncing} title="Jetzt synchronisieren">
    <svg class:spin={app.syncing} viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66 M20 4v4h-4" /></svg>
    {text}
  </button>
{/if}

<style>
  .chip { display: inline-flex; align-items: center; gap: 6px; border: none; background: var(--card);
          color: var(--muted); font-size: 13px; font-weight: 500; padding: 7px 12px; border-radius: 99px; min-height: 32px; }
  .chip.err { color: var(--red); }
  svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; }
  .spin { animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
