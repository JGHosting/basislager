<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db, getSetting, type FixedEvent } from '../../core/db';
  import { today, addDays, weekStart, fmtDay } from '../../core/dates';
  import { planWeeks, setRunsPerWeek, saveEvent, deleteEvent } from '../../domain/planner/repo';
  import { PHASE_LABEL, adaptToLight, isoWeek } from '../../domain/planner/plan';
  import { goalLabel, fmtTime, fmtPace } from '../../domain/planner/goals';
  import { computeToday } from '../../domain/today';
  import { openGoal, openInjury } from '../app.svelte';
  import SessionCard from '../planner/SessionCard.svelte';

  const t = today();
  let offset = $state(0);
  const ws = $derived(addDays(weekStart(t), offset * 7));
  // Plan neu berechnen, sobald sich Woche oder Daten ändern (Aktivitäten, Ziele, Änderungen, Verletzung …)
  let planData = $state.raw<Awaited<ReturnType<typeof planWeeks>> | null>(null);
  $effect(() => {
    const w = ws;
    const sub = liveQuery(() => planWeeks(w, 1)).subscribe(v => { if (v.weeks[0].weekStart === w) planData = v; });
    return () => sub.unsubscribe();
  });
  const calc = liveQuery(() => computeToday());
  const runs = liveQuery(async () => (await getSetting<2 | 3>('runsPerWeek')) ?? 3);
  const events = liveQuery(() => db.fixedEvents.orderBy('start').toArray());

  const days = $derived(Array.from({ length: 7 }, (_, i) => addDays(ws, i)));
  const dur = (m: number) => `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')}`;
  const weeksTo = (d: string) => Math.ceil((Date.parse(d) - Date.parse(t)) / 604800000);

  // Fixtermin-Formular
  let evOpen = $state(false);
  let ev = $state<{ type: FixedEvent['type']; title: string; start: string; end: string }>({ type: 'ski', title: '', start: t, end: t });
  async function addEvent() { if (ev.end < ev.start) ev.end = ev.start; await saveEvent({ ...ev, title: ev.title.trim() || undefined }); evOpen = false; }
  const EV = { ski: 'Ski/Snowboard', hochtour: 'Hochtour', urlaub: 'Urlaub', sonstiges: 'Sonstiges' } as const;
</script>

<header class="page-head">
  <div><p class="eyebrow">KW {isoWeek(ws)} · {fmtDay(ws, { day: '2-digit', month: '2-digit' })} – {fmtDay(addDays(ws, 6), { day: '2-digit', month: '2-digit' })}</p><h1>Plan</h1></div>
  <div class="wnav">
    <button aria-label="Vorherige Woche" onclick={() => offset--} disabled={offset <= -1}>‹</button>
    <button class="d" onclick={() => (offset = 0)}>{offset === 0 ? 'Diese Woche' : offset === 1 ? 'Nächste' : offset === -1 ? 'Letzte' : `+${offset}`}</button>
    <button aria-label="Nächste Woche" onclick={() => offset++}>›</button>
  </div>
</header>

