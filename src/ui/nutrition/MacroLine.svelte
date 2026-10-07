<script lang="ts">
  import type { Sums } from '../../domain/nutrition/calc';
  import { fmtG } from '../../domain/nutrition/calc';
  let { sum, big = false }: { sum: Sums; big?: boolean } = $props();
  const items = $derived([
    { k: 'protein', l: 'Protein', c: 'var(--c-ride)' }, { k: 'carbs', l: big ? 'Kohlenhydrate' : 'KH', c: 'var(--c-run)' }, { k: 'fat', l: 'Fett', c: 'var(--c-swim)' }
  ] as const);
</script>

<div class="macros" class:big>
  {#each items as it}
    {@const s = sum[it.k]}
    <span class="m">
      {#if big}<i style="background: {it.c}"></i>{/if}
      <span class="l">{it.l}</span>
      <b>{s.total && !s.known ? '–' : fmtG(s.value)} g</b>
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
  small { font-size: 11px; color: var(--yellow); }
</style>
