<script lang="ts">
  import { onMount } from 'svelte';
  import { getWarmupSettings, saveWarmupSettings, WARMUP_LABEL, WARMUP_MODE_LABEL, type WarmupSettings, type WarmupCategory, type WarmupMode } from '../../domain/planner/warmup';
  let settings = $state<WarmupSettings | null>(null);
  onMount(async () => { settings = await getWarmupSettings(); });
  async function set(cat: WarmupCategory, mode: WarmupMode) {
    if (!settings) return;
    settings = { ...settings, [cat]: mode };
    await saveWarmupSettings(settings);
  }
  const cats: WarmupCategory[] = ['kraft', 'lauf', 'rad', 'schwimmen'];
  const modes: WarmupMode[] = ['aus', 'auto', 'immer'];
</script>

{#if settings}
  <section class="card list">
    {#each cats as cat}
      <div class="row">
        <span>{WARMUP_LABEL[cat]}</span>
        <div class="modes">
          {#each modes as mode}
            <button class:on={settings[cat] === mode} onclick={() => set(cat, mode)}>{WARMUP_MODE_LABEL[mode]}</button>
          {/each}
        </div>
      </div>
    {/each}
  </section>
  <p class="muted hint">Auto: kurzes Aufwärmen (3–5 min) nur vor Kraft und vor nicht-lockeren Einheiten (Intervalle, Schwelle, hart/mittel). Lockere Ausdauereinheiten bleiben ohne. Lässt sich pro Einheit im Plan überschreiben.</p>
{/if}

<style>
  .list { padding: 6px 20px; }
  .row { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 12px 0; border-top: 1px solid var(--line); }
  .row:first-child { border-top: none; }
  .row > span { color: var(--muted); font-size: 15px; }
  .modes { display: flex; gap: 6px; }
  .modes button { border: 1px solid var(--line); background: var(--card); color: var(--text); border-radius: 10px; padding: 6px 9px; font: inherit; font-size: 12px; cursor: pointer; }
  .modes button.on { border-color: var(--accent); color: var(--accent); font-weight: 600; }
  .hint { font-size: 13px; margin: 8px 4px 0; }
</style>
