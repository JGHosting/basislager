<script lang="ts">
  import type { LoadDay } from '../../domain/load/load';
  import { num } from '../format';
  let { day, text, acwr, recent, level }: { day: LoadDay; text: string; acwr: number | null; recent: LoadDay[]; level: string } = $props();

  // Kleine Verlaufsgrafik: Fitness (CTL) und Ermüdung (ATL) der letzten 6 Wochen
  const W = 300, H = 70;
  const path = (vals: number[], max: number) =>
    vals.map((v, i) => `${i ? 'L' : 'M'}${((i / Math.max(1, vals.length - 1)) * W).toFixed(1)},${(H - 4 - (v / max) * (H - 8)).toFixed(1)}`).join(' ');
  const max = $derived(Math.max(10, ...recent.map(d => Math.max(d.atl, d.ctl))));
  const bars = $derived(recent.map(d => d.load));
  const barMax = $derived(Math.max(1, ...bars));
  let open = $state(false);
</script>

<section class="card">
  <div class="head"><h2>Belastung</h2><button class="how" onclick={() => (open = !open)}>{open ? 'Weniger' : 'Was heißt das?'}</button></div>
  <div class="nums">
    <div><span class="lbl ctl">Fitness</span><b>{num(day.ctl)}</b></div>
    <div><span class="lbl atl">Ermüdung</span><b>{num(day.atl)}</b></div>
    <div><span class="lbl">Form</span><b class:neg={day.tsb < -10} class:pos={day.tsb > 5}>{day.tsb > 0 ? '+' : ''}{num(day.tsb)}</b></div>
  </div>
  <svg viewBox="0 0 {W} {H}" preserveAspectRatio="none" class="spark" aria-hidden="true">
    {#each bars as b, i}
      <rect x={(i / bars.length) * W} y={H - (b / barMax) * (H * 0.45)} width={W / bars.length - 1.5} height={(b / barMax) * (H * 0.45)} rx="1.5" fill="var(--line)" />
    {/each}
    <path d={path(recent.map(d => d.ctl), max)} fill="none" stroke="var(--c-ride)" stroke-width="2.2" vector-effect="non-scaling-stroke" />
    <path d={path(recent.map(d => d.atl), max)} fill="none" stroke="var(--accent)" stroke-width="2.2" vector-effect="non-scaling-stroke" />
  </svg>
  <div class="axis"><span>vor 6 Wochen</span><span>heute</span></div>
  <p class="state {level}">{text}</p>
  {#if open}
    <p class="explain">
      Jede Aktivität bekommt einen Belastungswert aus Dauer und Puls (TRIMP). Ohne Puls wird er aus Dauer, Sportart und
      Höhenmetern geschätzt. <b>Ermüdung</b> ist der Schnitt der letzten ~7 Tage, <b>Fitness</b> der letzten ~42 Tage.
      <b>Form</b> = Fitness − Ermüdung: negativ heißt müde, positiv heißt frisch.
      {#if acwr != null}Belastungsverhältnis aktuell {acwr.toFixed(2).replace('.', ',')} (über 1,5 = Sprung nach oben).{/if}
      Graue Balken: Tagesbelastung.
    </p>
  {/if}
</section>

<style>
  .head { display: flex; justify-content: space-between; align-items: baseline; }
  .head h2 { margin: 0 0 10px; }
  .how { background: none; border: none; color: var(--accent); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; padding: 4px 0; }
  .nums { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .nums div { display: flex; flex-direction: column; }
  .nums b { font-size: 26px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
  .lbl { font-size: 13px; color: var(--muted); display: flex; align-items: center; gap: 6px; }
  .lbl.ctl::before, .lbl.atl::before { content: ''; width: 10px; height: 3px; border-radius: 2px; }
  .lbl.ctl::before { background: var(--c-ride); } .lbl.atl::before { background: var(--accent); }
  .neg { color: var(--red); } .pos { color: var(--green); }
  .spark { width: 100%; height: 70px; margin-top: 10px; display: block; }
  .axis { display: flex; justify-content: space-between; font-size: 11px; color: var(--muted); margin-top: 2px; }
  .state { font-size: 14px; margin: 10px 0 0; }
  .state.hoch { color: var(--red); }
  .explain { font-size: 13px; color: var(--muted); line-height: 1.45; }
</style>
