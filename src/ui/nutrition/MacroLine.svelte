<script lang="ts">
  import type { Sums } from '../../domain/nutrition/calc';
  import { fmtG } from '../../domain/nutrition/calc';
  import type { MacroGoals } from '../../domain/nutrition/repo';
  let { sum, big = false, goals = null }: { sum: Sums; big?: boolean; goals?: MacroGoals | null } = $props();
  const items = $derived([
    { k: 'protein', l: 'Protein', c: 'var(--c-ride)' }, { k: 'carbs', l: big ? 'Kohlenhydrate' : 'KH', c: 'var(--c-run)' }, { k: 'fat', l: 'Fett', c: 'var(--c-swim)' }
  ] as const);
</script>

<div class="macros" class:big>
  {#each items as it}
    {@const s = sum[it.k]}
    {@const g = big ? goals?.[it.k] ?? null : null}
    <span class="m">
      {#if big}<i style="background: {it.c}"></i>{/if}
      <span class="l">{it.l}</span>
      <b>{s.total && !s.known ? '–' : fmtG(s.value)} g</b>
      {#if g}<span class="of" class:over={s.value > g * 1.1}>Ziel {fmtG(g)} g</span>{/if}
      {#if g}<span class="gbar"><span style="width: {Math.min(100, (s.value / g) * 100)}%; background: {it.c}"></span></span>{/if}
      {#if s.known < s.total && s.known > 0}<small title="Nicht alle Lebensmittel haben diesen Wert">unvollst.</small>{/if}
    </span>
  {/each}
</div>

<style>
  .macros { display: flex; gap: 12px; flex-wrap: wrap; font-size: 13px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .macros b { color: var(--text); font-weight: 600; }
  .big { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; font-size: 13px; }
  .big .m { display: flex; flex-direction: column; background: var(--bg); border-radius: 12px; padding: 8px 10px; }
  .big b { font-size: 18px; }
  .big i { display: block; width: 18px; height: 4px; border-radius: 2px; margin-bottom: 4px; }
  .of.over { color: var(--yellow); }
  .of { font-size: 11px; color: var(--muted); margin-top: 1px; }
  .gbar { display: block; height: 4px; border-radius: 2px; background: var(--line); margin-top: 6px; overflow: hidden; }
  .gbar span { display: block; height: 100%; border-radius: 2px; }
  small { font-size: 11px; color: var(--yellow); }
</style>
