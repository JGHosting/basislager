<script lang="ts">
  import { liveQuery } from 'dexie';
  import { pendingIndoor, saveIndoor, KIND_HINT, type IndoorAsk } from '../../domain/indoor/indoor';
  import { fmtDay } from '../../core/dates';
  import { dur } from '../format';

  const asks = liveQuery(() => pendingIndoor());
  let kmh = $state<Record<string, string>>({});
  let dist = $state<Record<string, string>>({});
  let err = $state<Record<string, string>>({});
  let busy = $state(false);

  const parse = (v: string | undefined) => {
    const t = (v ?? '').trim().replace(',', '.');
    return t ? Number(t) : null;
  };
  const day = (a: IndoorAsk) => fmtDay(a.activity.date, { weekday: 'long' });
  const askSpeed = (a: IndoorAsk) => a.type === 'lauf' && a.kind !== 'berg';

  async function save(a: IndoorAsk) {
    const id = a.activity.id;
    const s = askSpeed(a) ? parse(kmh[id]) : null;
    const d = parse(dist[id]) ?? (a.type === 'rad' && a.activity.distance ? a.activity.distance / 1000 : null);
    if (askSpeed(a) && (s == null || !(s >= 6 && s <= 30))) { err[id] = 'Bitte ein Tempo zwischen 6 und 30 km/h eingeben.'; return; }
    const maxKm = a.type === 'rad' ? 300 : 60;
    if (d != null && !(d > 0 && d <= maxKm)) { err[id] = `Bitte eine Strecke bis ${maxKm} km eingeben.`; return; }
    if (a.type === 'rad' && d == null) { err[id] = 'Bitte die Strecke eingeben.'; return; }
    busy = true;
    try { await saveIndoor(a, d, s); } finally { busy = false; }
  }
  async function skip(a: IndoorAsk) {
    busy = true;
    try { await saveIndoor(a, null, null); } finally { busy = false; }
  }
</script>

{#each $asks ?? [] as a (a.activity.id)}
  <section class="card ip">
    {#if a.type === 'lauf'}
      <h2>Laufband: wie schnell?</h2>
      <p class="muted">{a.title} am {day(a)} · {dur(a.activity.duration)}</p>
      {#if askSpeed(a)}
        <label><span>Tempo {KIND_HINT[a.kind ?? 'intervall']}</span>
          <span class="in"><input inputmode="decimal" placeholder="z. B. 13,5" bind:value={kmh[a.activity.id]} /><em>km/h</em></span></label>
      {/if}
      <label><span>Gesamtstrecke (optional)</span>
        <span class="in"><input inputmode="decimal" placeholder="km" bind:value={dist[a.activity.id]} /><em>km</em></span></label>
    {:else}
      <h2>Indoor-Rad: wie weit?</h2>
      <p class="muted">Am {day(a)} · {dur(a.activity.duration)}</p>
      <label><span>Strecke</span>
        <span class="in"><input inputmode="decimal" placeholder={a.activity.distance ? (a.activity.distance / 1000).toFixed(1).replace('.', ',') : 'km'} bind:value={dist[a.activity.id]} /><em>km</em></span></label>
    {/if}
    {#if err[a.activity.id]}<p class="err">{err[a.activity.id]}</p>{/if}
    <div class="acts">
      <button class="btn primary" disabled={busy} onclick={() => save(a)}>Speichern</button>
      <button class="btn" disabled={busy} onclick={() => skip(a)}>Überspringen</button>
    </div>
  </section>
{/each}

<style>
  .ip h2 { font-size: 16px; margin: 0 0 4px; }
  .ip p { margin: 0 0 10px; font-size: 14px; }
  label { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 6px 0; font-size: 14px; }
  .in { display: flex; align-items: center; gap: 6px; }
  .in input { width: 84px; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--line); background: var(--card); color: var(--text); font: inherit; font-size: 16px; text-align: right; }
  .in em { font-style: normal; color: var(--muted); font-size: 13px; min-width: 34px; }
  .err { color: var(--bad, #e5484d); }
  .acts { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px; }
</style>
