<script lang="ts">
  import { liveQuery } from 'dexie';
  import { today, addDays, fmtDay } from '../../core/dates';
  import { dayView, recentDays, setTracked, getKcalGoal, setKcalGoal } from '../../domain/nutrition/repo';
  import { MEALS, scale, fmtG, unitLabel } from '../../domain/nutrition/calc';
  import { openFood } from '../app.svelte';
  import KcalBar from '../nutrition/KcalBar.svelte';
  import MacroLine from '../nutrition/MacroLine.svelte';
  import type { Meal } from '../../core/db';

  let date = $state(today());
  const t = today();
  // Neu berechnen, wenn sich Datum oder Daten ändern
  const view = $derived(liveQuery(() => dayView(date)));
  const goalQ = liveQuery(() => getKcalGoal());
  const history = liveQuery(() => recentDays(7, today()));

  let open = $state<Record<Meal, boolean>>({ fruehstueck: true, mittag: true, abend: true, snack: true });
  let goalEdit = $state(false), goalInput = $state(''), goalErr = $state('');
  async function saveGoal() {
    const n = Math.round(Number(goalInput.replace(/\./g, '').replace(',', '.')));
    if (!(n >= 800 && n <= 8000)) { goalErr = 'Bitte ein Ziel zwischen 800 und 8000 kcal.'; return; }
    await setKcalGoal(n); goalEdit = false; goalErr = '';
  }
  const kcal = (v: number) => Math.round(v).toLocaleString('de-DE');
</script>

<header class="page-head">
  <div><p class="eyebrow">{date === t ? 'Heute' : fmtDay(date, { weekday: 'long' })}</p><h1>Ernährung</h1></div>
  <div class="datenav">
    <button aria-label="Vorheriger Tag" onclick={() => (date = addDays(date, -1))}>‹</button>
    <button class="d" onclick={() => (date = t)}>{date === t ? 'Heute' : fmtDay(date, { day: '2-digit', month: '2-digit' })}</button>
    <button aria-label="Nächster Tag" disabled={date >= t} onclick={() => (date = addDays(date, 1))}>›</button>
  </div>
</header>

