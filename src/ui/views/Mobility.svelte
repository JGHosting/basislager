<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db } from '../../core/db';
  import { today, fmtDay, addDays } from '../../core/dates';
  import { GOALS, type GoalId } from '../../domain/mobility/library';
  import { getMobilitySettings, saveMobilitySettings, setPauseMode, type Intrusiveness, type MobilitySettings } from '../../domain/mobility/settings';
  import { todayLog, completion, currentStreak, DONE_THRESHOLD, excludedCount, rebuildToday, sigOf } from '../../domain/mobility/repo';
  import { TESTS, lastTest, testDue } from '../../domain/mobility/tests';
  import { activeInjury, STAGES } from '../../domain/injury/injury';
  import { app, startMobilityNow, openSelfTest } from '../app.svelte';

  const row = liveQuery(() => todayLog());
  const injury = liveQuery(async () => activeInjury(await db.injuries.toArray()));
  const settings = liveQuery(() => getMobilitySettings());
  const streak = liveQuery(() => currentStreak());
  const last = liveQuery(() => lastTest());
  const dueTest = liveQuery(async () => testDue((await getMobilitySettings()).testIntervalWeeks));

  const pct = $derived($row ? Math.round(completion($row) * 100) : 0);
  const isDone = $derived(pct / 100 >= DONE_THRESHOLD);

  // Entwurf: Ziele, Gewichte, Länge und Aufdringlichkeit werden erst mit "Routine aktualisieren" übernommen
  type Draft = Pick<MobilitySettings, 'goals' | 'minutes' | 'intrusiveness'>;
  const pick = (x: MobilitySettings): Draft => ({ goals: x.goals.map(g => ({ ...g })), minutes: x.minutes, intrusiveness: x.intrusiveness });
  let draft = $state<Draft | null>(null);
  $effect(() => { if (!draft && $settings) draft = pick($settings); });
  const dirty = $derived(!!draft && !!$settings && JSON.stringify(draft) !== JSON.stringify(pick($settings)));
  // Routine wurde noch mit älteren Einstellungen geplant
  const outdated = $derived(!!$row && $row.minutes > 0 && !!$settings && $row.sig !== sigOf($settings));
  let updated = $state(false);
  async function refresh() {
    if (draft) await saveMobilitySettings($state.snapshot(draft));
    await rebuildToday();
    draft = null;
    updated = true; setTimeout(() => (updated = false), 2500);
  }

  function weightOf(id: string) { return draft?.goals.find(g => g.id === id)?.weight ?? null; }
  function toggleGoal(id: GoalId) {
    if (!draft) return;
    draft.goals = draft.goals.some(g => g.id === id) ? draft.goals.filter(g => g.id !== id) : [...draft.goals, { id, weight: 2 }];
  }
  function setWeight(id: string, weight: 1 | 2 | 3) { if (draft) draft.goals = draft.goals.map(g => (g.id === id ? { ...g, weight } : g)); }
  async function togglePauseManual(on: boolean) { await setPauseMode(on, false); }

  const INTRUSIVENESS: { id: Intrusiveness; label: string }[] = [
    { id: 'aus', label: 'Aus' }, { id: 'sanft', label: 'Sanft' }, { id: 'hartnaeckig', label: 'Hartnäckig' }, { id: 'brutal', label: 'Brutal' }
  ];
</script>

<header class="page-head"><div><p class="eyebrow">{fmtDay(today(), { weekday: 'long', day: 'numeric', month: 'long' })}</p><h1>Mobility</h1></div></header>

