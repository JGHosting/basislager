<script lang="ts">
  /** Tageszeit für Mobility: vorher keine Erinnerung (Punkt, Hinweis, Sperre). Starten geht jederzeit. */
  import { liveQuery } from 'dexie';
  import { getMobilitySettings, saveMobilitySettings } from '../../domain/mobility/settings';
  import { recheckMobility } from '../app.svelte';

  const settings = liveQuery(() => getMobilitySettings());
  const PRESETS = [{ t: '07:00', label: 'Morgens' }, { t: '12:00', label: 'Mittags' }, { t: '18:00', label: 'Abends' }];
  async function set(t: string) {
    if (!/^\d{2}:\d{2}$/.test(t)) return;
    await saveMobilitySettings({ time: t });
    void recheckMobility();
  }
</script>

<section class="card">
  {#if $settings}
    <div class="seg" role="radiogroup" aria-label="Tageszeit für Mobility">
      {#each PRESETS as p}<button role="radio" aria-checked={$settings.time === p.t} class:on={$settings.time === p.t} onclick={() => set(p.t)}>{p.label}</button>{/each}
    </div>
    <label class="row">Ab<input type="time" value={$settings.time} onchange={e => set((e.currentTarget as HTMLInputElement).value)} /> Uhr</label>
    <p class="muted small">Erinnerungen und Sperre kommen erst ab dieser Uhrzeit. Starten kannst du die Routine jederzeit im Mobility-Tab.</p>
  {/if}
</section>

<style>
  .seg { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; background: var(--bg); border-radius: 12px; padding: 4px; }
  .seg button { border: none; background: none; font: inherit; font-size: 15px; font-weight: 600; color: var(--muted); padding: 9px 0; border-radius: 9px; cursor: pointer; }
  .seg button.on { background: var(--accent); color: #fff; }
  .row { display: flex; align-items: center; gap: 10px; margin: 12px 0 4px; font-size: 15px; }
  .row input { width: auto; margin: 0; font-weight: 650; }
</style>
