<script lang="ts">
  import { onMount } from 'svelte';
  import { getFuelSettings, saveFuelSettings, getLoc, setLoc, type FuelSettings } from '../../domain/nutrition/fueling';
  import { pushPlan } from '../../domain/planner/garmin';
  let st = $state<FuelSettings | null>(null);
  let hasLoc = $state(false);
  onMount(async () => { st = await getFuelSettings(); hasLoc = !!(await getLoc()); });
  async function set<K extends keyof FuelSettings>(k: K, v: FuelSettings[K]) {
    if (!st) return;
    st = { ...st, [k]: v };
    await saveFuelSettings(st);
    pushPlan().catch(() => {});
  }
  type Opt<T> = { v: T; l: string }[];
  const rows: { k: 'gut' | 'salt' | 'style'; label: string; opts: Opt<string> }[] = [
    { k: 'gut', label: 'Magen an Verpflegung gewöhnt?', opts: [{ v: 'neu', l: 'Kaum' }, { v: 'manchmal', l: 'Manchmal' }, { v: 'trainiert', l: 'Trainiert' }] },
    { k: 'salt', label: 'Schwitzt du salzig?', opts: [{ v: 'kaum', l: 'Kaum' }, { v: 'normal', l: 'Normal' }, { v: 'salzig', l: 'Weiße Ränder' }] },
    { k: 'style', label: 'Was isst du lieber?', opts: [{ v: 'mix', l: 'Gemischt' }, { v: 'echt', l: 'Echtes Essen' }, { v: 'gels', l: 'Gels' }] }
  ];
  const toggles: { k: 'noGluten' | 'noDairy' | 'noCaffeine' | 'watch'; l: string }[] = [
    { k: 'noGluten', l: 'Ohne Gluten' }, { k: 'noDairy', l: 'Ohne Milchprodukte' }, { k: 'noCaffeine', l: 'Ohne Koffein' }, { k: 'watch', l: 'Essenszeiten auf die Garmin-Uhr' }
  ];
</script>

{#if st}
  <section class="card list">
    {#each rows as r}
      <div class="row col">
        <span>{r.label}</span>
        <div class="modes">
          {#each r.opts as o}<button class:on={st[r.k] === o.v} onclick={() => set(r.k, o.v as never)}>{o.l}</button>{/each}
        </div>
      </div>
    {/each}
    {#each toggles as t}
      <label class="row"><span>{t.l}</span><input type="checkbox" checked={st[t.k]} onchange={e => set(t.k, (e.currentTarget as HTMLInputElement).checked)} /></label>
    {/each}
    {#if hasLoc}<div class="row"><span>Standort fürs Wetter gespeichert</span><button class="lnk" onclick={async () => { await setLoc(null); hasLoc = false; }}>Entfernen</button></div>{/if}
  </section>
  <p class="muted hint">Ab 75 min zeigt jede Ausdauereinheit im Plan „Verpflegung“: vorher, unterwegs (mit Zeitplan) und danach. Locker (Z2) bis 2 h braucht es nichts außer Wasser. Allgemeine Richtwerte, keine Ernährungsberatung.</p>
{/if}

<style>
  .list { padding: 6px 20px; }
  .row { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 12px 0; border-top: 1px solid var(--line); }
  .row.col { flex-direction: column; align-items: flex-start; gap: 8px; }
  .row:first-child { border-top: none; }
  .row > span { color: var(--muted); font-size: 15px; }
  .modes { display: flex; gap: 6px; flex-wrap: wrap; }
  .modes button { border: 1px solid var(--line); background: var(--card); color: var(--text); border-radius: 10px; padding: 6px 10px; font: inherit; font-size: 13px; cursor: pointer; }
  .modes button.on { border-color: var(--accent); color: var(--accent); font-weight: 600; }
  input[type=checkbox] { width: 22px; height: 22px; accent-color: var(--accent); }
  .lnk { background: none; border: none; color: var(--accent); font: inherit; font-size: 14px; cursor: pointer; }
  .hint { font-size: 13px; margin: 8px 4px 0; }
</style>
