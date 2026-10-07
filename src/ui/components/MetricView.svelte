<script lang="ts">
  /**
   * Wiederverwendbare Komponente: Kennzahl + Zeitraum + Umschalter Grafik/Tabelle + CSV.
   * Bekommt die Definition und den Kontext und rechnet selbst.
   */
  import type { MetricDef, StatsContext, Range } from '../../domain/stats/metrics';
  import { snowDays } from '../../domain/stats/metrics';
  import { fmtDay } from '../../core/dates';
  import { toCsv, shareFile } from '../../backup/backup';
  import UChart from './UChart.svelte';

  let { def, ctx, range }: { def: MetricDef; ctx: StatsContext; range: Range } = $props();
  let view = $state<'chart' | 'table'>('chart');
  let hover = $state<number | null>(null);

  const res = $derived(def.compute(ctx, range));
  const markers = $derived(range.bucket === 'month' ? [] : snowDays(ctx, range));
  const hasData = $derived(res.series.some(s => s.values.some(v => v != null && v !== 0)));

  const fmt = (v: number | null | undefined) => {
    if (v == null) return '–';
    if (def.unit === 'min/km') return `${Math.floor(v)}:${String(Math.round((v % 1) * 60)).padStart(2, '0')}`;
    return v.toLocaleString('de-DE', { maximumFractionDigits: def.digits, minimumFractionDigits: v < 10 && def.digits ? def.digits : 0 });
  };
  const label = (d: string) => range.bucket === 'day' ? fmtDay(d, { weekday: 'short', day: '2-digit', month: '2-digit' })
    : range.bucket === 'week' ? 'Woche ab ' + fmtDay(d, { day: '2-digit', month: '2-digit', year: '2-digit' })
    : fmtDay(d, { month: 'long', year: 'numeric' });
  const delta = $derived.by(() => {
    const { value, prev } = res.summary;
    if (value == null || prev == null || prev === 0) return null;
    if (Math.abs((value - prev) / prev) < 0.005) return 0;
    return ((value - prev) / Math.abs(prev)) * 100;
  });
  const hoverText = $derived.by(() => {
    if (hover == null) return null;
    if (res.stacked) {
      const tot = res.series.reduce((t, s) => t + (s.values[hover!] ?? 0), 0);
      return `${label(res.x[hover])}: ${fmt(tot)} ${def.unit} gesamt`;
    }
    if (res.series.length !== 1 && !res.series.some(s => s.kind === 'points')) return null;
    const v = res.series[0].values[hover];
    return `${label(res.x[hover])}: ${fmt(v)} ${v != null ? def.unit : ''}`;
  });

  async function csv() {
    const rows = res.x.map((d, i) => Object.fromEntries([['Zeitraum', d], ...res.series.map(s => [s.label + (def.unit ? ` (${def.unit})` : ''), s.values[i]])]));
    await shareFile(toCsv(rows, Object.keys(rows[0] ?? { Zeitraum: '' })), `basislager-${def.id}-${range.from}_${range.to}.csv`, 'text/csv');
  }
</script>

<section class="card metric">
  <header>
    <div>
      <h2>{def.title}</h2>
      {#if hoverText}
        <p class="sum hov">{hoverText}</p>
      {:else}
        <p class="sum">
          <span class="muted">{res.summary.label}</span>
          <b>{fmt(res.summary.value)}</b>{#if res.summary.value != null && def.unit}<small> {def.unit}</small>{/if}
          {#if delta != null}
            <span class="delta" class:good={res.summary.better !== 0 && delta * res.summary.better >= 1} class:bad={res.summary.better !== 0 && delta * res.summary.better <= -1}>
              {delta > 0 ? '+' : ''}{Math.round(delta)} % zum Vorzeitraum
            </span>
          {/if}
        </p>
      {/if}
    </div>
    <div class="seg" role="tablist" aria-label="Ansicht">
      <button class:on={view === 'chart'} onclick={() => (view = 'chart')} aria-label="Grafik">
        <svg viewBox="0 0 20 20"><path d="M3 16V9 M8 16V4 M13 16v-5 M18 16V7" /></svg>
      </button>
      <button class:on={view === 'table'} onclick={() => (view = 'table')} aria-label="Tabelle">
        <svg viewBox="0 0 20 20"><path d="M3 5h14 M3 10h14 M3 15h14" /></svg>
      </button>
    </div>
  </header>

  {#if !hasData}
    <p class="muted empty">Keine Daten im Zeitraum.</p>
  {:else if view === 'chart'}
    <UChart result={res} bucket={range.bucket} unit={def.unit} digits={def.digits} {markers} onhover={i => (hover = i)} />
  {:else}
    <div class="tablewrap">
      <table>
        <thead><tr><th>{range.bucket === 'day' ? 'Tag' : range.bucket === 'week' ? 'Woche' : 'Monat'}</th>
          {#each res.series as s}<th>{s.label}</th>{/each}</tr></thead>
        <tbody>
          {#each res.x.map((d, i) => ({ d, i })).reverse() as row}
            <tr><td>{label(row.d)}</td>{#each res.series as s}<td>{fmt(s.values[row.i])}</td>{/each}</tr>
          {/each}
        </tbody>
      </table>
    </div>
    <button class="csv" onclick={csv}>Als CSV teilen</button>
  {/if}
</section>

<style>
  header { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; margin-bottom: 6px; }
  h2 { margin: 0; }
  .sum { margin: 2px 0 0; font-size: 14px; display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 6px; min-height: 22px; }
  .sum b { font-size: 18px; font-variant-numeric: tabular-nums; }
  .sum small { color: var(--muted); }
  .hov { color: var(--text); font-weight: 600; font-variant-numeric: tabular-nums; }
  .delta { font-size: 12px; color: var(--muted); }
  .delta.good { color: var(--green); } .delta.bad { color: var(--red); }
  .seg { display: flex; background: var(--bg); border-radius: 10px; padding: 3px; flex-shrink: 0; }
  .seg button { border: none; background: none; width: 38px; height: 32px; border-radius: 8px; color: var(--muted); cursor: pointer; display: grid; place-items: center; }
  .seg button.on { background: var(--card); color: var(--text); box-shadow: 0 1px 2px rgba(0,0,0,.12); }
  .seg svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
  .empty { padding: 24px 0; text-align: center; }
  .tablewrap { max-height: 280px; overflow-y: auto; margin-top: 6px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; font-variant-numeric: tabular-nums; }
  th { position: sticky; top: 0; background: var(--card); text-align: left; color: var(--muted); font-weight: 500; padding: 6px 4px; font-size: 12px; }
  td { padding: 8px 4px; border-top: 1px solid var(--line); }
  td:not(:first-child), th:not(:first-child) { text-align: right; }
  .csv { margin-top: 10px; background: none; border: none; color: var(--accent); font: inherit; font-weight: 600; font-size: 14px; padding: 6px 0; cursor: pointer; }
</style>
