<script lang="ts">
  import { db, type MuscleGroup, type SplitTemplate, type Activity } from '../../core/db';
  import { today, fmtDay } from '../../core/dates';
  import { GROUPS, nextSplitDay, groupLabel } from '../../domain/strength/strength';
  import { activeSplit, sessionFor, saveSession, deleteSession } from '../../domain/strength/repo';
  import { app, closeStrength } from '../app.svelte';
  import { dur } from '../format';

  const target = app.strengthEdit!;
  let act = $state<Activity | null>(null);
  let split = $state<SplitTemplate | null>(null);
  let suggestion = $state<MuscleGroup[] | null>(null);
  let sessionId = $state<string | undefined>(undefined);
  let date = $state(target.date ?? today());
  let groups = $state<MuscleGroup[]>([]);
  let intensity = $state<number | null>(null);
  let saving = $state(false);
  let confirmDel = $state(false);
  let error = $state('');

  $effect(() => {
    (async () => {
      if (target.activityId) { act = (await db.activities.get(target.activityId)) ?? null; if (act) date = act.date; }
      const s = await sessionFor(target);
      if (s) { sessionId = s.id; groups = [...s.muscleGroups]; intensity = s.intensity; date = s.date; }
      split = await activeSplit();
      if (split) {
        const others = (await db.strength.toArray()).filter(x => x.id !== s?.id && x.date <= date);
        suggestion = nextSplitDay(split, others).groups;
        if (!s) groups = [...suggestion];
      }
    })();
  });

  function toggle(g: MuscleGroup) {
    if (g === 'ganzkoerper') { groups = groups.includes(g) ? [] : ['ganzkoerper']; return; }
    const rest = groups.filter(x => x !== 'ganzkoerper');
    groups = rest.includes(g) ? rest.filter(x => x !== g) : [...rest, g];
  }
  const same = (a: MuscleGroup[], b: MuscleGroup[]) => a.length === b.length && a.every(x => b.includes(x));

  async function save(skipped = false) {
    saving = true; error = '';
    try {
      // $state.snapshot: reine Daten statt Svelte-Proxy (IndexedDB kann Proxys nicht speichern)
      await saveSession({ id: sessionId, activityId: target.activityId, date, muscleGroups: skipped ? [] : $state.snapshot(groups), intensity: skipped ? null : intensity, skipped });
      closeStrength();
    } catch (e) { error = 'Speichern fehlgeschlagen: ' + ((e as Error)?.message ?? String(e)); console.error(e); }
    saving = false;
  }
  async function remove() { if (sessionId) await deleteSession(sessionId); closeStrength(); }
  const LEVEL = ['', 'sehr locker', 'locker', 'locker', 'moderat', 'moderat', 'fordernd', 'fordernd', 'hart', 'sehr hart', 'maximal'];
</script>

<div class="backdrop" role="presentation" onclick={closeStrength}></div>
<div class="sheet" role="dialog" aria-modal="true" aria-label="Krafttraining">
  <div class="grab"></div>
  <p class="eyebrow">{fmtDay(date, { weekday: 'long', day: 'numeric', month: 'long' })}{act ? ' · ' + dur(act.duration ?? act.elapsed) : ''}</p>
  <h2 class="title">Krafttraining</h2>

  {#if !target.activityId}
    <section><label>Datum<input type="date" bind:value={date} max={today()} /></label></section>
  {/if}

  {#if split}
    <section>
      <h3>{split.name}</h3>
      <div class="days">
        {#each split.days as d, i}
          <button class:on={same(groups, d)} onclick={() => (groups = [...d])}>
            <small>Tag {i + 1}{suggestion && same(d, suggestion) ? ' · dran' : ''}</small>
            <b>{d.map(groupLabel).join(' + ')}</b>
          </button>
        {/each}
      </div>
    </section>
  {/if}

  <section>
    <h3>Muskelgruppen</h3>
    <div class="chips">
      {#each GROUPS as g}
        <button class:on={groups.includes(g.id)} onclick={() => toggle(g.id)}>
          <b>{g.label}</b><small>{g.hint}</small>
        </button>
      {/each}
    </div>
  </section>

  <section>
    <h3>Gefühlte Intensität {#if intensity}<span class="lvl">{intensity}/10 · {LEVEL[intensity]}</span>{/if}</h3>
    <div class="scale">
      {#each Array.from({ length: 10 }, (_, i) => i + 1) as n}
        <button class:on={intensity === n} class:lo={n <= 4} class:hi={n >= 8} onclick={() => (intensity = n)}>{n}</button>
      {/each}
    </div>
  </section>

  {#if error}<p class="error">{error}</p>{/if}
  <div class="actions">
    {#if target.activityId && !sessionId}
      <button class="btn ghost" onclick={() => save(true)} disabled={saving}>Kein Kraft</button>
    {:else if sessionId && !confirmDel}
      <button class="btn ghost" onclick={() => (confirmDel = true)}>Löschen</button>
    {:else if confirmDel}
      <button class="btn ghost del" onclick={remove}>Wirklich?</button>
    {:else}
      <button class="btn ghost" onclick={closeStrength}>Abbrechen</button>
    {/if}
    <button class="btn primary" onclick={() => save()} disabled={saving || !groups.length}>Speichern</button>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 20; touch-action: none; animation: fade .2s; }
  .sheet { position: fixed; left: 0; right: 0; bottom: 0; z-index: 21; max-height: 92%; overflow-y: auto; overscroll-behavior: contain;
           background: var(--bg); border-radius: 26px 26px 0 0; padding: 8px 20px calc(env(safe-area-inset-bottom) + 16px);
           max-width: 640px; margin: 0 auto; animation: up .3s cubic-bezier(.2,.9,.3,1); }
  @keyframes up { from { transform: translateY(100%); } }
  @keyframes fade { from { opacity: 0; } }
  .grab { width: 40px; height: 5px; border-radius: 3px; background: var(--line); margin: 4px auto 14px; }
  .eyebrow { margin: 0; color: var(--muted); font-size: 14px; }
  .title { font-size: 28px; margin: 2px 0 10px; letter-spacing: -0.02em; }
  section { background: var(--card); border-radius: 18px; padding: 14px 16px; margin-bottom: 10px; }
  h3 { margin: 0 0 10px; font-size: 15px; font-weight: 650; display: flex; justify-content: space-between; }
  .lvl { font-weight: 500; color: var(--accent); font-size: 14px; }
  label { margin: 0; color: var(--muted); }
  .days { display: grid; grid-template-columns: repeat(auto-fit, minmax(90px, 1fr)); gap: 8px; }
  .days button, .chips button { border: 1px solid var(--line); background: var(--bg); color: var(--text); border-radius: 14px; padding: 10px 12px;
           text-align: left; font: inherit; display: flex; flex-direction: column; gap: 2px; cursor: pointer; min-height: 48px; }
  .days small, .chips small { font-size: 12px; color: var(--muted); }
  .days button.on, .chips button.on { border-color: var(--accent); background: var(--accent-soft); }
  .days button.on b, .chips button.on b { color: var(--accent); }
  .chips { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .chips button:last-child { grid-column: 1 / -1; }
  .scale { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; }
  .scale button { height: 46px; border-radius: 12px; border: 1px solid var(--line); background: var(--bg); color: var(--text); font: inherit; font-size: 17px; font-weight: 650; cursor: pointer; }
  .scale button.on { background: var(--accent); border-color: var(--accent); color: #fff; }
  .actions { display: grid; grid-template-columns: 1fr 2fr; gap: 10px; margin-top: 6px; }
  .del { color: var(--red); }
</style>
