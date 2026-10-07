<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db } from '../../core/db';
  import { today, fmtDay } from '../../core/dates';
  import { latestNight, lastWeight, saveWeight, parseKg, todaysPlan } from '../../domain/morning/morning';
  import { app, closeMorning } from '../app.svelte';
  import { num, hours, dur, km, sportName, sportColor } from '../format';
  import type { IcuEvent } from '../../sources/intervals/client';

  const t = today();
  // Aktualisiert sich live, falls der Sync die Nachtwerte erst nach dem Öffnen liefert
  const night = liveQuery(() => latestNight());
  const todayRow = liveQuery(() => db.morning.get(t));
  let prevWeight = $state<{ date: string; kg: number } | null>(null);
  let weight = $state('');
  let weightErr = $state('');
  let plan = $state<IcuEvent[] | null | undefined>(undefined);
  let saving = $state(false);
  let initialised = false;

  $effect(() => {
    lastWeight().then(w => (prevWeight = w));
    todaysPlan().then(p => (plan = p));
  });
  // Bereits eingetragenes Gewicht von heute ins Feld übernehmen
  $effect(() => {
    if (!initialised && $todayRow !== undefined) {
      initialised = true;
      if ($todayRow?.weight != null) weight = String($todayRow.weight).replace('.', ',');
    }
  });

  const isToday = $derived($night?.entry.date === t);
  function delta(v: number | null, a: number | null) {
    if (v == null || a == null || a === 0) return null;
    return Math.round(((v - a) / a) * 100);
  }

  async function done() {
    const kg = parseKg(weight);
    if (Number.isNaN(kg)) { weightErr = 'Bitte ein Gewicht zwischen 30 und 250 kg eingeben.'; return; }
    saving = true;
    const had = $todayRow?.weight ?? null;
    if (kg !== had && !(kg == null && had == null)) await saveWeight(t, kg);
    saving = false;
    closeMorning(true);
  }

  const planned = $derived((plan ?? []).filter(e => e.category === 'WORKOUT' || e.category.startsWith('RACE')));
  const notes = $derived((plan ?? []).filter(e => !(e.category === 'WORKOUT' || e.category.startsWith('RACE'))));
  const hour = new Date().getHours();
  const greet = hour < 11 ? 'Guten Morgen' : hour < 17 ? 'Hallo' : 'Guten Abend';
</script>

