<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db, getSetting, setSetting } from '../../core/db';
  import { setActiveSplit } from '../../domain/strength/repo';
  import { groupLabel } from '../../domain/strength/strength';
  const q = liveQuery(async () => ({ splits: await db.splits.toArray(), active: (await getSetting<string | null>('activeSplit')) ?? null, goal: (await getSetting<number | null>('goalWeight')) ?? null }));
  let goalInput = $state(''), goalErr = $state(''), goalEdit = $state(false);
  async function saveGoal() {
    const s = goalInput.trim().replace(',', '.');
    const n = s ? Number(s) : null;
    if (n != null && !(n >= 30 && n <= 250)) { goalErr = 'Bitte zwischen 30 und 250 kg.'; return; }
    await setSetting('goalWeight', n == null ? null : Math.round(n * 10) / 10); goalEdit = false; goalErr = '';
  }
</script>

{#if $q}
  <section class="card list">
    {#each [{ id: null, name: 'Kein fester Split', days: [] }, ...$q.splits] as sp}
      <button class="opt" class:on={$q.active === sp.id} onclick={() => setActiveSplit(sp.id)}>
        <span class="radio"></span>
        <span><b>{sp.name}</b>{#if sp.days.length}<small>{sp.days.map((d, i) => `Tag ${i + 1}: ${d.map(groupLabel).join(' + ')}`).join(' · ')}</small>{/if}</span>
      </button>
    {/each}
  </section>
  <p class="muted hint">Mit Split schlägt die App nach jedem Krafttraining den nächsten Tag vor. Ein Tipp genügt.</p>

  <h3 class="section">Körper</h3>
  <section class="card list">
    {#if !goalEdit}
      <button class="opt" onclick={() => { goalInput = $q.goal != null ? String($q.goal).replace('.', ',') : ''; goalEdit = true; }}>
        <span><b>Zielgewicht</b><small>optional, erscheint als Linie in der Statistik</small></span>
        <span class="val">{$q.goal != null ? String($q.goal).replace('.', ',') + ' kg' : 'kein Ziel'}</span>
      </button>
    {:else}
      <label>Zielgewicht in kg (leer = kein Ziel)<input bind:value={goalInput} inputmode="decimal" placeholder="z. B. 76,5" /></label>
      {#if goalErr}<p class="error">{goalErr}</p>{/if}
      <div class="actions"><button class="btn primary" onclick={saveGoal}>Speichern</button><button class="btn ghost" onclick={() => (goalEdit = false)}>Abbrechen</button></div>
    {/if}
  </section>
{/if}

<style>
  .list { padding: 4px 16px; }
  .opt { width: 100%; display: flex; gap: 12px; align-items: center; text-align: left; background: none; border: none; border-top: 1px solid var(--line);
         padding: 12px 0; font: inherit; color: var(--text); cursor: pointer; min-height: 52px; }
  .opt:first-child { border-top: none; }
  .opt span:not(.radio):not(.val) { display: flex; flex-direction: column; gap: 2px; flex: 1; }
  .opt small { font-size: 12px; color: var(--muted); }
  .radio { width: 20px; height: 20px; border-radius: 50%; border: 2px solid var(--line); flex-shrink: 0; }
  .opt.on .radio { border: 6px solid var(--accent); }
  .val { color: var(--accent); font-weight: 600; white-space: nowrap; }
  .hint { font-size: 13px; margin: 8px 4px 0; }
  .section { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); font-weight: 600; margin: 22px 4px 8px; }
  .actions { display: flex; gap: 10px; margin: 14px 0 10px; } .actions .btn { flex: 1; }
  label { margin-top: 12px; }
</style>
