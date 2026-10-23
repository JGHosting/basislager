<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db } from '../../core/db';
  import { today } from '../../core/dates';
  import { LIBRARY, REGIONS, byId, type Region } from '../../domain/mobility/library';
  import { isUnlocked, prereqsOf, MAX_STEP, type ProgressMap } from '../../domain/mobility/progression';
  import { getMobilitySettings } from '../../domain/mobility/settings';
  import { dayStates, totals, testSeries, type DayState } from '../../domain/mobility/history';

  const MON = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  /* ---------- Kalender ---------- */
  const now = new Date();
  let ym = $state({ y: now.getFullYear(), m: now.getMonth() });
  const isCurrent = $derived(ym.y === now.getFullYear() && ym.m === now.getMonth());
  function shift(n: number) { const d = new Date(ym.y, ym.m + n, 1); ym = { y: d.getFullYear(), m: d.getMonth() }; }
  let states = $state<Record<string, DayState>>({});
  $effect(() => {
    const { y, m } = ym;
    const last = new Date(y, m + 1, 0).getDate();
    const sub = liveQuery(() => dayStates(iso(y, m, 1), iso(y, m, last))).subscribe(v => (states = v));
    return () => sub.unsubscribe();
  });
  const cells = $derived.by(() => {
    const first = (new Date(ym.y, ym.m, 1).getDay() + 6) % 7;   // Montag = 0
    const days = new Date(ym.y, ym.m + 1, 0).getDate();
    return [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)] as (number | null)[];
  });
  const td = today();

  /* ---------- Kennzahlen, Tests, Fortschritt ---------- */
  const sums = liveQuery(() => totals());
  const tests = liveQuery(() => testSeries());
  const progress = liveQuery(async () => new Map((await db.mobilityProgress.toArray()).map(r => [r.exerciseId, r])) as ProgressMap);
  const level = liveQuery(async () => (await getMobilitySettings()).level);
  const unlockedCount = $derived($progress ? LIBRARY.filter(e => isUnlocked(e, $progress, $level ?? 0)).length : 0);

  let region = $state<Region>('hüfte');
  let showAll = $state(false);
  const list = $derived.by(() => {
    const p = $progress ?? new Map();
    return LIBRARY.filter(e => e.regions[0] === region || (showAll && e.regions.includes(region)))
      .map(e => {
        const r = p.get(e.id);
        const open = isUnlocked(e, p, $level ?? 0);
        const pre = prereqsOf(e.id).map(id => byId(id)?.name).filter(Boolean) as string[];
        const fresh = !!r?.unlockedAt && r.unlockedAt >= addDaysLocal(td, -7);
        return { e, step: r?.step ?? 0, total: r?.total ?? 0, open, pre, fresh, hard: !!r?.hard };
      })
      .sort((a, b) => a.e.difficulty - b.e.difficulty || Number(b.open) - Number(a.open) || a.e.name.localeCompare(b.e.name));
  });
  function addDaysLocal(d: string, n: number) { const [y, m, dd] = d.split('-').map(Number); const t = new Date(y, m - 1, dd + n); return iso(t.getFullYear(), t.getMonth(), t.getDate()); }

  /* Sparkline je Region (0–1) */
  function spark(values: (number | null)[]): string {
    const pts = values.map((v, i) => (v == null ? null : [values.length === 1 ? 50 : (i / (values.length - 1)) * 100, 28 - v * 24] as const)).filter(Boolean) as [number, number][];
    return pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  }
  const lastVal = (v: (number | null)[]) => [...v].reverse().find(x => x != null) ?? null;
  const firstVal = (v: (number | null)[]) => v.find(x => x != null) ?? null;
  const DIFF = ['leicht', 'mittel', 'schwer'];
</script>

