<script lang="ts">
  import { swipeDismiss } from '../actions/swipeDismiss';
  import { db, type Goal, type GoalSport, type TriDistance } from '../../core/db';
  import { today, fmtDay, addDays } from '../../core/dates';
  import { SPORTS, DISTANCE_PRESETS, TRI, recommendedStart, parseTime, fmtTime } from '../../domain/planner/goals';
  import { saveGoal, archiveGoal, lowBase } from '../../domain/planner/repo';
  import { app, closeGoal } from '../app.svelte';
  import { predictFor } from '../../domain/planner/besttimes';

  const target = app.goalSheet!;
  let existing = $state<Goal | null>(null);
  let sport = $state<GoalSport>('lauf');
  let distance = $state('21.0975'), customDist = $state(''), elevation = $state('');
  let tri = $state<TriDistance>('olympisch');
  let date = $state(addDays(today(), 84)), planStart = $state(''), startTouched = $state(false);
  let time = $state(''), tSwim = $state(''), tBike = $state(''), tRun = $state('');
  let low = $state(false), err = $state(''), confirmDel = $state(false);

  $effect(() => { if (target.id) db.goals.get(target.id).then(g => { if (!g) return; existing = g; sport = g.sport; date = g.date; planStart = g.planStart; startTouched = true;
    elevation = g.elevation ? String(g.elevation) : ''; tri = g.triDistance ?? 'olympisch';
    const preset = g.sport !== 'triathlon' && DISTANCE_PRESETS[g.sport].find(p => Math.abs(p.km - (g.distanceKm ?? 0)) < 0.01);
    distance = preset ? String(preset.km) : 'custom'; customDist = preset ? '' : String(g.distanceKm ?? '');
    time = g.targetTime ? fmtTime(g.targetTime) : ''; tSwim = g.targetTimes?.swim ? fmtTime(g.targetTimes.swim) : ''; tBike = g.targetTimes?.bike ? fmtTime(g.targetTimes.bike) : ''; tRun = g.targetTimes?.run ? fmtTime(g.targetTimes.run) : ''; }); });
  $effect(() => { lowBase(sport).then(v => (low = v)); });

  function pickSport(s: GoalSport) { sport = s; if (s !== 'triathlon') distance = String(DISTANCE_PRESETS[s][Math.min(1, DISTANCE_PRESETS[s].length - 1)].km); }
  const km = $derived(sport === 'triathlon' ? null : distance === 'custom' ? Number(customDist.replace(',', '.')) : Number(distance));
  const hasElev = $derived(SPORTS.find(s => s.id === sport)!.hasElevation);
  const rec = $derived(date > today() ? recommendedStart({ sport, distanceKm: km, triDistance: tri, elevation: Number(elevation) || null, date }, low, today()) : null);
  $effect(() => { if (rec && !startTouched) planStart = rec.start; });

  // Zielzeit-Vorschlag aus Bestzeiten (Straßenlauf; Triathlon: Laufteil mit Zuschlag fürs Laufen nach dem Rad)
  let pred = $state<{ now: number; goal: number; from: string; weekKm: number } | null>(null);
  $effect(() => {
    const k = sport === 'lauf' ? km : sport === 'triathlon' ? TRI[tri].run : null;
    const d = date, sp = sport;
    if (!k || !(k > 0)) { pred = null; return; }
    predictFor(k).then(p => {
      if (!p) { pred = null; return; }
      const now = p.secs * (sp === 'triathlon' ? 1.06 : 1);
      const weeks = Math.max(0, (Date.parse(d) - Date.parse(today())) / 604800000);
      const gain = Math.min(0.04, weeks * 0.003);        // vorsichtig: bis zu 4 % schneller durch die Vorbereitung
      pred = { now, goal: now * (1 - gain), from: p.from, weekKm: p.weekKm };
    });
  });
  const setPred = (v: number) => { const t = fmtTime(Math.round(v / 15) * 15); if (sport === 'triathlon') tRun = t; else time = t; };

  async function save() {
    err = '';
    if (!(date > today())) { err = 'Das Wettkampfdatum muss in der Zukunft liegen.'; return; }
    if (sport !== 'triathlon' && !(km && km > 0)) { err = 'Bitte eine Distanz angeben.'; return; }
    const tt = [time, tSwim, tBike, tRun].map(parseTime);
    if (tt.some(v => Number.isNaN(v))) { err = 'Zeiten bitte als h:mm:ss, h:mm oder Minuten.'; return; }
    if (!planStart || planStart > date) { err = 'Der Planstart muss vor dem Wettkampf liegen.'; return; }
    await saveGoal({ id: existing?.id, sport, date, planStart, distanceKm: km, elevation: hasElev && elevation ? Number(elevation) : null,
      triDistance: sport === 'triathlon' ? tri : null, targetTime: sport === 'triathlon' ? null : tt[0],
      targetTimes: sport === 'triathlon' ? { swim: tt[1], bike: tt[2], run: tt[3] } : null });
    closeGoal();
  }
  async function remove() { if (existing) await archiveGoal(existing.id); closeGoal(); }
  const fmtD = (d: string) => fmtDay(d, { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
</script>

<div class="backdrop" role="presentation" onclick={closeGoal}></div>
<div class="sheet" use:swipeDismiss={closeGoal} role="dialog" aria-modal="true" aria-label="Wettkampf">
  <div class="grab"></div>
  <h2 class="title">{existing ? 'Wettkampf bearbeiten' : 'Wettkampf eintragen'}</h2>

  <section>
    <h3>Sportart</h3>
    <div class="chips">{#each SPORTS as s}<button class:on={sport === s.id} onclick={() => pickSport(s.id)}>{s.label}</button>{/each}</div>
  </section>

  <section>
    {#if sport === 'triathlon'}
      <h3>Distanz</h3>
      <div class="chips">{#each Object.entries(TRI) as [k, v]}<button class:on={tri === k} onclick={() => (tri = k as TriDistance)}>{v.label}<small>{v.swim} / {v.bike} / {v.run} km</small></button>{/each}</div>
    {:else}
      <h3>Distanz</h3>
      <div class="chips">
        {#each DISTANCE_PRESETS[sport] as p}<button class:on={distance === String(p.km)} onclick={() => (distance = String(p.km))}>{p.label}</button>{/each}
        <button class:on={distance === 'custom'} onclick={() => (distance = 'custom')}>Andere</button>
      </div>
      {#if distance === 'custom'}<label>Distanz in km<input bind:value={customDist} inputmode="decimal" /></label>{/if}
      {#if hasElev}<label>Höhenmeter<input bind:value={elevation} inputmode="numeric" placeholder="z. B. 1800" /></label>{/if}
    {/if}
    <label>Wettkampfdatum<input type="date" bind:value={date} min={addDays(today(), 7)} /></label>
  </section>

  <section>
    <h3>Zielzeit <span class="muted opt">leer = egal</span></h3>
    {#if sport === 'triathlon'}
      <div class="grid3">
        <label>Schwimmen<input bind:value={tSwim} placeholder="egal" inputmode="numeric" /></label>
        <label>Rad<input bind:value={tBike} placeholder="egal" inputmode="numeric" /></label>
        <label>Laufen<input bind:value={tRun} placeholder="egal" inputmode="numeric" /></label>
      </div>
    {:else}
      <input bind:value={time} placeholder="egal  (z. B. 1:45:00)" inputmode="numeric" />
    {/if}
    {#if pred}
      <div class="pred">
        <p>Nach deinen Bestzeiten (Basis: {pred.from}) aktuell realistisch: <b>{fmtTime(Math.round(pred.now / 15) * 15)}</b>{sport === 'triathlon' ? ' im Laufteil' : ''}.
          {#if pred.goal < pred.now - 20}Mit der Vorbereitung bis zum Wettkampf ambitioniert: <b>{fmtTime(Math.round(pred.goal / 15) * 15)}</b>.{/if}</p>
        <div class="pbtn">
          <button class="link" onclick={() => setPred(pred!.now)}>Realistisch übernehmen</button>
          {#if pred.goal < pred.now - 20}<button class="link" onclick={() => setPred(pred!.goal)}>Ambitioniert übernehmen</button>{/if}
        </div>
      </div>
    {/if}
    <p class="muted small">Format h:mm:ss oder h:mm. Mit Zielzeit richten sich die Lauf-Paces danach, sonst nach deinen bisherigen Läufen.</p>
  </section>

  <section>
    <h3>Planstart</h3>
    {#if rec}
      <p class="rec">Empfehlung: <b>{rec.weeks} Wochen</b> Vorbereitung, Start <b>{fmtD(rec.ideal)}</b>{low ? ' (etwas länger, weil die letzten Wochen wenig Umfang hatten)' : ''}.
        {#if rec.tooLate}<br /><span class="warn">Der ideale Start ist schon vorbei – der Plan startet diese Woche und wird entsprechend kompakter.</span>{/if}</p>
      {#if planStart !== rec.start}<button class="link" onclick={() => { planStart = rec.start; startTouched = false; }}>Empfehlung übernehmen</button>{/if}
    {/if}
    <label>Plan startet am<input type="date" bind:value={planStart} oninput={() => (startTouched = true)} max={date} /></label>
    <p class="muted small">Bis dahin läuft deine Standardwoche weiter.</p>
  </section>

  {#if err}<p class="error">{err}</p>{/if}
  <div class="actions">
    {#if existing && !confirmDel}<button class="btn ghost" onclick={() => (confirmDel = true)}>Entfernen</button>
    {:else if confirmDel}<button class="btn ghost del" onclick={remove}>Wirklich?</button>
    {:else}<button class="btn ghost" onclick={closeGoal}>Abbrechen</button>{/if}
    <button class="btn primary" onclick={save}>{existing ? 'Speichern' : 'Plan erstellen'}</button>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 20; touch-action: none; }
  .sheet { position: fixed; left: 0; right: 0; bottom: 0; z-index: 21; max-height: calc(100% - env(safe-area-inset-top) - 12px); overflow-y: auto; overscroll-behavior: contain;
           background: var(--bg); border-radius: 26px 26px 0 0; padding: 8px 18px calc(env(safe-area-inset-bottom) + 16px); max-width: 640px; margin: 0 auto; animation: up .3s cubic-bezier(.2,.9,.3,1); }
  @keyframes up { from { transform: translateY(100%); } }
  .grab { width: 40px; height: 5px; border-radius: 3px; background: var(--line); margin: 4px auto 12px; }
  .title { font-size: 26px; margin: 0 0 6px; }
  section { background: var(--card); border-radius: 18px; padding: 14px 16px; margin: 10px 0; }
  h3 { margin: 2px 0 8px; font-size: 15px; } .opt { font-weight: 400; font-size: 13px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chips button { border: 1px solid var(--line); background: var(--bg); color: var(--text); border-radius: 10px; padding: 8px 11px; font: inherit; font-size: 14px; cursor: pointer; min-height: 40px; display: flex; flex-direction: column; align-items: flex-start; }
  .chips button small { font-size: 11px; color: var(--muted); }
  .chips button.on { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; } .chips button.on small { color: #fff; }
  label { margin-top: 12px; font-size: 13px; }
  .pred { background: var(--accent-soft); border-radius: 12px; padding: 10px 12px; margin-top: 10px; }
  .pred p { margin: 0; font-size: 14px; line-height: 1.45; }
  .pbtn { display: flex; gap: 0 18px; flex-wrap: wrap; margin-top: 4px; }
  .pbtn .link { margin: 0; }
  .grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; } .grid3 label { margin-top: 0; }
  .small { font-size: 13px; }
  .rec { font-size: 14px; margin: 0 0 4px; line-height: 1.45; }
  .warn { color: var(--yellow); }
  .link { background: none; border: none; color: var(--accent); font: inherit; font-weight: 600; padding: 4px 0; cursor: pointer; }
  .actions { display: grid; grid-template-columns: 1fr 2fr; gap: 10px; margin-top: 6px; }
  .del { color: var(--red); }
</style>
