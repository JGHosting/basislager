<script lang="ts">
  import { liveQuery } from 'dexie';
  import { swipeDismiss } from '../actions/swipeDismiss';
  import { db, getSetting, type ActivityExtra } from '../../core/db';
  import { fmtDay } from '../../core/dates';
  import { app, closeActivity, openStrength } from '../app.svelte';
  import { sportName, sportColor, dur, num } from '../format';
  import { activityLoad, hrProfile, ownElevation } from '../../domain/load/load';
  import { loadDetails } from '../../domain/activity/details';
  import { groupLabel, isStrengthActivity } from '../../domain/strength/strength';
  import { today } from '../../core/dates';
  import { ZONES, zoneBpm, zoneTimes } from '../../domain/load/zones';

  const id = app.activitySheet!.id;
  const data = liveQuery(async () => {
    const a = await db.activities.get(id);
    if (!a) return null;
    const [acts, morning, mMax, mRest, ss] = await Promise.all([db.activities.toArray(), db.morning.toArray(), getSetting<number | null>('hrMax'), getSetting<number | null>('hrRest'),
      db.strength.where('activityId').equals(id).first()]);
    const hr = hrProfile(acts, morning.filter(m => m.restingHr != null).map(m => m.restingHr!), { max: mMax, rest: mRest }, today());
    return { a, hr, load: activityLoad(a, hr, ss?.intensity), strength: ss };
  });
  let extra = $state<ActivityExtra | null>(null), loading = $state(false), err = $state('');
  let loadingStarted = false;
  // Einmal pro Öffnen: gespeicherte Details zeigen, fehlende (inkl. Pulsverlauf) von intervals.icu nachladen
  $effect(() => {
    const d = $data; if (!d || loadingStarted) return;
    loadingStarted = true;
    extra = d.a.extra ?? null;
    const needs = !d.a.extra || (!!d.a.avgHr && d.a.extra.hrHist === undefined);
    if (!needs) return;
    loading = true;
    loadDetails(d.a).then(x => (extra = x)).catch(() => (err = 'Details konnten nicht geladen werden (offline?).')).finally(() => (loading = false));
  });

  const isRun = (t: string) => /Run|Walk|Hike/.test(t);
  const pace = (mps: number) => { const m = 1000 / mps / 60; const mm = Math.floor(m), ss = Math.round((m - mm) * 60); return `${mm}:${String(ss === 60 ? 0 : ss).padStart(2, '0')}`; };
  const kmh = (mps: number) => (mps * 3.6).toLocaleString('de-DE', { maximumFractionDigits: 1 });
  // Zone 0 grau, dann aufsteigend kalt → warm
  const ZONE_COLORS = ['#9aa3ad', '#2a78d6', '#1baf7a', '#eda100', '#eb6834', '#e34948'];
</script>