{#if planData && planData.weeks[0].weekStart === ws}
  {@const w = planData.weeks[0]}
  {@const goal = planData.ctx.goal}
  <section class="card mode">
    {#if goal}
      <div class="mh">
        <span class="kicker">Wettkampf · noch {weeksTo(goal.date)} Wochen</span>
        <button class="link" onclick={() => openGoal({ id: goal.id })}>Bearbeiten</button>
      </div>
      <h2>{goalLabel(goal)}</h2>
      <p class="muted small">{fmtDay(goal.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        · {goal.sport === 'triathlon' ? `Ziel ${fmtTime(goal.targetTimes?.swim)} / ${fmtTime(goal.targetTimes?.bike)} / ${fmtTime(goal.targetTimes?.run)}` : `Ziel ${fmtTime(goal.targetTime)}`}
        · Planstart {fmtDay(goal.planStart, { day: '2-digit', month: '2-digit' })}</p>
      <p class="phase"><b>{PHASE_LABEL[w.phase]}</b>{w.weekNo ? ` · Woche ${w.weekNo}/${w.totalWeeks}` : ws < weekStart(goal.planStart) ? ' · Plan startet später, bis dahin Standardwoche' : ''}</p>
    {:else}
      <div class="mh"><span class="kicker">Standardwoche</span></div>
      <h2>3× Kraft · {$runs}× Laufen</h2>
      <p class="muted small">Laufumfang steigt langsam mit dir mit, jede 4. Woche ist leichter. {w.phase === 'erholung' ? 'Diese Woche: Erholungswoche.' : ''}</p>
      <div class="seg"><span class="muted small">Läufe pro Woche</span>
        {#each [2, 3] as n}<button class:on={$runs === n} onclick={() => setRunsPerWeek(n as 2 | 3)}>{n}×</button>{/each}
      </div>
      <button class="btn primary wide" onclick={() => openGoal({})}>Wettkampf eintragen</button>
    {/if}
    <p class="sum muted small">Diese Woche ≈ {dur(w.minutes)} gesamt{w.runMinutes ? ` · Laufen ${dur(w.runMinutes)}` : ''} · Paces {w.paces.source === 'ziel' ? 'aus Zielzeit' : w.paces.source === 'verlauf' ? 'aus deinen Läufen' : 'Standardwerte'}: locker {fmtPace(w.paces.easy)}, Schwelle {fmtPace(w.paces.threshold)} min/km</p>
  </section>

  {#if planData.ctx.injury}
    <section class="card injb">
      <b>Verletzung aktiv</b> – der Plan enthält nur erlaubte Bewegungen{planData.ctx.injury.mode === 'ausfall' ? '' : ' und reduzierten Umfang'}.
      {#if goal}
        <p class="small">Für deinen Wettkampf hast du drei Möglichkeiten:</p>
        <div class="opts">
          <button onclick={() => openGoal({ id: goal.id })}><b>Ziel halten</b><small>Plan läuft angepasst weiter</small></button>
          <button onclick={() => openGoal({ id: goal.id })}><b>Zielzeit anpassen</b><small>z. B. auf „egal“ setzen</small></button>
          <button onclick={() => openGoal({ id: goal.id })}><b>Verschieben / Spaßlauf</b><small>Datum ändern oder entfernen</small></button>
        </div>
      {/if}
      <button class="link" onclick={() => openInjury({ id: planData.ctx.injury!.id })}>Verletzung ansehen</button>
    </section>
  {/if}

  {#each days as d}
    {@const list = w.sessions.filter(s => s.date === d)}
    {@const evs = w.events.filter(e => d >= e.start && d <= e.end)}
    <section class="card day" class:today={d === t} class:past={d < t}>
      <div class="dh"><b>{d === t ? 'Heute' : fmtDay(d, { weekday: 'long' })}</b><span class="muted small">{fmtDay(d, { day: '2-digit', month: '2-digit' })}</span></div>
      {#each evs as e}<p class="ev">{EV[e.type]}{e.title ? ': ' + e.title : ''}</p>{/each}
      {#each list as s (s.key)}
        <SessionCard s={d === t && $calc ? adaptToLight(s, $calc.recovery.light) : s} />
      {/each}
      {#if !list.length && !evs.length}<p class="muted small rest">Ruhetag</p>{/if}
    </section>
  {/each}

  <h3 class="section">Fixtermine</h3>
  <section class="card">
    <p class="muted small">An diesen Tagen wird nichts geplant. Vor Ski- und Hochtouren-Tagen gibt es kein schweres Beintraining.</p>
    {#each ($events ?? []).filter(e => e.end >= t) as e (e.id)}
      <div class="evrow"><span><b>{EV[e.type]}{e.title ? ': ' + e.title : ''}</b><small>{fmtDay(e.start, { day: '2-digit', month: '2-digit' })}{e.end !== e.start ? ' – ' + fmtDay(e.end, { day: '2-digit', month: '2-digit' }) : ''}</small></span>
        <button aria-label="Fixtermin löschen" onclick={() => deleteEvent(e.id)}>✕</button></div>
    {/each}
    {#if evOpen}
      <div class="evform">
        <div class="chips">{#each Object.entries(EV) as [k, l]}<button class:on={ev.type === k} onclick={() => (ev.type = k as FixedEvent['type'])}>{l}</button>{/each}</div>
        <input bind:value={ev.title} placeholder="Titel (optional)" />
        <div class="two"><label>Von<input type="date" bind:value={ev.start} /></label><label>Bis<input type="date" bind:value={ev.end} min={ev.start} /></label></div>
        <div class="two"><button class="btn ghost" onclick={() => (evOpen = false)}>Abbrechen</button><button class="btn primary" onclick={addEvent}>Speichern</button></div>
      </div>
    {:else}
      <button class="link" onclick={() => { ev = { type: 'ski', title: '', start: t, end: t }; evOpen = true; }}>+ Fixtermin</button>
    {/if}
  </section>
{/if}

<style>
  .wnav { display: flex; align-items: center; background: var(--card); border-radius: 99px; padding: 3px; }
  .wnav button { border: none; background: none; color: var(--text); font: inherit; font-size: 20px; width: 38px; height: 34px; border-radius: 99px; cursor: pointer; }
  .wnav button:disabled { opacity: .3; }
  .wnav .d { width: auto; padding: 0 8px; font-size: 14px; font-weight: 600; color: var(--accent); }
  .mh { display: flex; justify-content: space-between; align-items: baseline; }
  .kicker { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--accent); font-weight: 700; }
  .mode h2 { margin: 4px 0 2px; }
  .small { font-size: 13px; }
  .phase { margin: 8px 0 0; font-size: 15px; }
  .sum { margin: 10px 0 0; }
  .seg { display: flex; align-items: center; gap: 6px; margin: 10px 0 0; }
  .seg span { margin-right: auto; }
  .seg button { border: 1px solid var(--line); background: var(--bg); color: var(--text); border-radius: 10px; padding: 6px 14px; font: inherit; font-weight: 600; cursor: pointer; }
  .seg button.on { background: var(--accent); border-color: var(--accent); color: #fff; }
  .link { background: none; border: none; color: var(--accent); font: inherit; font-weight: 600; font-size: 14px; padding: 6px 0; cursor: pointer; }
  .injb { border: 2px solid var(--red); font-size: 14px; }
  .opts { display: grid; gap: 6px; margin: 6px 0; }
  .opts button { text-align: left; border: 1px solid var(--line); background: var(--bg); color: var(--text); border-radius: 12px; padding: 9px 12px; font: inherit; display: flex; flex-direction: column; cursor: pointer; }
  .opts small { font-size: 12px; color: var(--muted); }
  .day { padding: 12px 14px; }
  .day.today { outline: 2px solid var(--accent); }
  .day.past { opacity: .75; }
  .dh { display: flex; justify-content: space-between; align-items: baseline; }
  .rest { margin: 6px 0 0; }
  .ev { margin: 8px 0 0; font-size: 14px; font-weight: 600; color: var(--c-snow); }
  .section { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); font-weight: 600; margin: 22px 4px 8px; }
  .evrow { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-top: 1px solid var(--line); }
  .evrow span { display: flex; flex-direction: column; } .evrow small { color: var(--muted); font-size: 12px; }
  .evrow button { border: none; background: var(--bg); color: var(--muted); width: 34px; height: 34px; border-radius: 10px; cursor: pointer; }
  .evform { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
  .evform input { margin: 0; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chips button { border: 1px solid var(--line); background: var(--bg); color: var(--text); border-radius: 10px; padding: 7px 10px; font: inherit; font-size: 13px; cursor: pointer; }
  .chips button.on { background: var(--accent); border-color: var(--accent); color: #fff; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; } .two label { margin: 0; font-size: 13px; }
</style>
