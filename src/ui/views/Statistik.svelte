<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db, getSetting, setSetting } from '../../core/db';
  import { today } from '../../core/dates';
  import { hrProfile } from '../../domain/load/load';
  import { METRICS, PERIODS, rangeFor, buildContext, type Period } from '../../domain/stats/metrics';
  import MetricView from '../components/MetricView.svelte';

  // Daten einmal laden; liveQuery rechnet bei neuen Daten automatisch neu
  const ctxQ = liveQuery(async () => {
    const [acts, morning, mMax, mRest, strength, goal, foodlog, ndays, kcalGoal] = await Promise.all([
      db.activities.toArray(), db.morning.orderBy('date').toArray(), getSetting<number | null>('hrMax'), getSetting<number | null>('hrRest'),
      db.strength.toArray(), getSetting<number | null>('goalWeight'), db.foodlog.toArray(), db.nutritionDays.toArray(), getSetting<number | null>('kcalGoal')
    ]);
    const hr = hrProfile(acts, morning.filter(m => m.restingHr != null).map(m => m.restingHr!), { max: mMax, rest: mRest }, today());
    return buildContext(acts, morning, hr, strength, goal ?? null, foodlog, ndays, kcalGoal ?? null);
  });

  const DEFAULT_SHOWN = ['belastung', 'zeit', 'verteilung', 'muskeln', 'hrv', 'ruhepuls', 'sleepscore', 'gewicht'];
  let period = $state<Period>('monat');
  let shown = $state<string[]>(DEFAULT_SHOWN);
  let picking = $state(false);
  getSetting<Period>('statsPeriod').then(p => p && (period = p));
  getSetting<string[]>('statsShown').then(s => s && (shown = s));

  const earliest = $derived($ctxQ?.activities.reduce<string | undefined>((m, a) => (!m || a.date < m ? a.date : m), undefined));
  const range = $derived(rangeFor(period, earliest));
  // Reihenfolge = Reihenfolge in 'shown' (vom Nutzer sortierbar)
  const visible = $derived(shown.map(id => METRICS.find(m => m.id === id)).filter((m): m is (typeof METRICS)[number] => !!m));

  function setPeriod(p: Period) { period = p; void setSetting('statsPeriod', p); }
  function toggle(id: string) {
    shown = shown.includes(id) ? shown.filter(x => x !== id) : [...shown, id];   // neu gewählte kommen ans Ende
    void setSetting('statsShown', $state.snapshot(shown));
  }
  function move(id: string, dir: -1 | 1) {
    const i = shown.indexOf(id), j = i + dir;
    if (i < 0 || j < 0 || j >= shown.length) return;
    const next = [...shown]; [next[i], next[j]] = [next[j], next[i]]; shown = next;
    void setSetting('statsShown', $state.snapshot(shown));
  }
  const GROUPS = { training: 'Training', erholung: 'Erholung', koerper: 'Körper', ernaehrung: 'Ernährung' } as const;
</script>

<header class="page-head"><div><h1>Statistik</h1></div>
  <button class="pick" onclick={() => (picking = !picking)}>{picking ? 'Fertig' : 'Kennzahlen'}</button>
</header>

<div class="periods" role="tablist" aria-label="Zeitraum">
  {#each PERIODS as p}
    <button role="tab" aria-selected={period === p.id} class:on={period === p.id} onclick={() => setPeriod(p.id)}>{p.label}</button>
  {/each}
</div>

{#if picking}
  <section class="card chooser">
    <p class="muted small">Wähle unten aus, was angezeigt wird, und sortiere mit den Pfeilen. Gewählte Kennzahlen liegen untereinander auf derselben Zeitachse. Tippst du in ein Diagramm, zeigen alle denselben Tag.</p>
    {#if visible.length > 1}
      <h3>Reihenfolge</h3>
      <ol class="order">
        {#each visible as m, i (m.id)}
          <li>
            <span>{m.title}</span>
            <button aria-label="{m.title} nach oben" disabled={i === 0} onclick={() => move(m.id, -1)}>
              <svg viewBox="0 0 20 20"><path d="M5 12l5-5 5 5" /></svg></button>
            <button aria-label="{m.title} nach unten" disabled={i === visible.length - 1} onclick={() => move(m.id, 1)}>
              <svg viewBox="0 0 20 20"><path d="M5 8l5 5 5-5" /></svg></button>
          </li>
        {/each}
      </ol>
    {/if}
    {#each Object.entries(GROUPS) as [g, gl]}
      <h3>{gl}</h3>
      <div class="chips">
        {#each METRICS.filter(m => m.group === g) as m}
          <button class:on={shown.includes(m.id)} onclick={() => toggle(m.id)}>{m.title}</button>
        {/each}
      </div>
    {/each}
  </section>
{/if}

{#if !$ctxQ}
  <p class="muted">Lade …</p>
{:else}
  {#each visible as def (def.id)}
    <MetricView {def} ctx={$ctxQ} {range} />
  {/each}
  {#if !visible.length}<p class="muted">Keine Kennzahl gewählt. Tippe oben auf „Kennzahlen“.</p>{/if}
  <p class="muted small foot">Rosa hinterlegt: Schneetage. Ernährung: nicht getrackte Tage und Tage ohne Einträge bleiben leer. Schmerzverlauf und Ereignisse wie Verletzung, Wettkampf oder Urlaub kommen mit den jeweiligen Bausteinen dazu.</p>
{/if}

<style>
  .pick { background: var(--card); border: none; color: var(--accent); font: inherit; font-weight: 600; font-size: 15px; padding: 8px 14px; border-radius: 99px; cursor: pointer; }
  .periods { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; background: var(--card); border-radius: 14px; padding: 4px; margin-bottom: 12px; }
  .periods button { border: none; background: none; font: inherit; font-size: 14px; font-weight: 600; color: var(--muted); padding: 9px 0; border-radius: 10px; cursor: pointer; }
  .periods button.on { background: var(--accent); color: #fff; }
  .chooser h3 { font-size: 13px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); margin: 14px 0 8px; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; }
  .chips button { border: 1px solid var(--line); background: var(--bg); color: var(--text); font: inherit; font-size: 14px; padding: 8px 12px; border-radius: 99px; cursor: pointer; }
  .chips button.on { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); font-weight: 600; }
  .small { font-size: 13px; }
  .order { list-style: none; margin: 0; padding: 0; }
  .order li { display: flex; align-items: center; gap: 6px; padding: 6px 0; border-top: 1px solid var(--line); }
  .order li:first-child { border-top: none; }
  .order span { flex: 1; font-size: 15px; }
  .order button { width: 44px; height: 40px; border-radius: 10px; border: 1px solid var(--line); background: var(--bg); color: var(--text); display: grid; place-items: center; cursor: pointer; }
  .order button:disabled { opacity: .3; }
  .order svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
  .legend { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; margin: 0 4px 10px; }
  .snow { width: 14px; height: 10px; border-radius: 2px; background: var(--c-snow); opacity: .35; }
  .fam { width: 10px; height: 10px; border-radius: 3px; margin-left: 6px; }
  .foot { margin: 14px 4px; }
</style>