<section class="card">
  <div class="stats">
    <div><b>{$sums?.daysDone ?? 0}</b><span>Tage erledigt</span></div>
    <div><b>{$sums?.minutes ?? 0}</b><span>Minuten</span></div>
    <div><b>{$sums?.bestStreak ?? 0}</b><span>beste Serie</span></div>
    <div><b>{unlockedCount}<small>/{LIBRARY.length}</small></b><span>Übungen frei</span></div>
  </div>

  <div class="calhead">
    <button class="nav" onclick={() => shift(-1)} aria-label="Voriger Monat">‹</button>
    <span>{MON[ym.m]} {ym.y}</span>
    <button class="nav" onclick={() => shift(1)} disabled={isCurrent} aria-label="Nächster Monat">›</button>
  </div>
  <div class="cal">
    {#each ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'] as w}<span class="wd">{w}</span>{/each}
    {#each cells as d}
      {#if d == null}<span></span>
      {:else}
        {@const key = iso(ym.y, ym.m, d)}
        <span class="day {states[key] ?? ''}" class:today={key === td} class:future={key > td}>{d}</span>
      {/if}
    {/each}
  </div>
  <div class="legend">
    <span><i class="dot done"></i>erledigt</span><span><i class="dot partial"></i>angefangen</span><span><i class="dot paused"></i>Pause</span>
  </div>
</section>

{#if $tests && $tests.dates.length}
  <h3 class="section">Selbsttest-Verlauf</h3>
  <section class="card">
    {#each $tests.regions as r}
      {@const a = firstVal(r.values)}
      {@const b = lastVal(r.values)}
      <div class="trow">
        <span class="tl">{r.label}</span>
        <svg viewBox="-4 0 108 32" preserveAspectRatio="none" class="spark" aria-hidden="true">
          <line x1="0" x2="100" y1="28" y2="28" class="base" />
          <path d={spark(r.values)} class="ln" />
          {#each r.values as v, i}{#if v != null}<circle cx={r.values.length === 1 ? 50 : (i / (r.values.length - 1)) * 100} cy={28 - v * 24} r="2.4" class="pt" />{/if}{/each}
        </svg>
        <span class="tv">{b != null ? Math.round(b * 100) + ' %' : '–'}
          {#if a != null && b != null && $tests.dates.length > 1}<small class:up={b > a} class:down={b < a}>{b > a ? '▲' : b < a ? '▼' : '='}</small>{/if}
        </span>
      </div>
    {/each}
    <p class="muted small hint">{$tests.dates.length} {$tests.dates.length === 1 ? 'Test' : 'Tests'} · 100 % = volle Beweglichkeit im jeweiligen Test.</p>
  </section>
{/if}

<h3 class="section">Übungen & Stufen</h3>
<section class="card">
  <div class="chips">
    {#each REGIONS as r}<button class="chip" class:on={region === r.id} onclick={() => (region = r.id)}>{r.label.split(' / ')[0]}</button>{/each}
  </div>
  {#each list as it (it.e.id)}
    <div class="ex" class:locked={!it.open}>
      <div class="exmain">
        <span class="exname">{it.open ? '' : '🔒 '}{it.e.name}{#if it.fresh}<em class="new">neu</em>{/if}</span>
        <span class="exsub">{DIFF[it.e.difficulty]}{#if it.open} · {it.total}× gemacht{#if it.hard} · zuletzt zu schwer{/if}{:else if it.pre.length} · frei, wenn „{it.pre[0]}“ sitzt{:else} · frei, wenn eine leichtere Übung der Region sitzt{/if}</span>
      </div>
      {#if it.open}<span class="lvl">{#each Array(MAX_STEP + 1) as _, i}<i class:on={i <= it.step}></i>{/each}</span>{/if}
    </div>
  {/each}
  <button class="btn ghost wide more" onclick={() => (showAll = !showAll)}>{showAll ? 'Nur Hauptregion' : 'Auch Übungen, die die Region mittrainieren'}</button>
  <p class="muted small hint">Nach 3 bestätigten Durchgängen steigt die Stufe einer Übung (längeres Halten / mehr Wiederholungen). Ab Stufe 2 („sitzt“) wird die nächste schwerere Variante freigeschaltet. „Zu leicht“ / „Zu schwer“ nach einer Übung wirkt sofort.</p>
</section>

<style>
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; text-align: center; margin-bottom: 14px; }
  .stats b { display: block; font-size: 22px; font-weight: 750; line-height: 1.1; }
  .stats small { font-size: 13px; color: var(--muted); font-weight: 600; }
  .stats span { font-size: 11px; color: var(--muted); }
  .calhead { display: flex; align-items: center; justify-content: space-between; margin: 4px 0 8px; font-weight: 700; }
  .nav { width: 36px; height: 36px; border-radius: 50%; border: none; background: var(--bg); color: var(--text); font-size: 20px; cursor: pointer; }
  .nav:disabled { opacity: .3; }
  .cal { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; text-align: center; }
  .wd { font-size: 11px; color: var(--muted); font-weight: 600; padding-bottom: 2px; }
  .day { aspect-ratio: 1; display: grid; place-items: center; border-radius: 50%; font-size: 13px; font-variant-numeric: tabular-nums; max-width: 40px; margin: 0 auto; width: 100%; }
  .day.done { background: var(--accent); color: #fff; font-weight: 700; }
  .day.partial { box-shadow: inset 0 0 0 2px var(--accent); color: var(--accent); font-weight: 600; }
  .day.paused, .day.skipped { color: var(--muted); background: var(--bg); }
  .day.today { outline: 2px solid var(--text); outline-offset: 1px; }
  .day.future { opacity: .35; }
  .legend { display: flex; gap: 14px; justify-content: center; margin-top: 10px; font-size: 12px; color: var(--muted); }
  .legend span { display: flex; align-items: center; gap: 5px; }
  .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
  .dot.done { background: var(--accent); }
  .dot.partial { box-shadow: inset 0 0 0 2px var(--accent); }
  .dot.paused { background: var(--line); }
  .section { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); font-weight: 600; margin: 22px 4px 8px; }
  .trow { display: grid; grid-template-columns: 1fr 90px 64px; align-items: center; gap: 10px; padding: 8px 0; border-top: 1px solid var(--line); }
  .trow:first-child { border-top: none; padding-top: 0; }
  .tl { font-size: 14px; }
  .spark { width: 90px; height: 32px; overflow: visible; }
  .spark .base { stroke: var(--line); stroke-width: 1; vector-effect: non-scaling-stroke; }
  .spark .ln { fill: none; stroke: var(--accent); stroke-width: 2; vector-effect: non-scaling-stroke; }
  .spark .pt { fill: var(--accent); }
  .tv { text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; }
  .tv small { font-size: 11px; color: var(--muted); margin-left: 3px; }
  .tv small.up { color: var(--green); }
  .tv small.down { color: var(--yellow); }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
  .chip { border: 1px solid var(--line); background: var(--bg); color: var(--text); border-radius: 999px; padding: 6px 12px; font-size: 13px; font-weight: 600; cursor: pointer; }
  .chip.on { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
  .ex { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-top: 1px solid var(--line); }
  .ex.locked .exname { color: var(--muted); }
  .exmain { flex: 1; min-width: 0; }
  .exname { display: block; font-size: 15px; font-weight: 600; }
  .exsub { display: block; font-size: 12px; color: var(--muted); margin-top: 2px; }
  .new { font-style: normal; font-size: 11px; font-weight: 700; color: #fff; background: var(--accent); border-radius: 6px; padding: 1px 6px; margin-left: 6px; vertical-align: 2px; }
  .lvl { display: flex; gap: 3px; flex-shrink: 0; }
  .lvl i { width: 7px; height: 7px; border-radius: 50%; background: var(--line); }
  .lvl i.on { background: var(--accent); }
  .wide { width: 100%; }
  .more { margin-top: 10px; }
  .small { font-size: 13px; }
  .muted { color: var(--muted); }
  .hint { margin: 10px 0 0; line-height: 1.4; }
</style>