<div class="backdrop" role="presentation" onclick={() => closeMorning(false)}></div>
<div class="sheet" role="dialog" aria-modal="true" aria-label="Morgenübersicht">
  <div class="grab"></div>
  <p class="eyebrow">{fmtDay(t, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
  <h2 class="title">{greet}{app.athleteName ? `, ${app.athleteName}` : ''}</h2>

  <section>
    <h3>{isToday || !$night ? 'Letzte Nacht' : `Letzte Werte vom ${fmtDay($night.entry.date)}`}</h3>
    {#if !$night}
      <p class="muted">{app.syncing ? 'Werte werden geladen …' : 'Noch keine Nachtwerte vorhanden.'}</p>
    {:else}
      {#if !isToday}<p class="hint">Für heute ist noch nichts da. Öffne kurz Garmin Connect, dann kommen die Werte nach.</p>{/if}
      <div class="grid">
        {#each [
          { l: 'HRV', v: $night.entry.hrv, a: $night.avg.hrv, show: num($night.entry.hrv), u: 'ms', good: 1 },
          { l: 'Sleep Score', v: $night.entry.sleepScore, a: $night.avg.sleepScore, show: num($night.entry.sleepScore), u: '', good: 1 },
          { l: 'Schlaf', v: $night.entry.sleepSecs, a: $night.avg.sleepSecs, show: hours($night.entry.sleepSecs).replace(' h', ''), u: 'h', good: 1 },
          { l: 'Ruhepuls', v: $night.entry.restingHr, a: $night.avg.restingHr, show: num($night.entry.restingHr), u: 'bpm', good: -1 }
        ] as m}
          {@const d = delta(m.v, m.a)}
          <div class="tile">
            <span class="l">{m.l}</span>
            <span class="v">{m.show}<small>{m.v != null ? m.u : ''}</small></span>
            <span class="d" class:up={d != null && d * m.good > 0} class:down={d != null && d * m.good < 0}>
              {d == null ? ' ' : `${d > 0 ? '+' : ''}${d} % zu Ø 7 T`}
            </span>
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <section>
    <h3>Heute auf dem Plan</h3>
    {#if plan === undefined}
      <p class="muted">Lade …</p>
    {:else if plan === null}
      <p class="muted">Offline, Plan nicht verfügbar.</p>
    {:else if planned.length === 0}
      <p class="muted">Nichts geplant{notes.length ? '' : ', freier Tag'}.</p>
    {/if}
    {#each planned as e}
      <div class="plan">
        <span class="dot" style="background: {sportColor(e.type ?? '')}"></span>
        <div>
          <b>{e.name || sportName(e.type ?? 'Training')}</b>
          <span class="muted">{[e.type ? sportName(e.type) : '', e.moving_time ? dur(e.moving_time) : '', km(e.distance)].filter(Boolean).join(' · ')}</span>
        </div>
      </div>
    {/each}
    {#each notes as e}<p class="note">{e.name}</p>{/each}
  </section>

  <section>
    <label for="w"><h3>Gewicht <span class="muted opt">optional</span></h3></label>
    <div class="weight">
      <input id="w" bind:value={weight} oninput={() => (weightErr = '')} inputmode="decimal" enterkeyhint="done"
             placeholder={prevWeight ? String(prevWeight.kg).replace('.', ',') : '–'} autocomplete="off" />
      <span>kg</span>
    </div>
    {#if prevWeight}<p class="muted small">Zuletzt {String(prevWeight.kg).replace('.', ',')} kg am {fmtDay(prevWeight.date)}</p>{/if}
    {#if weightErr}<p class="error small">{weightErr}</p>{/if}
  </section>

  <div class="actions">
    <button class="btn ghost" onclick={() => closeMorning(false)}>Später</button>
    <button class="btn primary" onclick={done} disabled={saving}>{weight.trim() ? 'Speichern' : 'Los geht’s'}</button>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; touch-action: none; background: rgba(0,0,0,.45); z-index: 20; animation: fade .2s; }
  .sheet { position: fixed; left: 0; right: 0; bottom: 0; z-index: 21; max-height: 92vh; max-height: 92dvh; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch;
           background: var(--bg); border-radius: 26px 26px 0 0; padding: 8px 20px calc(env(safe-area-inset-bottom) + 16px);
           max-width: 640px; margin: 0 auto; animation: up .3s cubic-bezier(.2,.9,.3,1); }
  @keyframes up { from { transform: translateY(100%); } }
  @keyframes fade { from { opacity: 0; } }
  .grab { width: 40px; height: 5px; border-radius: 3px; background: var(--line); margin: 4px auto 14px; }
  .eyebrow { margin: 0; color: var(--muted); font-size: 14px; }
  .title { font-size: 28px; margin: 2px 0 10px; letter-spacing: -0.02em; }
  section { background: var(--card); border-radius: 18px; padding: 14px 16px; margin-bottom: 10px; }
  h3 { margin: 0 0 10px; font-size: 15px; font-weight: 650; }
  .opt { font-weight: 400; font-size: 13px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .tile { background: var(--bg); border-radius: 12px; padding: 10px 12px; display: flex; flex-direction: column; }
  .l { font-size: 12px; color: var(--muted); }
  .v { font-size: 26px; font-weight: 700; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
  .v small { font-size: 13px; color: var(--muted); font-weight: 500; margin-left: 3px; }
  .d { font-size: 12px; color: var(--muted); min-height: 15px; }
  .d.up { color: var(--green); } .d.down { color: var(--red); }
  .hint { font-size: 13px; background: var(--accent-soft); padding: 8px 10px; border-radius: 10px; margin: 0 0 10px; }
  .plan { display: flex; gap: 12px; align-items: center; padding: 6px 0; }
  .plan div { display: flex; flex-direction: column; }
  .plan .muted { font-size: 13px; }
  .dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
  .note { font-size: 14px; color: var(--muted); margin: 4px 0 0; }
  label { margin: 0; color: var(--text); }
  .weight { display: flex; align-items: center; gap: 10px; }
  .weight input { margin: 0; font-size: 28px; font-weight: 700; padding: 10px 14px; text-align: center; font-variant-numeric: tabular-nums; }
  .weight span { font-size: 18px; color: var(--muted); }
  .small { font-size: 13px; margin: 8px 0 0; }
  .muted { color: var(--muted); }
  .actions { display: grid; grid-template-columns: 1fr 2fr; gap: 10px; margin-top: 6px; }
</style>
