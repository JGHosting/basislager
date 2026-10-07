<script lang="ts">
  /** Fortschritt zum Kalorienziel. Bei Überschreitung wird der Bereich über dem Ziel sichtbar (nicht bei 100 % abgeschnitten). */
  let { eaten, goal }: { eaten: number; goal: number } = $props();
  const over = $derived(eaten > goal);
  const scaleMax = $derived(Math.max(goal, eaten) || 1);
  const goalPct = $derived((goal / scaleMax) * 100);
  const eatenPct = $derived((Math.min(eaten, goal) / scaleMax) * 100);
  const overPct = $derived(over ? ((eaten - goal) / scaleMax) * 100 : 0);
</script>

<div class="bar" role="meter" aria-valuemin="0" aria-valuemax={goal} aria-valuenow={Math.round(eaten)} aria-label="Kalorien">
  <span class="fill" style="width: {eatenPct}%"></span>
  {#if over}<span class="over" style="left: {goalPct}%; width: {overPct}%"></span>{/if}
  {#if over}<span class="goal" style="left: {goalPct}%"></span>{/if}
</div>

<style>
  .bar { position: relative; height: 14px; border-radius: 7px; background: var(--bg); overflow: hidden; }
  .fill { position: absolute; left: 0; top: 0; bottom: 0; background: var(--accent); border-radius: 7px 0 0 7px; transition: width .4s ease; }
  .over { position: absolute; top: 0; bottom: 0; background: var(--red);
          background-image: repeating-linear-gradient(135deg, transparent 0 5px, rgba(255,255,255,.22) 5px 8px); transition: width .4s ease; }
  .goal { position: absolute; top: -2px; bottom: -2px; width: 3px; margin-left: -1.5px; background: var(--card); }
</style>