{#if $view}
  {@const v = $view}
  {#if !v.tracked}
    <section class="card untracked">
      <h2>{date === t ? 'Heute wird nicht getrackt.' : 'Dieser Tag wurde nicht getrackt.'}</h2>
      <p class="muted">Die Ernährung dieses Tages fließt nicht in Auswertungen ein und zählt nicht als 0 kcal.
        {#if v.entries.length}Die {v.entries.length} Einträge bleiben gespeichert.{/if}</p>
      <button class="btn primary wide" onclick={() => setTracked(date, true)}>{date === t ? 'Tracking für heute aktivieren' : 'Tracking für diesen Tag aktivieren'}</button>
    </section>
  {:else}
    <section class="card summary">
      {#if $goalQ == null || goalEdit}
        <h2>{goalEdit ? 'Kalorienziel ändern' : 'Tägliches Kalorienziel festlegen'}</h2>
        <form class="goalform" onsubmit={e => { e.preventDefault(); saveGoal(); }}>
          <input bind:value={goalInput} inputmode="numeric" placeholder="z. B. 2200" /><span>kcal</span>
          <button class="btn primary">Speichern</button>
        </form>
        {#if goalErr}<p class="error small">{goalErr}</p>{/if}
        {#if goalEdit}<button class="link" onclick={() => (goalEdit = false)}>Abbrechen</button>{/if}
      {:else}
        {@const eaten = v.total.kcal.value}
        <div class="big">
          <span><b>{kcal(eaten)}</b> / <button class="goal" onclick={() => { goalInput = String($goalQ); goalEdit = true; }}>{kcal($goalQ)}</button> kcal</span>
          <span class="rest" class:over={eaten > $goalQ}>{eaten > $goalQ ? `${kcal(eaten - $goalQ)} kcal über dem Ziel` : `${kcal($goalQ - eaten)} kcal übrig`}</span>
        </div>
        <KcalBar {eaten} goal={$goalQ} />
        {#if v.total.kcal.known < v.total.kcal.total}<p class="warn small">{v.total.kcal.total - v.total.kcal.known} Einträge ohne Kalorienangabe sind nicht mitgezählt.</p>{/if}
        <div class="mac"><MacroLine sum={v.total} big /></div>
      {/if}
    </section>

    {#each MEALS as m}
      {@const meal = v.meals[m.id]}
      <section class="card meal">
        <button class="mhead" onclick={() => (open[m.id] = !open[m.id])} aria-expanded={open[m.id]}>
          <span class="mt"><b>{m.label}</b>{#if meal.entries.length}<MacroLine sum={meal.sum} />{/if}</span>
          <span class="mk">{meal.entries.length ? kcal(meal.sum.kcal.value) + ' kcal' : ''}<i class:rot={open[m.id]}>›</i></span>
        </button>
        {#if open[m.id]}
          {#if meal.entries.length}
            <ul class="entries">
              {#each meal.entries as e (e.id)}
                {@const n = scale(e.snapshot, e.grams)}
                <li><button onclick={() => openFood({ mode: 'edit', entry: e })}>
                  <span><b>{e.snapshot.name}</b><small>{fmtG(e.amount, 1)} {unitLabel(e.unit)}{e.unit !== 'g' && e.unit !== 'ml' ? ` (${fmtG(e.grams)} ${e.snapshot.per})` : ''}{e.snapshot.brand ? ' · ' + e.snapshot.brand : ''}</small></span>
                  <em>{n.kcal == null ? '–' : kcal(n.kcal)} kcal</em>
                </button></li>
              {/each}
            </ul>
          {/if}
          <button class="add" onclick={() => openFood({ mode: 'add', date, meal: m.id })}>+ Lebensmittel hinzufügen</button>
        {/if}
      </section>
    {/each}

    <button class="btn ghost wide" onclick={() => setTracked(date, false)}>{date === t ? 'Heute wird nicht getrackt' : 'Diesen Tag nicht tracken'}</button>
  {/if}
{/if}

{#if $history}
  <h3 class="section">Letzte Tage</h3>
  <section class="card hist">
    {#each $history as h (h.date)}
      <button class:cur={h.date === date} onclick={() => (date = h.date)}>
        <span>{h.date === t ? 'Heute' : fmtDay(h.date)}</span>
        <span class="hv {h.state === 'getrackt' ? '' : 'muted'}">
          {#if h.state === 'nicht getrackt'}nicht getrackt{:else if h.state === 'keine Einträge'}keine Einträge{:else}{kcal(h.kcal)}{#if $goalQ}{' / ' + kcal($goalQ)}{/if} kcal{/if}
        </span>
      </button>
    {/each}
  </section>
{/if}
<p class="attr">Lebensmitteldaten: BLS 4.0 (Max Rubner-Institut, CC BY 4.0) · Open Food Facts (ODbL). Details unter Mehr → Über & Lizenzen.</p>

<style>
  .datenav { display: flex; align-items: center; background: var(--card); border-radius: 99px; padding: 3px; }
  .datenav button { border: none; background: none; color: var(--text); font: inherit; font-size: 20px; width: 38px; height: 34px; border-radius: 99px; cursor: pointer; }
  .datenav button:disabled { opacity: .3; }
  .datenav .d { width: auto; padding: 0 8px; font-size: 14px; font-weight: 600; color: var(--accent); }
  .summary .big { display: flex; flex-direction: column; margin-bottom: 10px; }
  .summary .big b { font-size: 34px; font-weight: 750; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
  .summary .big > span:first-child { color: var(--muted); font-size: 17px; }
  .goal { background: none; border: none; font: inherit; color: var(--muted); text-decoration: underline dotted; padding: 0; cursor: pointer; }
  .rest { font-weight: 600; color: var(--green); margin-top: 2px; }
  .rest.over { color: var(--red); }
  .mac { margin-top: 14px; }
  .warn { color: var(--yellow); }
  .small { font-size: 13px; }
  .goalform { display: flex; gap: 8px; align-items: center; } .goalform input { margin: 0; flex: 1; font-size: 20px; font-weight: 650; }
  .goalform span { color: var(--muted); }
  .link { background: none; border: none; color: var(--accent); font: inherit; font-weight: 600; cursor: pointer; padding: 8px 0 0; }
  .untracked h2 { margin-bottom: 4px; }
  .meal { padding: 6px 16px; }
  .mhead { width: 100%; display: flex; justify-content: space-between; align-items: center; gap: 10px; background: none; border: none; font: inherit; color: var(--text);
           padding: 10px 0; text-align: left; cursor: pointer; min-height: 52px; }
  .mt { display: flex; flex-direction: column; gap: 3px; }
  .mt b { font-size: 17px; }
  .mk { display: flex; align-items: center; gap: 8px; font-weight: 650; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .mk i { font-style: normal; color: var(--muted); font-size: 20px; transition: transform .2s; }
  .mk i.rot { transform: rotate(90deg); }
  .entries { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line); }
  .entries li + li { border-top: 1px solid var(--line); }
  .entries button { width: 100%; display: flex; justify-content: space-between; align-items: center; gap: 10px; background: none; border: none; font: inherit; color: var(--text);
                    text-align: left; padding: 10px 0; cursor: pointer; }
  .entries span { display: flex; flex-direction: column; min-width: 0; }
  .entries b { font-weight: 500; font-size: 15px; }
  .entries small { font-size: 12px; color: var(--muted); }
  .entries em { font-style: normal; white-space: nowrap; font-variant-numeric: tabular-nums; color: var(--muted); font-size: 14px; }
  .add { width: 100%; background: none; border: none; border-top: 1px solid var(--line); color: var(--accent); font: inherit; font-weight: 600; padding: 12px 0; text-align: left; cursor: pointer; min-height: 46px; }
  .section { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); font-weight: 600; margin: 22px 4px 8px; }
  .hist { padding: 4px 16px; }
  .hist button { width: 100%; display: flex; justify-content: space-between; background: none; border: none; border-top: 1px solid var(--line); font: inherit; color: var(--text);
                 padding: 11px 0; font-size: 14px; cursor: pointer; font-variant-numeric: tabular-nums; }
  .hist button:first-child { border-top: none; }
  .hist button.cur span:first-child { color: var(--accent); font-weight: 600; }
  .attr { font-size: 11px; color: var(--muted); text-align: center; margin: 14px 8px; }
</style>
