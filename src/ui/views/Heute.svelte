<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db } from '../../core/db';
  import { today, addDays, weekStart, fmtDay } from '../../core/dates';
  import { app, openMorning } from '../app.svelte';
  import { sportName, sportColor, dur, km, num, hours, activityFacts } from '../format';
  import SportIcon from '../components/SportIcon.svelte';
  import RouteThumb from '../components/RouteThumb.svelte';
  import ConnectForm from '../components/ConnectForm.svelte';
  import SyncChip from '../components/SyncChip.svelte';
  import AmpelCard from '../components/AmpelCard.svelte';
  import LoadCard from '../components/LoadCard.svelte';
  import StrengthCard from '../components/StrengthCard.svelte';
  import KcalBar from '../nutrition/KcalBar.svelte';
  import InjuryCard from '../injury/InjuryCard.svelte';
  import SessionCard from '../planner/SessionCard.svelte';
  import { sessionsOn } from '../../domain/planner/repo';
  import { adaptToLight } from '../../domain/planner/plan';
  import { TRAINING_LABEL, vacationToday, vacationSportLabel } from '../../domain/vacation/vacation';
  import { openInjury } from '../app.svelte';
  import { dayView, getKcalGoal } from '../../domain/nutrition/repo';
  import { groupLabel } from '../../domain/strength/strength';
  import { openStrength, openActivity } from '../app.svelte';
  import { computeToday } from '../../domain/today';
  import { ownElevation } from '../../domain/load/load';

  // Ampel + Belastung: rechnet automatisch neu, sobald sich Aktivitäten, Morgenwerte oder Pulswerte ändern
  const calc = liveQuery(() => computeToday());
  const todayPlan = liveQuery(async () => (await sessionsOn(today())).sessions);
  const vacation = liveQuery(() => vacationToday());
  const food = liveQuery(async () => ({ day: await dayView(today()), goal: await getKcalGoal() }));

  const t = today();
  const ws = weekStart(t);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(ws, i));

  const morning = liveQuery(() => db.morning.where('date').between(addDays(t, -14), t, true, true).toArray());
  const week = liveQuery(() => db.activities.where('date').between(ws, addDays(ws, 6), true, true).toArray());
  // Aktivitäten der letzten 6 Monate, nach Monat gruppiert
  const recent = liveQuery(() => db.activities.where('date').aboveOrEqual(addDays(today(), -183)).toArray());
  const total = liveQuery(() => db.activities.count());
  const strengthByAct = liveQuery(async () => new Map((await db.strength.toArray()).filter(s => s.activityId).map(s => [s.activityId!, s])));

  // Morgenwerte: heute + Durchschnitt der 7 Tage davor (nur vorhandene Werte)
  const todayEntry = $derived($morning?.find(m => m.date === t));
  function avg7(field: 'hrv' | 'restingHr' | 'sleepScore' | 'sleepSecs') {
    const vals = ($morning ?? []).filter(m => m.date < t && m.date >= addDays(t, -7)).map(m => m[field]).filter((v): v is number => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }
  function delta(v: number | null | undefined, a: number | null) {
    if (v == null || a == null || a === 0) return null;
    return Math.round(((v - a) / a) * 100);
  }

  const wk = $derived.by(() => {
    const list = $week ?? [];
    const perDay = weekDays.map(d => list.filter(a => a.date === d).reduce((s, a) => s + (a.duration ?? a.elapsed ?? 0), 0));
    return {
      count: list.length,
      time: list.reduce((s, a) => s + (a.duration ?? a.elapsed ?? 0), 0),
      dist: list.reduce((s, a) => s + (a.distance ?? 0), 0),
      elev: list.reduce((s, a) => s + (ownElevation(a) ?? 0), 0),
      perDay, max: Math.max(3600, ...perDay)
    };
  });

  const sortedRecent = $derived(($recent ?? []).slice().sort((a, b) => b.start.localeCompare(a.start)));
  // Nach Monat gruppieren (neuester zuerst)
  const byMonth = $derived.by(() => {
    const groups: { key: string; label: string; items: typeof sortedRecent }[] = [];
    for (const a of sortedRecent) {
      const key = a.date.slice(0, 7);
      let g = groups.find(x => x.key === key);
      if (!g) { g = { key, label: fmtDay(key + '-01', { month: 'long', year: 'numeric' }), items: [] }; groups.push(g); }
      g.items.push(a);
    }
    return groups;
  });
</script>

<header class="page-head">
  <div>
    <p class="eyebrow">{fmtDay(t, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
    <h1>Heute</h1>
  </div>
  <SyncChip />
</header>

{#if app.ready && !app.connected}
  <ConnectForm />
{:else}
  {#if app.syncing && !app.syncState.historyDone}
    <section class="card import">
      <h2>Historie wird importiert</h2>
      <p class="muted">{app.syncLabel} · {app.syncCount.activities} Aktivitäten, {app.syncCount.days} Tage mit Morgenwerten bisher</p>
      <div class="bar"><span></span></div>
      <p class="small muted">Du kannst die App dabei schließen. Beim nächsten Öffnen geht es an derselben Stelle weiter.</p>
    </section>
  {/if}
  {#if ($total ?? 0) > 0 && (!app.lastBackupAt || Date.now() - app.lastBackupAt > 30 * 86400000)}
    <a class="card nudge" href="#/mehr">
      <span>{app.lastBackupAt ? `Letztes Backup vor ${Math.floor((Date.now() - app.lastBackupAt) / 86400000)} Tagen` : 'Noch kein Backup deiner Daten'}</span>
      <b>Sichern →</b>
    </a>
  {/if}
  {#if app.syncError}
    <p class="card error">{app.syncError}</p>
  {/if}

  {#if $vacation}
    <a class="card vacb" href="#/plan">
      <b>{$vacation.sport ? vacationSportLabel($vacation.sport) : 'Urlaub'}{$vacation.title ? ': ' + $vacation.title : ''}</b>
      <span>bis {fmtDay($vacation.end, { weekday: 'short', day: '2-digit', month: '2-digit' })} · {$vacation.sport ? 'fester Sport, ersetzt das Training' : TRAINING_LABEL[$vacation.training]} · kein Tracking</span>
    </a>
  {/if}
  {#if $calc?.injury}<InjuryCard injury={$calc.injury} />{/if}
  {#if $calc}<AmpelCard rec={$calc.recovery} injury={!!$calc.injury} />{/if}
  {#if $todayPlan}
    <section class="card">
      <div class="card-head"><h2>Heute geplant</h2><a class="more" href="#/plan">Wochenplan →</a></div>
      {#if !$todayPlan.length}<p class="muted">Ruhetag.</p>{/if}
      {#each $todayPlan as sess (sess.key)}<SessionCard s={$calc ? adaptToLight(sess, $calc.recovery.light) : sess} />{/each}
    </section>
  {/if}

  {#if $calc && !$calc.injury}
    <button class="injbtn" onclick={() => openInjury()}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v16 M4 12h16" /></svg> Verletzung melden
    </button>
  {/if}

  <section class="card">
    <div class="card-head"><h2>Morgenwerte</h2><button class="tag" onclick={openMorning}>{todayEntry?.weight != null ? `${String(todayEntry.weight).replace('.', ',')} kg` : '+ Gewicht'}</button></div>
    {#if !todayEntry}
      <p class="muted">Für heute noch keine Werte. Die Uhr überträgt sie meist kurz nach dem Aufwachen, sobald Garmin Connect synchronisiert.</p>
    {:else}
      <div class="metrics">
        {#each [
          { l: 'HRV', v: todayEntry.hrv, a: avg7('hrv'), u: 'ms', good: 1 },
          { l: 'Ruhepuls', v: todayEntry.restingHr, a: avg7('restingHr'), u: 'bpm', good: -1 },
          { l: 'Sleep Score', v: todayEntry.sleepScore, a: avg7('sleepScore'), u: '', good: 1 },
          { l: 'Schlaf', v: todayEntry.sleepSecs, a: avg7('sleepSecs'), u: 'h', good: 1 }
        ] as m}
          {@const d = delta(m.v, m.a)}
          <div class="metric">
            <span class="m-label">{m.l}</span>
            <span class="m-value">{m.l === 'Schlaf' ? hours(m.v).replace(' h', '') : num(m.v)}<small>{m.u}</small></span>
            {#if d != null}
              <span class="m-delta" class:up={d * m.good > 0} class:down={d * m.good < 0}>{d > 0 ? '+' : ''}{d} % zu Ø 7 T</span>
            {:else}
              <span class="m-delta">–</span>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </section>

  {#if $food?.goal && $food.day.tracked}
    {@const eaten = $food.day.total.kcal.value}
    <a class="card foodmini" href="#/ernaehrung">
      <div class="fm"><b>Ernährung</b><span>{Math.round(eaten).toLocaleString('de-DE')} / {$food.goal.toLocaleString('de-DE')} kcal · <i class:over={eaten > $food.goal}>{eaten > $food.goal ? `${Math.round(eaten - $food.goal).toLocaleString('de-DE')} drüber` : `${Math.round($food.goal - eaten).toLocaleString('de-DE')} übrig`}</i></span></div>
      <KcalBar {eaten} goal={$food.goal} />
    </a>
  {/if}

  <StrengthCard />

  {#if $calc?.load}
    <LoadCard day={$calc.load.day} text={$calc.load.text} acwr={$calc.load.acwr} recent={$calc.load.recent} level={$calc.load.state} />
  {/if}

  <section class="card">
    <div class="card-head"><h2>Diese Woche</h2><span class="muted small">{fmtDay(ws, { day: '2-digit', month: '2-digit' })} – {fmtDay(addDays(ws, 6), { day: '2-digit', month: '2-digit' })}</span></div>
    <div class="week">
      {#each weekDays as d, i}
        <div class="wd" class:today={d === t}>
          <div class="col"><span style="height: {Math.round((wk.perDay[i] / wk.max) * 100)}%"></span></div>
          <small>{fmtDay(d, { weekday: 'narrow' })}</small>
        </div>
      {/each}
    </div>
    <div class="stats">
      <div><b>{wk.count}</b><span>Einheiten</span></div>
      <div><b>{dur(wk.time)}</b><span>Zeit</span></div>
      <div><b>{km(wk.dist, 0) || '0 km'}</b><span>Distanz</span></div>
      <div><b>{num(wk.elev)} m</b><span>Höhe</span></div>
    </div>
  </section>

  <section class="card">
    <div class="card-head"><h2>Letzte Aktivitäten</h2><span class="muted small">{num($total ?? 0)} gespeichert</span></div>
    {#if sortedRecent.length === 0}
      <p class="muted">Noch keine Aktivitäten gespeichert.</p>
    {/if}
    {#each byMonth as m (m.key)}
      <h3 class="month">{m.label}</h3>
      <ul class="acts">
        {#each m.items as a (a.id)}
          {@const ss = $strengthByAct?.get(a.id)}
          {@const facts = activityFacts(a, ownElevation(a))}
          <li class="tap" role="button" tabindex="0" onclick={() => openActivity(a.id)} onkeydown={e => e.key === 'Enter' && openActivity(a.id)}>
            <SportIcon type={a.sportType} size={44} />
            <div class="main">
              <strong>{sportName(a.sportType)}{ss && !ss.skipped ? ' · ' + ss.muscleGroups.map(groupLabel).join(' + ') : ''}</strong>
              <span class="when muted">{fmtDay(a.date)} · {dur(a.duration ?? a.elapsed)}{ss?.intensity ? ` · Intensität ${ss.intensity}/10` : a.name ? ' · ' + a.name : ''}</span>
              {#if facts.length}<span class="facts">{facts.join('   ')}</span>{/if}
            </div>
            <RouteThumb {a} size={52} />
          </li>
        {/each}
      </ul>
    {/each}
  </section>
{/if}

<style>
  .month { font-size: 13px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); font-weight: 600; margin: 18px 2px 2px; }
  .month:first-of-type { margin-top: 4px; }
  .card-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
  .card-head h2 { margin: 0; }
  .tag { border: none; font-family: inherit; cursor: pointer; font-size: 13px; color: var(--accent); background: var(--accent-soft); padding: 3px 9px; border-radius: 99px; font-weight: 600; }
  .small { font-size: 13px; }
  .vacb { display: flex; flex-direction: column; gap: 2px; text-decoration: none; color: var(--text); border-left: 5px solid var(--c-ride); }
  .vacb span { font-size: 13px; color: var(--muted); }
  .more { color: var(--accent); font-weight: 600; font-size: 14px; text-decoration: none; }
  .injbtn { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; margin: -2px 0 12px; padding: 12px; border-radius: 14px;
            border: 1px dashed color-mix(in srgb, var(--red) 55%, var(--line)); background: none; color: var(--red); font: inherit; font-weight: 600; font-size: 15px; cursor: pointer; }
  .injbtn svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2.6; stroke-linecap: round; }
  .foodmini { display: block; text-decoration: none; color: var(--text); }
  .fm { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; gap: 8px; }
  .fm span { font-size: 14px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .fm i { font-style: normal; color: var(--green); }
  .fm i.over { color: var(--red); }
  .nudge { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 12px 18px; text-decoration: none; color: var(--muted); font-size: 14px; }
  .nudge b { color: var(--accent); white-space: nowrap; }
  .import .bar { height: 6px; border-radius: 3px; background: var(--line); overflow: hidden; margin: 12px 0 8px; }
  .import .bar span { display: block; height: 100%; width: 35%; background: var(--accent); border-radius: 3px; animation: slide 1.4s ease-in-out infinite; }
  @keyframes slide { from { transform: translateX(-100%); } to { transform: translateX(290%); } }

  .metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .metric { background: var(--bg); border-radius: 14px; padding: 12px 14px; display: flex; flex-direction: column; gap: 2px; }
  .m-label { font-size: 13px; color: var(--muted); }
  .m-value { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
  .m-value small { font-size: 14px; font-weight: 500; color: var(--muted); margin-left: 3px; }
  .m-delta { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .m-delta.up { color: var(--green); }
  .m-delta.down { color: var(--red); }

  .week { display: grid; grid-template-columns: repeat(7, 1fr); gap: 8px; height: 92px; margin: 4px 0 14px; }
  .wd { display: flex; flex-direction: column; align-items: center; gap: 6px; }
  .col { flex: 1; width: 100%; max-width: 26px; background: var(--bg); border-radius: 8px; display: flex; align-items: flex-end; overflow: hidden; }
  .col span { width: 100%; background: var(--accent); border-radius: 8px; min-height: 0; transition: height .4s ease; }
  .wd small { color: var(--muted); font-size: 12px; }
  .wd.today small { color: var(--accent); font-weight: 700; }
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
  .stats div { display: flex; flex-direction: column; }
  .stats b { font-size: 17px; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .stats span { font-size: 12px; color: var(--muted); }

  .acts { list-style: none; margin: 0; padding: 0; }
  .acts li { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-top: 1px solid var(--line); }
  .acts li:first-child { border-top: none; padding-top: 4px; }
  .acts li.tap { cursor: pointer; }
  .main { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1; }
  .main strong { font-size: 15.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .acts .when { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .facts { font-size: 13px; color: var(--text); font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
