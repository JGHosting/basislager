<script lang="ts">
  import { liveQuery } from 'dexie';
  import { setSetting } from '../../core/db';
  import { computeToday } from '../../domain/today';
  import { zoneBpm } from '../../domain/load/zones';
  const calc = liveQuery(() => computeToday());
  let editing = $state(false), max = $state(''), rest = $state(''), err = $state('');
  const src = (s: string) => (s === 'manual' ? 'eigener Wert' : s === 'auto' ? 'automatisch' : 'Standardwert');

  function start() {
    if (!$calc) return;
    max = $calc.hr.maxSource === 'manual' ? String($calc.hr.max) : '';
    rest = $calc.hr.restSource === 'manual' ? String($calc.hr.rest) : '';
    editing = true; err = '';
  }
  async function save() {
    const m = max.trim() ? Number(max) : null, r = rest.trim() ? Number(rest) : null;
    if (m != null && !(m >= 140 && m <= 230)) { err = 'Maximalpuls zwischen 140 und 230.'; return; }
    if (r != null && !(r >= 30 && r <= 100)) { err = 'Ruhepuls zwischen 30 und 100.'; return; }
    await setSetting('hrMax', m); await setSetting('hrRest', r);
    editing = false;
  }
</script>

<section class="card list">
  {#if $calc}
    {#if !editing}
      <div><span>Maximalpuls</span><b>{$calc.hr.max} bpm <small>{src($calc.hr.maxSource)}</small></b></div>
      <div><span>Ruhepuls</span><b>{$calc.hr.rest} bpm <small>{src($calc.hr.restSource)}</small></b></div>
      <button class="rowbtn" onclick={start}><span>Werte anpassen</span><b>Ändern</b></button>
    {:else}
      <label>Maximalpuls (leer = automatisch, aktuell {$calc.hr.max})<input bind:value={max} inputmode="numeric" placeholder="automatisch" /></label>
      <label>Ruhepuls (leer = automatisch, aktuell {$calc.hr.rest})<input bind:value={rest} inputmode="numeric" placeholder="automatisch" /></label>
      {#if err}<p class="error">{err}</p>{/if}
      <div class="actions"><button class="btn primary" onclick={save}>Speichern</button><button class="btn ghost" onclick={() => (editing = false)}>Abbrechen</button></div>
    {/if}
  {/if}
</section>
{#if $calc && !editing}
  <section class="card zones">
    <b>Pulszonen</b> <span class="muted small">(% vom Maximalpuls {$calc.hr.max} bpm)</span>
    {#each zoneBpm($calc.hr.max) as z}
      <div class="zr"><span>Z{z.id} {z.label}</span><span class="muted">{z.id === 0 ? `< ${Math.round(z.to * 100)} %` : `${Math.round(z.from * 100)}–${Math.round(z.to * 100)} %`}</span><b>{z.id === 0 ? `< ${z.hi}` : `${z.lo}–${z.hi}`} bpm</b></div>
    {/each}
  </section>
{/if}
<p class="muted hint">Automatisch: Maximalpuls = zweithöchster Wert deiner Aktivitäten der letzten 2 Jahre, Ruhepuls = Median der letzten 30 Morgenwerte. Beides fließt in die Belastungsrechnung ein.</p>

<style>
  .list { padding: 4px 20px 8px; }
  .list > div { display: flex; justify-content: space-between; padding: 12px 0; border-top: 1px solid var(--line); font-size: 15px; }
  .list > div:first-child { border-top: none; }
  .list span { color: var(--muted); }
  small { color: var(--muted); font-weight: 400; font-size: 12px; margin-left: 4px; }
  .rowbtn { display: flex; justify-content: space-between; width: 100%; background: none; border: none; border-top: 1px solid var(--line);
            padding: 14px 0; color: var(--text); font-size: 15px; min-height: 48px; cursor: pointer; }
  .rowbtn b { color: var(--accent); }
  .actions { display: flex; gap: 10px; margin: 14px 0 8px; }
  .actions .btn { flex: 1; }
  .hint { font-size: 13px; margin: 8px 4px 0; }
  .zones { margin-top: 10px; padding: 12px 20px; } .zones .small { font-size: 12px; }
  .zr { display: grid; grid-template-columns: 1fr auto 96px; gap: 8px; padding: 7px 0; border-top: 1px solid var(--line); font-size: 14px; font-variant-numeric: tabular-nums; }
  .zr:first-of-type { margin-top: 8px; } .zr b { text-align: right; font-weight: 600; }
</style>