<div class="backdrop" role="presentation" onclick={closeActivity}></div>
<div class="sheet" use:swipeDismiss={closeActivity} role="dialog" aria-modal="true" aria-label="Aktivität">
  <div class="grab"></div>
  {#if $data}
    {@const a = $data.a}
    {@const elev = ownElevation(a)}
    {@const speed = a.distance && (a.duration ?? a.elapsed) ? a.distance / (a.duration ?? a.elapsed)! : null}
    <div class="head">
      <span class="dot" style="background: {sportColor(a.sportType)}"></span>
      <div>
        <p class="eyebrow">{fmtDay(a.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · {a.start.slice(11, 16)} Uhr</p>
        <h2 class="title">{sportName(a.sportType)}{a.name ? ` · ${a.name}` : ''}</h2>
      </div>
    </div>

    <section class="grid">
      <div><span>Dauer</span><b>{dur(a.duration ?? a.elapsed)}</b>{#if a.elapsed && a.duration && a.elapsed - a.duration > 120}<small>gesamt {dur(a.elapsed)}</small>{/if}</div>
      {#if a.distance}<div><span>Distanz</span><b>{(a.distance / 1000).toLocaleString('de-DE', { maximumFractionDigits: 2 })} km</b></div>{/if}
      {#if speed}<div><span>{isRun(a.sportType) ? 'Ø Pace' : 'Ø Tempo'}</span><b>{isRun(a.sportType) ? pace(speed) + ' /km' : kmh(speed) + ' km/h'}</b>
        {#if extra?.maxSpeed}<small>max {isRun(a.sportType) ? pace(extra.maxSpeed) + ' /km' : kmh(extra.maxSpeed) + ' km/h'}</small>{/if}</div>{/if}
      {#if a.elevationGain}<div><span>Höhenmeter</span><b>{num(a.elevationGain)} m ↑</b>{#if extra?.elevLoss}<small>{num(extra.elevLoss)} m ↓{elev == null ? ' · Lift, zählt nicht' : ''}</small>{:else if elev == null}<small>Lift, zählt nicht</small>{/if}</div>{/if}
      {#if a.avgHr}<div><span>Ø Puls</span><b>{num(a.avgHr)} bpm</b>{#if a.maxHr}<small>max {num(a.maxHr)}</small>{/if}</div>{/if}
      <div><span>Belastung</span><b>{num($data.load.load)}</b><small>{$data.load.method === 'trimp' ? 'TRIMP aus Puls' : 'geschätzt ohne Puls'}</small></div>
      {#if extra?.calories}<div><span>Kalorien</span><b>{num(extra.calories)} kcal</b></div>{/if}
      {#if extra?.cadence}<div><span>Ø Trittfrequenz</span><b>{num(isRun(a.sportType) ? extra.cadence * 2 : extra.cadence)} {isRun(a.sportType) ? 'spm' : 'rpm'}</b></div>{/if}
      {#if extra?.avgWatts}<div><span>Ø Leistung</span><b>{num(extra.avgWatts)} W</b>{#if extra.npWatts}<small>NP {num(extra.npWatts)} W</small>{/if}</div>{/if}
      {#if extra?.altMax != null && extra.altMin != null && extra.altMax - extra.altMin > 20}<div><span>Höhe</span><b>{num(extra.altMin)}–{num(extra.altMax)} m</b></div>{/if}
      {#if extra?.avgTemp != null}<div><span>Temperatur</span><b>{num(extra.avgTemp)} °C</b></div>{/if}
      {#if extra?.laps}<div><span>Runden</span><b>{extra.laps}</b></div>{/if}
      {#if extra?.rpe}<div><span>Anstrengung (RPE)</span><b>{extra.rpe}/10</b></div>{/if}
    </section>

    {#if extra?.hrHist?.length}
      {@const zt = zoneTimes(extra.hrHist, $data.hr.max)}
      {@const total = zt.reduce((x, y) => x + y, 0)}
      {@const zb = zoneBpm($data.hr.max)}
      <section>
        <h3>Pulszonen <span class="muted sub">% vom Maximalpuls ({$data.hr.max} bpm)</span></h3>
        {#each zt as secs, i}
          <div class="zone">
            <span class="zl"><b>Z{i}</b> {ZONES[i].label}<small>{i === 0 ? `< ${zb[i].hi}` : `${zb[i].lo}–${zb[i].hi}`} bpm</small></span>
            <span class="zbar"><i style="width: {total ? (secs / total) * 100 : 0}%; background: {ZONE_COLORS[i]}"></i></span>
            <span class="zv">{secs ? dur(secs) : '–'}<small>{total ? Math.round((secs / total) * 100) : 0} %</small></span>
          </div>
        {/each}
      </section>
    {:else if extra && a.avgHr && extra.hrHist === null}
      <section><h3>Pulszonen</h3><p class="muted small">Für diese Aktivität gibt es keinen Pulsverlauf.</p></section>
    {/if}

    {#if isStrengthActivity(a)}
      <section>
        <h3>Krafttraining</h3>
        {#if $data.strength && !$data.strength.skipped}
          <p>{$data.strength.muscleGroups.map(groupLabel).join(' + ')}{$data.strength.intensity ? ` · Intensität ${$data.strength.intensity}/10` : ''}</p>
        {:else}<p class="muted">Noch keine Muskelgruppen eingetragen.</p>{/if}
        <button class="link" onclick={() => { closeActivity(); openStrength({ activityId: a.id }); }}>Muskelgruppen {($data.strength ? 'bearbeiten' : 'eintragen')}</button>
      </section>
    {/if}

    {#if extra?.description}<section><h3>Notiz</h3><p class="desc">{extra.description}</p></section>{/if}
    {#if loading}<p class="muted small">Lade Details von intervals.icu …</p>{/if}
    {#if err}<p class="muted small">{err}</p>{/if}
    <p class="foot muted small">{extra?.device ? `Aufgezeichnet mit ${extra.device} · ` : ''}<a href="https://intervals.icu/activities/{a.sourceId}" target="_blank" rel="noopener">In intervals.icu öffnen</a></p>
  {:else if $data === null}
    <p class="muted">Aktivität nicht gefunden.</p>
  {/if}
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 20; touch-action: none; }
  .sheet { position: fixed; left: 0; right: 0; bottom: 0; z-index: 21; max-height: calc(100% - env(safe-area-inset-top) - 12px); overflow-y: auto; overscroll-behavior: contain;
           background: var(--bg); border-radius: 26px 26px 0 0; padding: 8px 18px calc(env(safe-area-inset-bottom) + 16px); max-width: 640px; margin: 0 auto; animation: up .3s cubic-bezier(.2,.9,.3,1); }
  @keyframes up { from { transform: translateY(100%); } }
  .grab { width: 40px; height: 5px; border-radius: 3px; background: var(--line); margin: 4px auto 12px; }
  .head { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 8px; }
  .head .dot { width: 14px; height: 14px; border-radius: 50%; margin-top: 6px; flex-shrink: 0; }
  .eyebrow { margin: 0; color: var(--muted); font-size: 13px; }
  .title { font-size: 22px; margin: 2px 0 0; }
  section { background: var(--card); border-radius: 18px; padding: 14px 16px; margin: 10px 0; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 12px; }
  .grid div { display: flex; flex-direction: column; }
  .grid span { font-size: 12px; color: var(--muted); }
  .grid b { font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
  .grid small { font-size: 12px; color: var(--muted); }
  h3 { margin: 0 0 10px; font-size: 15px; }
  .sub { font-weight: 400; font-size: 12px; }
  .zone { display: grid; grid-template-columns: 118px 1fr 64px; align-items: center; gap: 8px; margin: 6px 0; font-size: 13px; font-variant-numeric: tabular-nums; }
  .zl { color: var(--muted); display: flex; flex-direction: column; line-height: 1.25; } .zl b { color: var(--text); } .zl small, .zv small { font-size: 11px; color: var(--muted); }
  .zv { display: flex; flex-direction: column; align-items: flex-end; line-height: 1.25; }
  .zbar { height: 12px; background: var(--bg); border-radius: 6px; overflow: hidden; }
  .zbar i { display: block; height: 100%; border-radius: 6px; }
  .zv { text-align: right; }
  .link { background: none; border: none; color: var(--accent); font: inherit; font-weight: 600; padding: 4px 0; cursor: pointer; }
  .desc { white-space: pre-wrap; font-size: 14px; margin: 0; }
  .small { font-size: 13px; }
  .foot { text-align: center; margin-top: 12px; } .foot a { color: var(--accent); }
</style>
