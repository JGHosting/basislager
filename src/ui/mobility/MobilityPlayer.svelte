<script lang="ts">
  import { swipeDismiss } from '../actions/swipeDismiss';
  import { byId, LIBRARY } from '../../domain/mobility/library';
  import { setExerciseDone, finishToday } from '../../domain/mobility/repo';
  import type { Routine } from '../../domain/mobility/select';
  import { closeMobilityPlayer } from '../app.svelte';

  let { routine }: { routine: Routine } = $props();

  type Step = { exerciseId: string; side?: 'links' | 'rechts'; holdSec?: number; reps?: number };
  function buildSteps(r: Routine): Step[] {
    return r.items.flatMap(i => i.sides
      ? [{ ...i, side: 'links' as const }, { ...i, side: 'rechts' as const }]
      : [{ ...i }]);
  }
  let steps = $state<Step[]>([]);
  $effect(() => { steps = buildSteps(routine); });

  let idx = $state(0);
  let remaining = $state(0);
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = $state(false);
  let finished = $state(false);

  const step = $derived(steps[idx]);
  const ex = $derived(step ? byId(step.exerciseId) : undefined);
  const isLast = $derived(idx === steps.length - 1);

  function startTimer() {
    clearInterval(timer);
    if (!step?.holdSec) { running = false; return; }
    remaining = step.holdSec; running = true;
    timer = setInterval(() => {
      remaining--;
      if (remaining <= 0) { clearInterval(timer); running = false; next(true); }
    }, 1000);
  }
  $effect(() => { if (step) startTimer(); return () => clearInterval(timer); });

  function markDone(exerciseId: string) {
    // Nur beim letzten Schritt einer Übung (bei Seitenwechsel beim zweiten) als erledigt zählen.
    const stillComing = steps.slice(idx + 1).some(s => s.exerciseId === exerciseId);
    if (!stillComing) void setExerciseDone(exerciseId, true);
  }
  function next(auto = false) {
    if (step) markDone(step.exerciseId);
    if (isLast) { clearInterval(timer); finished = true; void finishToday(false); return; }
    idx++;
    if (!auto) startTimer();
  }
  function skip() {
    clearInterval(timer);
    if (isLast) { finished = true; void finishToday(false); return; }
    idx++;
  }
  function swap() {
    if (!ex) return;
    const altPool = LIBRARY.filter(e => e.id !== ex.id && e.regions.some(r => ex.regions.includes(r)) && !steps.some(s => s.exerciseId === e.id));
    if (!altPool.length) return;
    const alt = altPool[Math.floor(Math.random() * altPool.length)];
    const replacement: Step = { exerciseId: alt.id, side: step.side, holdSec: alt.holdSec, reps: alt.reps };
    steps = steps.map((s, i) => (i === idx ? replacement : s));
    startTimer();
  }
  function togglePause() {
    if (running) { clearInterval(timer); running = false; }
    else if (remaining > 0) {
      running = true;
      timer = setInterval(() => { remaining--; if (remaining <= 0) { clearInterval(timer); running = false; next(true); } }, 1000);
    }
  }
  async function close(allDone: boolean) {
    if (allDone) await finishToday(true);
    closeMobilityPlayer();
  }
  const mm = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
</script>

<div class="backdrop" role="presentation"></div>
<div class="sheet" use:swipeDismiss={() => close(false)} role="dialog" aria-modal="true" aria-label="Mobility-Routine">
  <div class="grab"></div>
  {#if finished}
    <div class="done">
      <h2>Geschafft 🎉</h2>
      <p class="muted">{steps.length} Schritte abgeschlossen.</p>
      <button class="btn primary wide" onclick={() => close(false)}>Fertig</button>
    </div>
  {:else if ex}
    <p class="eyebrow">Schritt {idx + 1} / {steps.length}{step.side ? ` · ${step.side === 'links' ? 'Links' : 'Rechts'}` : ''}</p>
    <h2 class="title">{ex.name}</h2>
    {#if ex.image}<img class="img" src={`mobility/${ex.image}.webp`} alt="" />{/if}
    {#if ex.cue}<p class="cue">{ex.cue}</p>{/if}
    <p class="instr">{ex.instructions}</p>

    {#if step.holdSec}
      <div class="timer" class:paused={!running}>
        <span>{mm(remaining)}</span>
        <button class="btn ghost small" onclick={togglePause}>{running ? 'Pause' : 'Weiter'}</button>
      </div>
    {:else if step.reps}
      <p class="reps">{step.reps}× {ex.sides ? 'je Seite' : ''}</p>
    {/if}

    <div class="actions">
      <button class="btn ghost" onclick={swap}>Tauschen</button>
      <button class="btn ghost" onclick={skip}>Überspringen</button>
      <button class="btn primary" onclick={() => next()}>{isLast ? 'Fertig' : 'Weiter'}</button>
    </div>
  {/if}
  <button class="close" onclick={() => close(false)} aria-label="Schließen">✕</button>
</div>

<style>
  .backdrop { position: fixed; inset: 0; touch-action: none; background: rgba(0,0,0,.55); z-index: 30; animation: fade .2s; }
  .sheet { position: fixed; left: 0; right: 0; bottom: 0; top: 0; z-index: 31; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch;
           background: var(--bg); padding: calc(env(safe-area-inset-top) + 8px) 20px calc(env(safe-area-inset-bottom) + 20px);
           max-width: 640px; margin: 0 auto; animation: up .3s cubic-bezier(.2,.9,.3,1); display: flex; flex-direction: column; }
  @keyframes up { from { transform: translateY(100%); } }
  @keyframes fade { from { opacity: 0; } }
  .grab { width: 40px; height: 5px; border-radius: 3px; background: var(--line); margin: 4px auto 14px; flex-shrink: 0; }
  .close { position: absolute; top: calc(env(safe-area-inset-top) + 10px); right: 20px; width: 36px; height: 36px; border-radius: 50%;
           border: none; background: var(--card); color: var(--muted); font-size: 16px; cursor: pointer; }
  .eyebrow { margin: 0; color: var(--muted); font-size: 14px; font-weight: 600; }
  .title { font-size: 26px; margin: 4px 0 12px; letter-spacing: -0.02em; }
  .img { width: 100%; max-height: 42vh; object-fit: contain; border-radius: 18px; background: var(--card); margin-bottom: 12px; }
  .cue { background: var(--accent-soft); color: var(--accent); font-weight: 600; font-size: 14px; padding: 10px 12px; border-radius: 12px; margin: 0 0 10px; }
  .instr { font-size: 16px; line-height: 1.5; margin: 0 0 16px; }
  .timer { display: flex; align-items: center; justify-content: center; gap: 16px; margin: 10px 0 20px; }
  .timer span { font-size: 48px; font-weight: 750; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
  .timer.paused span { opacity: .5; }
  .reps { font-size: 32px; font-weight: 750; text-align: center; margin: 10px 0 20px; }
  .actions { display: grid; grid-template-columns: 1fr 1fr 1.4fr; gap: 8px; margin-top: auto; }
  .btn.small { min-height: 40px; padding: 0 12px; font-size: 14px; }
  .done { display: flex; flex-direction: column; align-items: center; justify-content: center; flex: 1; gap: 8px; text-align: center; }
  .muted { color: var(--muted); }
  .wide { width: 100%; margin-top: 14px; }
</style>