<section class="card routine">
  <div class="row">
    <div>
      <h3>Heutige Routine</h3>
      {#if $injury && $injury.stage === 0}
        <p class="muted small">Pausenmodus aktiv – Verletzungsstufe „{STAGES[0].label}“.</p>
      {:else if isDone}
        <p class="muted small">Erledigt ({pct} %).</p>
      {:else if $row}
        <p class="muted small">{pct} % erledigt, {$settings?.minutes ?? 10} Minuten geplant.</p>
      {:else}
        <p class="muted small">Noch nicht gestartet, {$settings?.minutes ?? 10} Minuten geplant.</p>
      {/if}
    </div>
    <div class="streak"><b>{$streak ?? 0}</b><span>Tage Streak</span></div>
  </div>
  {#if $injury && $injury.stage > 0}
    <p class="inj small">Rücksicht auf deine Verletzung ({$injury.region}, Stufe „{STAGES[$injury.stage]?.label}“): {excludedCount($injury)} Übungen pausieren, sie werden automatisch ersetzt.</p>
  {/if}
  {#if !($injury && $injury.stage === 0)}
    <button class="btn primary wide" onclick={startMobilityNow}>{isDone ? 'Erneut durchführen' : $row ? 'Weiter' : 'Routine starten'}</button>
  {/if}
</section>

<h3 class="section">Ziele & Einstellungen</h3>
<section class="card">
  {#if draft}
    <p class="label first">Ziele</p>
    <div class="chips">
      {#each GOALS as g}<button class="chip" class:on={weightOf(g.id) != null} onclick={() => toggleGoal(g.id)}>{g.label}</button>{/each}
    </div>
    {#each draft.goals as g}
      {@const def = GOALS.find(x => x.id === g.id)}
      <div class="weight-row">
        <span>{def?.label}</span>
        <div class="seg w">
          {#each [1, 2, 3] as n}<button class:on={g.weight === n} onclick={() => setWeight(g.id, n as 1 | 2 | 3)}>{n}</button>{/each}
        </div>
      </div>
    {/each}
    <p class="label">Länge der Routine</p>
    <div class="seg n">
      {#each [5, 10, 15] as m}<button class:on={draft.minutes === m} onclick={() => (draft!.minutes = m as 5 | 10 | 15)}>{m} Min.</button>{/each}
    </div>
    <p class="label">Aufdringlichkeit</p>
    <div class="seg n4">
      {#each INTRUSIVENESS as o}<button class:on={draft.intrusiveness === o.id} onclick={() => (draft!.intrusiveness = o.id)}>{o.label}</button>{/each}
    </div>
  {/if}
  <button class="btn wide refresh" class:primary={dirty || outdated} class:ghost={!dirty && !outdated} onclick={refresh}>{updated ? 'Routine aktualisiert ✓' : 'Routine aktualisieren'}</button>
  {#if (dirty || outdated) && !updated}<p class="muted small hint">Änderungen sind noch nicht übernommen – „Routine aktualisieren“ speichert sie und plant die heutige Routine neu. Abgehakte Übungen bleiben.</p>{/if}
</section>

<h3 class="section">Selbsttest</h3>
<section class="card">
  {#if $last}
    <p>Zuletzt am {fmtDay($last.date)}{#if $settings} · nächster fällig am {fmtDay(addDays($last.date, $settings.testIntervalWeeks * 7))}{/if}</p>
  {:else}
    <p class="muted">Noch kein Test durchgeführt.</p>
  {/if}
  <button class="btn {$dueTest ? 'primary' : 'ghost'} wide" onclick={openSelfTest}>{$dueTest ? 'Test jetzt machen' : 'Test erneut machen'}</button>
  <p class="muted small hint">{TESTS.length} kurze Tests, alle {$settings?.testIntervalWeeks ?? 3} Wochen. Das Ergebnis steuert, welche Regionen mehr Übungen bekommen.</p>
</section>

<section class="card pause">
  <button class="btn wide {$settings?.pauseMode ? 'primary' : 'ghost'}" onclick={() => togglePauseManual(!$settings?.pauseMode)}>
    {$settings?.pauseMode ? 'Pausenmodus beenden' : 'Pausenmodus einschalten'}
  </button>
  <p class="muted small hint">{$settings?.pauseMode ? ($settings.pauseAuto ? 'Automatisch aktiv wegen Verletzungsstufe „Pause“. ' : 'Aktiv. ') : ''}Im Pausenmodus (Ruhetag, krank) gibt es keine Erinnerungen, die Streak bleibt erhalten.</p>
</section>

<style>
  .inj { color: var(--yellow); margin: 8px 0 10px; line-height: 1.4; }
  .routine .row { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 12px; }
  .routine h3 { margin: 0 0 2px; font-size: 16px; }
  .streak { text-align: right; flex-shrink: 0; }
  .streak b { font-size: 24px; font-weight: 750; display: block; line-height: 1; }
  .streak span { font-size: 11px; color: var(--muted); }
  .wide { width: 100%; }
  .small { font-size: 13px; }
  .muted { color: var(--muted); }
  .section { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); font-weight: 600; margin: 22px 4px 8px; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 4px; }
  .chip { border: 1px solid var(--line); background: var(--bg); color: var(--text); border-radius: 999px; padding: 8px 14px; font-size: 14px; font-weight: 600; cursor: pointer; }
  .chip.on { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
  .weight-row { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-top: 1px solid var(--line); }
  .weight-row span { flex: 1; font-size: 14px; }
  .seg { display: grid; background: var(--bg); border-radius: 10px; padding: 3px; }
  .seg.w { grid-template-columns: repeat(3, 1fr); width: 110px; }
  .seg.n { grid-template-columns: repeat(3, 1fr); margin: 6px 0 14px; }
  .seg.n4 { grid-template-columns: repeat(4, 1fr); margin: 6px 0 14px; }
  .seg button { border: none; background: none; font: inherit; font-size: 14px; font-weight: 600; color: var(--muted); padding: 8px 2px; border-radius: 8px; cursor: pointer; }
  .seg button.on { background: var(--accent); color: #fff; }
  .refresh { margin-top: 16px; }
  .pause { margin-top: 22px; }
  .hint { margin: 10px 0 0; }
  .label { margin: 14px 0 0; font-size: 14px; color: var(--muted); }
  .label:first-child { margin-top: 0; }
</style>
