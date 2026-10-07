<script lang="ts">
  /**
   * Dünne Hülle um uPlot. Alle Diagramme der Statistikseite teilen sich das Fadenkreuz (sync),
   * damit übereinanderliegende Kennzahlen zeitlich direkt vergleichbar sind.
   */
  import uPlot from 'uplot';
  import 'uplot/dist/uPlot.min.css';
  import type { MetricResult, Bucket } from '../../domain/stats/metrics';

  let { result, bucket, unit, digits, markers = [], onhover }: {
    result: MetricResult; bucket: Bucket; unit: string; digits: number; markers?: string[];
    onhover?: (idx: number | null) => void;
  } = $props();

  let el: HTMLDivElement;
  let plot: uPlot | null = null;

  const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || v;
  const ts = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd).getTime() / 1000; };
  const MON = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  function xLabel(t: number) {
    const d = new Date(t * 1000);
    return bucket === 'month' ? `${MON[d.getMonth()]} ${String(d.getFullYear()).slice(2)}` : `${d.getDate()}.${d.getMonth() + 1}.`;
  }
  const fmtY = (v: number) => (unit === 'min/km' ? `${Math.floor(v)}:${String(Math.round((v % 1) * 60)).padStart(2, '0')}` : v.toLocaleString('de-DE', { maximumFractionDigits: v >= 100 ? 0 : digits }));

  function build() {
    plot?.destroy();
    if (!el) return;
    const width = el.clientWidth || 320;
    const xs = result.x.map(ts);
    const step = bucket === 'day' ? 86400 : bucket === 'week' ? 7 * 86400 : 30 * 86400;
    const muted = css('--muted'), line = css('--line'), surface = css('--card');

    // Gestapelte Balken: kumulierte Werte, größte zuerst zeichnen
    let data: (number | null)[][] = result.series.map(s => s.values);
    if (result.stacked) {
      const acc = xs.map(() => 0);
      data = result.series.map(s => s.values.map((v, i) => (acc[i] += v ?? 0) || null));
    }
    const barCount = result.series.filter(s => s.kind === 'bar').length;
    const bars = uPlot.paths.bars!({ size: [0.72, 28], radius: 0.25, gap: xs.length > 40 ? 0.5 : 1 });
    const order = result.stacked ? [...result.series.keys()].reverse() : [...result.series.keys()];

    const series: uPlot.Series[] = [{}];
    for (const i of order) {
      const s = result.series[i]; const color = css(s.color);
      series.push({
        label: s.label, stroke: s.kind === 'bar' ? surface : color,
        fill: s.kind === 'bar' ? color : undefined,
        width: s.kind === 'bar' ? 0 : 2,
        paths: s.kind === 'bar' ? bars : s.kind === 'points' ? () => null : undefined,
        points: { show: s.kind === 'points' || (s.kind === 'line' && xs.length <= 12), size: 8, stroke: surface, fill: color, width: 2 },
        spanGaps: s.kind === 'line',
        value: (_u, v) => (v == null ? '' : fmtY(v))
      });
    }
    const ordered = [xs, ...order.map(i => data[i])];
    // Gestapelt: Legendenwerte sollen Einzelwerte zeigen, nicht kumulierte
    if (result.stacked) series.forEach((s, k) => { if (k) { const i = order[k - 1]; s.value = (_u, _v, _si, idx) => (idx == null ? '' : fmtY(result.series[i].values[idx] ?? 0)); } });

    plot = new uPlot({
      width, height: 190, padding: [8, 4, 0, 0],
      cursor: { sync: { key: 'stats' }, points: { size: 9 }, drag: { x: false, y: false } },
      legend: { show: result.series.length > 1, live: true },
      scales: { x: { time: false, range: () => [xs[0] - step * 0.6, xs[xs.length - 1] + step * 0.6] },
                y: { range: (_u, min, max) => barCount ? [0, (max || 1) * 1.1] : [min - (max - min) * 0.15 - 0.5, max + (max - min) * 0.15 + 0.5] } },
      axes: [
        { stroke: muted, grid: { show: false }, ticks: { show: false }, size: 26, font: '11px -apple-system, system-ui',
          values: (_u, splits) => splits.map(xLabel), space: 46 },
        { stroke: muted, grid: { stroke: line, width: 1 }, ticks: { show: false }, size: 40, font: '11px -apple-system, system-ui',
          values: (_u, splits) => { const st = Math.abs((splits[1] ?? 1) - (splits[0] ?? 0)); const dec = Math.abs(st - Math.round(st)) < 1e-9 ? 0 : Math.abs(st * 10 - Math.round(st * 10)) < 1e-9 ? 1 : 2; return splits.map(v => unit === 'min/km' ? fmtY(v) : v.toLocaleString('de-DE', { maximumFractionDigits: dec })); }, space: 34 }
      ],
      series,
      hooks: {
        drawClear: [u => {
          if (!markers.length) return;
          const ctx = u.ctx; ctx.save(); ctx.fillStyle = css('--c-snow'); ctx.globalAlpha = 0.14;
          for (const d of markers) {
            const t = ts(d); const k = bucket === 'day' ? t : bucket === 'week' ? ts(d) : t;
            const x0 = u.valToPos(k - (bucket === 'day' ? 43200 : 0), 'x', true), x1 = u.valToPos(k + (bucket === 'day' ? 43200 : 86400), 'x', true);
            ctx.fillRect(x0, u.bbox.top, Math.max(2, x1 - x0), u.bbox.height);
          }
          ctx.restore();
        }],
        setCursor: [u => onhover?.(u.cursor.idx ?? null)]
      }
    }, ordered as uPlot.AlignedData, el);
  }

  $effect(() => {
    void result; void bucket; void markers;
    build();
    const ro = new ResizeObserver(() => plot && plot.setSize({ width: el.clientWidth, height: 190 }));
    ro.observe(el);
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const re = () => build();
    mq.addEventListener('change', re);
    return () => { ro.disconnect(); mq.removeEventListener('change', re); plot?.destroy(); plot = null; };
  });
</script>

<div class="uchart" bind:this={el}></div>

<style>
  .uchart { width: 100%; min-height: 190px; }
  .uchart :global(.u-legend) { font-size: 12px; color: var(--muted); text-align: left; margin-top: 4px; }
  .uchart :global(.u-legend .u-series) { padding: 2px 8px 2px 0; }
  .uchart :global(.u-legend .u-series:first-child) { display: none; }
  .uchart :global(.u-legend .u-marker) { width: 10px; height: 10px; border-radius: 3px; border-width: 0 !important; }
  .uchart :global(.u-legend th) { font-weight: 500; color: var(--muted); }
  .uchart :global(.u-legend td) { color: var(--text); font-variant-numeric: tabular-nums; padding-left: 4px; }
  .uchart :global(.u-cursor-x) { border-right: 1px dashed var(--muted); }
  .uchart :global(.u-cursor-y) { display: none; }
</style>
