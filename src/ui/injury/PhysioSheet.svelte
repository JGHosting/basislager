<script lang="ts">
  import { swipeDismiss } from '../actions/swipeDismiss';
  import { db, type Injury, type Activity, type MorningEntry, type RehabCheck } from '../../core/db';
  import { today, addDays, fmtDay } from '../../core/dates';
  import { STAGES, isOutage, activeInjury } from '../../domain/injury/injury';
  import { EXERCISES, rehabCriteria, assessRehab, type RehabAssessment } from '../../domain/injury/rehab';
  import { saveRehabCheck, deleteRehabCheck, setStage, switchToStages } from '../../domain/injury/repo';
  import { app, closePhysio } from '../app.svelte';
  import { dur } from '../format';

  const target = app.physioSheet!;
  const t = today();
  let inj = $state.raw<Injury | null>(null), act = $state.raw<Activity | null>(null), existing = $state.raw<RehabCheck | null>(null);
  let loaded = $state(false);
  let date = $state(t), exercises = $state<string[]>([]), note = $state(''), pain = $state<number | null>(null);
  let criteria = $state<number[]>([]), cleared = $state(false);
  let lastNote = $state('');
  let result = $state.raw<RehabAssessment | null>(null);
  let err = $state(''), confirmDel = $state(false);

  $effect(() => {
    (async () => {
      const i = activeInjury(await db.injuries.toArray());
      inj = i;
      if (target.activityId) { act = (await db.activities.get(target.activityId)) ?? null; if (act) date = act.date; }
      const list = i?.rehab ?? [];
      const c = target.checkId ? list.find(x => x.id === target.checkId) : target.activityId ? list.find(x => x.activityId === target.activityId) : undefined;
      if (c) { existing = c; date = c.date; exercises = [...c.exercises]; note = c.note ?? ''; pain = c.painDuring; criteria = [...c.criteria]; cleared = !!c.cleared; }
      lastNote = [...list].reverse().find(x => x.note && x.id !== c?.id)?.note ?? '';
      loaded = true;
    })();
  });

  const stage = $derived(existing?.stage ?? inj?.stage ?? 0);
  const outage = $derived(inj ? isOutage(inj) : false);
  const crit = $derived(inj ? rehabCriteria({ region: inj.region, stage }) : []);
  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]);

  async function save(ignored = false) {
    if (!inj) return;
    if (!ignored && pain == null) { err = 'Bitte gib an, wie stark der Schmerz bei den Übungen war.'; return; }
    await saveRehabCheck(inj.id, { id: existing?.id, activityId: act?.id ?? existing?.activityId, date, stage,
      exercises: $state.snapshot(exercises), note: note.trim() || undefined, painDuring: ignored ? null : pain,
      criteria: outage ? [] : $state.snapshot(criteria), cleared: cleared || undefined, ignored: ignored || undefined });
    if (ignored) { closePhysio(); return; }
    const fresh = await db.injuries.get(inj.id);
    const morning: MorningEntry[] = await db.morning.where('date').between(addDays(t, -30), t, true, true).toArray();
    result = fresh ? assessRehab(fresh, morning, t) : null;
    inj = fresh ?? inj;
  }
  async function advance() { if (inj) await setStage(inj.id, inj.stage + 1, 'physio'); closePhysio(); }
  async function toStages() { if (inj) await switchToStages(inj.id); closePhysio(); }
  async function remove() { if (inj && existing) await deleteRehabCheck(inj.id, existing.id); closePhysio(); }
</script>

