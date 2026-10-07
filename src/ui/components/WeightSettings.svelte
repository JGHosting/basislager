<script lang="ts">
  import { getSetting } from '../../core/db';
  import { fmtDay } from '../../core/dates';
  import { setWeightSince } from '../../domain/morning/morning';
  let since = $state(''), editing = $state(false), value = $state(''), msg = $state('');
  getSetting<string>('weightSince').then(d => (since = d ?? ''));
  async function save() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    await setWeightSince(value); since = value; editing = false; msg = 'Gespeichert. Ältere Garmin-Gewichte werden ignoriert.';
  }
</script>

<section class="card list">
  {#if !editing}
    <div><span>Garmin-Gewicht übernehmen ab</span><b>{since ? fmtDay(since, { day: '2-digit', month: '2-digit', year: 'numeric' }) : '–'}</b></div>
    <button class="rowbtn" onclick={() => { value = since; editing = true; msg = ''; }}><span>Stichtag ändern</span><b>Ändern</b></button>
  {:else}
    <label>Ab diesem Tag übernehmen<input type="date" bind:value /></label>
    <div class="actions"><button class="btn primary" onclick={save}>Speichern</button><button class="btn ghost" onclick={() => (editing = false)}>Abbrechen</button></div>
  {/if}
</section>
<p class="muted hint">{msg || 'Ältere Gewichte aus Garmin werden ignoriert. Selbst eingetragene Werte bleiben immer erhalten. Ein früherer Stichtag holt alte Werte beim nächsten „Historie komplett neu laden“ zurück.'}</p>

<style>
  .list { padding: 4px 20px 8px; }
  .list > div { display: flex; justify-content: space-between; padding: 12px 0; font-size: 15px; gap: 10px; }
  .list span { color: var(--muted); }
  .rowbtn { display: flex; justify-content: space-between; width: 100%; background: none; border: none; border-top: 1px solid var(--line);
            padding: 14px 0; color: var(--text); font-size: 15px; min-height: 48px; cursor: pointer; }
  .rowbtn b { color: var(--accent); }
  .actions { display: flex; gap: 10px; margin: 14px 0 8px; }
  .actions .btn { flex: 1; }
  .hint { font-size: 13px; margin: 8px 4px 0; }
</style>
