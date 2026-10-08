<script lang="ts">
  /** Muskelgruppen als Raster: Zeile = Gruppe, Spalte = Zeitraum. Gefüllt = trainiert (dunkler = öfter). */
  import type { MetricResult } from '../../domain/stats/metrics';
  import type { Bucket } from '../../domain/stats/metrics';
  import { fmtDay } from '../../core/dates';

  let { result, bucket }: { result: MetricResult; bucket: Bucket } = $props();

  const rows = $derived(result.series.map(s => ({ ...s, total: s.values.reduce((a: number, b) => a + (b ?? 0), 0) })));
  let sel = $state<number | null>(null);

  const colLabel = (d: string) => bucket === 'day' ? fmtDay(d, { day: '2-digit', month: '2-digit' })
    : bucket === 'week' ? 'Woche ab ' + fmtDay(d, { day: '2-digit', month: '2-digit' })
    : fmtDay(d, { month: 'long', year: 'numeric' });
  // Wenige Zeitmarken unter dem Raster (Anfang, Mitte, Ende)
  const axisTicks = $derived.by(() => {
    const n = result.x.length; if (!n) return [];
    const idx = [...new Set([0, Math.floor(n / 2), n - 1])];
    return idx.map(i => colLabel(result.x[i]).replace('Woche ab ', ''));
  });
  const op = (v: number | null) => (!v ? 0 : v >= 3 ? 1 : v >= 2 ? 0.75 : 0.5);
</script>

<div class="grid" style="--cols: {result.x.length}">
  {#each rows as r}
    <div class="row">
      <span class="lbl"><i style="background: var({r.color})"></i>{r.label}<b>{r.total}×</b></span>
      <div class="cells">
        {#each r.values as v, i}
          <button class="cell" class:on={!!v} aria-label="{colLabel(result.x[i])}: {v || 0}"
            style="background: {v ? `color-mix(in srgb, var(${r.color}) ${op(v) * 100}%, transparent)` : 'var(--bg)'}"
            onclick={() => (sel = sel === i ? null : i)}></button>
        {/each}
      </div>
    </div>
  {/each}
  <div class="axis">
    <span class="lbl"></span>
    <div class="ticks">{#each axisTicks as t}<span>{t}</span>{/each}</div>
  </div>
</div>

{#if sel != null}
  <p class="read">{colLabel(result.x[sel])}: {rows.filter(r => r.values[sel]).map(r => `${r.label}${(r.values[sel] ?? 0) > 1 ? ` ${r.values[sel]}×` : ''}`).join(', ') || 'kein Krafttraining'}</p>
{/if}

<style>
  .grid { display: flex; flex-direction: column; gap: 5px; margin-top: 6px; }
  .row, .axis { display: flex; align-items: center; gap: 8px; }
  .lbl { width: 108px; flex-shrink: 0; display: flex; align-items: center; gap: 6px; font-size: 13px; }
  .lbl i { width: 9px; height: 9px; border-radius: 3px; flex-shrink: 0; }
  .lbl b { margin-left: auto; font-variant-numeric: tabular-nums; font-weight: 600; color: var(--muted); font-size: 12px; }
  .cells { display: grid; grid-template-columns: repeat(var(--cols), 1fr); gap: 3px; flex: 1; min-width: 0; }
  .cell { aspect-ratio: 1; min-width: 0; border: 1px solid var(--line); border-radius: 4px; padding: 0; cursor: pointer;
          font-size: 10px; font-weight: 700; color: #fff; font-variant-numeric: tabular-nums; }
  .cell.on { border-color: transparent; }
  .axis { margin-top: 3px; }
  .ticks { flex: 1; min-width: 0; display: flex; justify-content: space-between; font-size: 10px; color: var(--muted); }
  .read { margin: 10px 0 0; font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; }
</style>