<div class="backdrop" role="presentation" onclick={closePhysio}></div>
<div class="sheet" use:swipeDismiss={closePhysio} role="dialog" aria-modal="true" aria-label="Physio-Einheit">
  <div class="grab"></div>
  {#if loaded && !inj}
    <h2 class="title">Physio-Einheit</h2>
    <p class="muted">Es ist keine Verletzung aktiv. Physio-Einheiten werden nur bewertet, solange du im Verletzungsmodus bist.</p>
    <div class="actions one"><button class="btn primary" onclick={closePhysio}>OK</button></div>
  {:else if inj && result}
    <h2 class="title">{result.status === 'bereit' ? 'Bereit für die nächste Stufe' : 'Gespeichert'}</h2>
    {#if result.status === 'bereit' && result.nextLabel}
      <p class="box ok">Die Reha-Ziele von Stufe {inj.stage + 1} sind in {result.qualifying} Einheit{result.qualifying > 1 ? 'en' : ''} erreicht, ohne Warnzeichen.
        Vorschlag: <b>Stufe {inj.stage + 2}: {result.nextLabel}</b>. Der Plan passt sich danach an.</p>
      <p class="muted small">Du entscheidest – eine Physio-Einheit allein ist kein Beweis, dass die Belastung schon passt.</p>
      <div class="actions"><button class="btn ghost" onclick={closePhysio}>Noch bleiben</button><button class="btn primary" onclick={advance}>Stufe {inj.stage + 2} freigeben</button></div>
    {:else if outage && cleared}
      <p class="box ok">Deine Physio hat die Rückkehr freigegeben. Du kannst jetzt in die Rückkehrstufen wechseln – dann steigt die Belastung schrittweise.</p>
      <div class="actions"><button class="btn ghost" onclick={closePhysio}>Später</button><button class="btn primary" onclick={toStages}>Rückkehrstufen starten</button></div>
    {:else}
      {#if result.status === 'keine'}<p class="muted">Die Einheit ist gespeichert.</p>
      {:else}
        <p class="box">{result.status === 'fast' ? 'Auf gutem Weg.' : 'Noch auf dieser Stufe bleiben.'}</p>
        <ul class="reasons">{#each result.reasons as r}<li>{r}</li>{/each}</ul>
      {/if}
      <p class="muted small">Du kannst die Stufe trotzdem jederzeit selbst in der Verletzungskarte ändern.</p>
      <div class="actions one"><button class="btn primary" onclick={closePhysio}>Fertig</button></div>
    {/if}
  {:else if inj}
    <h2 class="title">Physio-Einheit bewerten</h2>
    <p class="muted small">
      {#if act}{act.name || 'Physiotherapie'} · {fmtDay(act.date, { weekday: 'short', day: 'numeric', month: 'short' })}{act.duration ? ` · ${dur(act.duration)}` : ''} (aus Garmin)
      {:else}Manuell eingetragen{/if}
      · {outage ? 'ernste Verletzung' : `Stufe ${stage + 1}: ${STAGES[stage].label}`}
    </p>

    {#if !act}<section><label>Datum<input type="date" bind:value={date} max={t} min={inj.startDate} /></label></section>{/if}

    <section>
      <h3>Was hast du gemacht?</h3>
      <div class="chips">{#each EXERCISES as e}<button class:on={exercises.includes(e)} onclick={() => (exercises = toggle(exercises, e))}>{e}</button>{/each}</div>
      <label>Übungen (optional)<textarea bind:value={note} rows="2" placeholder={lastNote || 'z. B. Wadenheben einbeinig 3×15, Einbeinstand 3×30 s'}></textarea></label>
      {#if lastNote && !note}<button class="link" onclick={() => (note = lastNote)}>Wie beim letzten Mal übernehmen</button>{/if}
    </section>

    <section>
      <h3>Schmerz während der Übungen</h3>
      <div class="pain">{#each Array.from({ length: 11 }, (_, i) => i) as n}
        <button class:on={pain === n} class={n >= 7 ? 'hi' : n >= 4 ? 'mid' : 'lo'} onclick={() => (pain = n)} aria-label="Schmerz {n} von 10">{n}</button>{/each}</div>
      <p class="muted small">0 = kein Schmerz · bis 3 gilt als unbedenklich · ab 5 lieber nicht steigern</p>
    </section>

    {#if !outage}
      <section>
        <h3>Reha-Ziele von Stufe {stage + 1}</h3>
        <p class="muted small">Was hast du erreicht? Erst wenn alles passt (in 2 Einheiten, mit Freigabe der Physio in einer), schlägt die App die nächste Stufe vor.</p>
        {#each crit as c, i}
          <button class="check" class:on={criteria.includes(i)} onclick={() => (criteria = toggle(criteria, i))}><span class="box2">{criteria.includes(i) ? '✓' : ''}</span>{c}</button>
        {/each}
      </section>
    {/if}

    <section>
      <button class="check" class:on={cleared} onclick={() => (cleared = !cleared)}><span class="box2">{cleared ? '✓' : ''}</span>
        {outage ? 'Physio/Ärztin hat die Rückkehr ins Training freigegeben' : 'Physio hat den nächsten Schritt ausdrücklich freigegeben'}</button>
    </section>

    {#if err}<p class="error">{err}</p>{/if}
    <div class="actions">
      {#if existing && !confirmDel}<button class="btn ghost" onclick={() => (confirmDel = true)}>Löschen</button>
      {:else if confirmDel}<button class="btn ghost del" onclick={remove}>Wirklich?</button>
      {:else if act}<button class="btn ghost" onclick={() => save(true)}>Nicht bewerten</button>
      {:else}<button class="btn ghost" onclick={closePhysio}>Abbrechen</button>{/if}
      <button class="btn primary" onclick={() => save()}>Speichern</button>
    </div>
  {/if}
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 20; touch-action: none; }
  .sheet { position: fixed; left: 0; right: 0; bottom: 0; z-index: 21; max-height: calc(100% - env(safe-area-inset-top) - 12px); overflow-y: auto; overscroll-behavior: contain;
           background: var(--bg); border-radius: 26px 26px 0 0; padding: 8px 18px calc(env(safe-area-inset-bottom) + 16px); max-width: 640px; margin: 0 auto;
           animation: up .3s cubic-bezier(.2,.9,.3,1); }
  @keyframes up { from { transform: translateY(100%); } }
  .grab { width: 40px; height: 5px; border-radius: 3px; background: var(--line); margin: 4px auto 12px; }
  .title { font-size: 26px; margin: 0 0 4px; }
  .small { font-size: 13px; }
  section { background: var(--card); border-radius: 18px; padding: 14px 16px; margin: 10px 0; }
  h3 { margin: 4px 0 8px; font-size: 15px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chips button { border: 1px solid var(--line); background: var(--bg); color: var(--text); border-radius: 10px; padding: 8px 11px; font: inherit; font-size: 14px; cursor: pointer; min-height: 40px; }
  .chips button.on { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
  label { margin-top: 12px; }
  textarea { display: block; width: 100%; margin-top: 6px; padding: 12px; border-radius: 14px; border: 1px solid var(--line); background: var(--bg); color: var(--text); font: inherit; font-size: 16px; resize: vertical; }
  .link { background: none; border: none; color: var(--accent); font: inherit; font-size: 14px; font-weight: 600; padding: 8px 0 0; cursor: pointer; }
  .pain { display: grid; grid-template-columns: repeat(11, 1fr); gap: 3px; }
  .pain button { border: 1px solid var(--line); background: var(--bg); color: var(--text); border-radius: 8px; height: 38px; font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; padding: 0; }
  .pain button.on.lo { background: var(--green); border-color: var(--green); color: #fff; }
  .pain button.on.mid { background: var(--yellow); border-color: var(--yellow); color: #fff; }
  .pain button.on.hi { background: var(--red); border-color: var(--red); color: #fff; }
  .check { width: 100%; display: flex; gap: 12px; align-items: center; text-align: left; background: none; border: none; border-top: 1px solid var(--line);
           padding: 11px 0; font: inherit; font-size: 15px; color: var(--text); cursor: pointer; }
  section > .check:first-child, h3 + p + .check { border-top: none; }
  .box2 { width: 24px; height: 24px; border-radius: 7px; border: 2px solid var(--line); flex-shrink: 0; display: grid; place-items: center; font-weight: 800; font-size: 14px; color: #fff; }
  .check.on .box2 { background: var(--green); border-color: var(--green); }
  .box { background: var(--accent-soft); border-radius: 14px; padding: 12px 14px; font-size: 15px; line-height: 1.45; }
  .box.ok { background: color-mix(in srgb, var(--green) 18%, transparent); }
  .reasons { margin: 6px 0 10px; padding-left: 20px; font-size: 14px; line-height: 1.45; }
  .actions { display: grid; grid-template-columns: 1fr 2fr; gap: 10px; margin-top: 10px; }
  .actions.one { grid-template-columns: 1fr; }
  .del { color: var(--red); }
</style>
