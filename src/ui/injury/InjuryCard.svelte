<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db, type Injury } from '../../core/db';
  import { today, addDays, fmtDay } from '../../core/dates';
  import { STAGES, LAST_STAGE, MOVEMENTS, STATUS_LABEL, daysSince, doctorHint, advanceCheck } from '../../domain/injury/injury';
  import { setStage } from '../../domain/injury/repo';
  import { openInjury } from '../app.svelte';

  let { injury }: { injury: Injury } = $props();
  const t = today();
  const morning = liveQuery(() => db.morning.where('date').between(addDays(t, -60), t, true, true).toArray());
  const pains = $derived(($morning ?? []).filter(m => m.date >= addDays(t, -13) && m.pain != null));
  const hint = $derived($morning ? doctorHint(injury, $morning, t) : null);
  let warn = $state<string | null>(null);

  function next() {
    const w = $morning ? advanceCheck(injury, $morning, t) : null;
    if (w && warn !== w) { warn = w; return; }     // erster Tipp zeigt den Hinweis, zweiter gibt frei
    warn = null; setStage(injury.id, injury.stage + 1);
  }
  const days = $derived(daysSince(injury.startDate, t));
</script>

<section class="card inj">
  <div class="head">
    <div>
      <span class="kicker">Verletzungsmodus</span>
      <h2>{injury.region}{injury.side !== 'keine' ? ` ${injury.side === 'beidseitig' ? 'beidseitig' : injury.side}` : ''}</h2>
      <p class="muted small">seit {fmtDay(injury.startDate, { day: 'numeric', month: 'long' })} · Tag {days + 1} · {injury.severity}</p>
    </div>
    <button class="edit" onclick={() => openInjury({ id: injury.id })}>Bearbeiten</button>
  </div>

  <div class="stages" aria-label="Rückkehrstufen">
    {#each STAGES as s, i}<span class:done={i < injury.stage} class:cur={i === injury.stage} title={s.label}></span>{/each}
  </div>
  <p class="stage"><b>Stufe {injury.stage + 1}/{STAGES.length}: {STAGES[injury.stage].label}</b><br /><span class="muted">{STAGES[injury.stage].hint}</span></p>

  <p class="legend muted">✓ geht · ~ eingeschränkt · ✕ geht nicht</p>
  <div class="moves">
    {#each MOVEMENTS as m}<span class="mv {injury.movement[m.id]}" title={STATUS_LABEL[injury.movement[m.id]]}><i>{injury.movement[m.id] === 'geht' ? '✓' : injury.movement[m.id] === 'eingeschraenkt' ? '~' : '✕'}</i>{m.label}</span>{/each}
  </div>

  {#if pains.length}
    <div class="pain">
      <span class="muted small">Schmerz 14 Tage</span>
      <div class="pbars">
        {#each Array.from({ length: 14 }, (_, i) => addDays(t, i - 13)) as d}
          {@const p = pains.find(x => x.date === d)?.pain}
          <span title="{fmtDay(d)}: {p ?? '–'}" class:none={p == null} style="height: {p == null ? 4 : 4 + p * 3.2}px; background: {p == null ? 'var(--line)' : p >= 7 ? 'var(--red)' : p >= 4 ? 'var(--yellow)' : 'var(--green)'}"></span>
        {/each}
      </div>
    </div>
  {/if}

  {#if hint}<p class="doc">{hint}</p>{/if}
  {#if warn}<p class="warnmsg">{warn} <b>Tippe nochmal, um trotzdem freizugeben.</b></p>{/if}

  <div class="actions">
    <button class="btn ghost" disabled={injury.stage === 0} onclick={() => { warn = null; setStage(injury.id, injury.stage - 1); }}>Zurück</button>
    <button class="btn primary" onclick={next}>{injury.stage === LAST_STAGE - 1 ? 'Abschließen' : 'Nächste Stufe'}</button>
  </div>
</section>

<style>
  .inj { border: 2px solid var(--red); }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
  .kicker { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--red); font-weight: 700; }
  h2 { margin: 2px 0 0; }
  .small { font-size: 13px; margin: 2px 0 0; }
  .edit { background: none; border: none; color: var(--accent); font: inherit; font-weight: 600; font-size: 14px; cursor: pointer; padding: 4px 0; }
  .stages { display: grid; grid-template-columns: repeat(8, 1fr); gap: 4px; margin: 14px 0 8px; }
  .stages span { height: 6px; border-radius: 3px; background: var(--line); }
  .stages span.done { background: var(--green); }
  .stages span.cur { background: var(--accent); }
  .stage { font-size: 14px; margin: 0 0 10px; line-height: 1.4; }
  .moves { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
  .mv { display: flex; align-items: center; gap: 8px; font-size: 14px; background: var(--bg); border-radius: 10px; padding: 7px 10px; }
  .mv i { font-style: normal; font-weight: 800; width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; font-size: 12px; color: #fff; flex-shrink: 0; }
  .mv.geht i { background: var(--green); } .mv.eingeschraenkt i { background: var(--yellow); } .mv.nicht i { background: var(--red); }
  .mv.nicht { color: var(--muted); text-decoration: line-through; }
  .legend { font-size: 12px; margin: 0 0 6px; }
  .pain { margin-top: 12px; }
  .pbars { display: grid; grid-template-columns: repeat(14, 1fr); gap: 3px; align-items: end; height: 40px; margin-top: 4px; }
  .pbars span { border-radius: 3px; }
  .doc { background: color-mix(in srgb, var(--red) 14%, transparent); border-radius: 12px; padding: 10px 12px; font-size: 14px; margin: 12px 0 0; }
  .warnmsg { background: var(--accent-soft); border-radius: 12px; padding: 10px 12px; font-size: 14px; margin: 12px 0 0; }
  .actions { display: grid; grid-template-columns: 1fr 1.4fr; gap: 10px; margin-top: 14px; }
</style>
