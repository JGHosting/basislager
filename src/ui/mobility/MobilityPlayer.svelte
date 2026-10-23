<script lang="ts">
  import { swipeDismiss } from '../actions/swipeDismiss';
  import { byId, type MobilityExercise } from '../../domain/mobility/library';
  import { setExerciseDone, finishToday, swapExercise, rateExercise } from '../../domain/mobility/repo';
  import { loadProgress, MAX_STEP, type Feedback, type ProgressMap } from '../../domain/mobility/progression';
  import type { Routine } from '../../domain/mobility/select';
  import { closeMobilityPlayer } from '../app.svelte';
  import { unlockAudio, beep } from './beep';

  let { routine }: { routine: Routine } = $props();

  // Jede Seite ist ein eigener Schritt mit eigenem Timer
  type Step = { exerciseId: string; side?: 'links' | 'rechts'; holdSec?: number; reps?: number };
  function buildSteps(r: Routine): Step[] {
    return r.items.flatMap(i => i.sides
      ? [{ ...i, side: 'links' as const }, { ...i, side: 'rechts' as const }]
      : [{ ...i }]);
  }
  let steps = $state<Step[]>([]);
  $effect(() => { steps = buildSteps(routine); });

  let progress = $state<ProgressMap>(new Map());
  $effect(() => { void loadProgress().then(p => (progress = p)); });

  let idx = $state(0);
  let finished = $state(false);
  let doneCount = $state(0);
  let unlocked = $state<MobilityExercise[]>([]);

  const step = $derived(steps[idx]);
  const ex = $derived(step ? byId(step.exerciseId) : undefined);
  const isLast = $derived(idx === steps.length - 1);
  const firstSide = $derived(!!step?.side && steps[idx + 1]?.exerciseId === step.exerciseId);
  const level = $derived(ex ? (progress.get(ex.id)?.step ?? 0) : 0);

  // Fotos mit Start- und Endposition wechseln sich ab
  let frame = $state(0);
  $effect(() => {
    if (!ex?.image2) { frame = 0; return; }
    const t = setInterval(() => (frame = 1 - frame), 1600);
    return () => clearInterval(t);
  });

  /* ---------- Halte-Timer: startet erst auf „Start“, Signalton am Ende ---------- */
  type TState = 'idle' | 'running' | 'paused' | 'done';
  let tstate = $state<TState>('idle');
  let remaining = $state(0);
  let endAt = 0;
  let tick: ReturnType<typeof setInterval> | undefined;
  function resetTimer() {
    clearInterval(tick); tstate = 'idle';
    remaining = step?.holdSec ?? 0;
  }
  // Neuer Schritt → Timer zurück auf Anfang (nicht automatisch starten)
  $effect(() => { void idx; void step?.exerciseId; resetTimer(); return () => clearInterval(tick); });
  function update() {
    // Zeit aus der Uhr, nicht aus Intervall-Ticks – stimmt auch nach Bildschirmsperre
    remaining = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
    if (remaining <= 0) { clearInterval(tick); tstate = 'done'; beep(); }
  }
  function start() {
    unlockAudio();
    endAt = Date.now() + remaining * 1000;
    tstate = 'running';
    clearInterval(tick); tick = setInterval(update, 250);
  }
  function pause() { clearInterval(tick); update(); if (tstate === 'running') tstate = 'paused'; }
  function restart() { resetTimer(); start(); }

  /* ---------- Feedback nach „Gemacht ✓“ (freiwillig, nach 4 s = „passt“) ---------- */
  const FB_MS = 4000;
  let asking = $state<string | null>(null);   // exerciseId, für die gerade Feedback angezeigt wird
  let fbTimer: ReturnType<typeof setTimeout> | undefined;
  async function answer(fb: Feedback) {
    const id = asking; if (!id) return;
    clearTimeout(fbTimer); asking = null;
    const fresh = await rateExercise(id, fb);
    if (fresh.length) unlocked = [...unlocked, ...fresh.filter(f => !unlocked.some(u => u.id === f.id))];
    progress = await loadProgress();
    advance();
  }

  function advance() {
    if (isLast) return finish();
    idx++;
  }
  function finish() { clearInterval(tick); finished = true; void finishToday(false); }
  /** Bestätigt: bei der ersten Seite → zur zweiten Seite, sonst Übung als gemacht speichern, kurz Feedback, weiter. */
  function confirm() {
    if (!step) return;
    clearInterval(tick);
    if (firstSide) { idx++; return; }
    void setExerciseDone(step.exerciseId, true); doneCount++;
    asking = step.exerciseId;
    fbTimer = setTimeout(() => void answer('passt'), FB_MS);
  }
  /** Überspringen: ganze Übung (beide Seiten) ohne Häkchen. */
  function skip() {
    if (!step) return;
    const id = step.exerciseId;
    let n = idx + 1;
    while (n < steps.length && steps[n].exerciseId === id) n++;
    if (n >= steps.length) return finish();
    idx = n;
  }
  async function swap() {
    if (!ex || !step) return;
    const oldId = ex.id;
    // Ersatz berücksichtigt die aktive Verletzung und wird im Tageslog gespeichert
    const rep = await swapExercise(oldId, [...new Set(steps.map(s => s.exerciseId))]);
    if (!rep) return;
    const first = steps.findIndex(s => s.exerciseId === oldId);
    const base = { exerciseId: rep.exerciseId, holdSec: rep.holdSec, reps: rep.reps };
    const fresh: Step[] = rep.sides ? [{ ...base, side: 'links' }, { ...base, side: 'rechts' }] : [base];
    steps = [...steps.slice(0, first), ...fresh, ...steps.slice(first).filter(s => s.exerciseId !== oldId)];
    idx = first;
    resetTimer();
  }
  async function close(allDone: boolean) {
    // Offenes Feedback beim Schließen als „passt“ werten
    if (asking) { const id = asking; asking = null; clearTimeout(fbTimer); await rateExercise(id, 'passt'); }
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
      <p class="muted">{doneCount} {doneCount === 1 ? 'Übung' : 'Übungen'} bestätigt.</p>
      {#if unlocked.length}
        <div class="unlocked">
          <p class="ul-title">🔓 Neu freigeschaltet</p>
          {#each unlocked as u}<p class="ul-item">{u.name}</p>{/each}
        </div>
      {/if}
      <button class="btn primary wide" onclick={() => close(false)}>Fertig</button>
    </div>
  {:else if ex}
    <p class="eyebrow">Schritt {idx + 1} / {steps.length}</p>
    <div class="titlerow">
      <h2 class="title">{ex.name}</h2>
      <span class="lvl" title="Stufe dieser Übung">{#each Array(MAX_STEP + 1) as _, i}<i class:on={i <= level}></i>{/each}</span>
    </div>
    {#if step.side}
      <p class="side">{step.side === 'links' ? 'Linke Seite' : 'Rechte Seite'}</p>
    {/if}
    {#if ex.image}
      <div class="imgwrap">
        <img class="img" src={`mobility/${ex.image}.webp`} alt="" />
        {#if ex.image2}
          <img class="img second" class:show={frame === 1} src={`mobility/${ex.image2}.webp`} alt="" />
          <span class="frame">{frame === 0 ? 'Start' : 'Ende'}</span>
        {/if}
      </div>
    {/if}
    {#if ex.cue}<p class="cue">{ex.cue}</p>{/if}
    <p class="instr">{ex.instructions}</p>

    {#if step.holdSec}
      <div class="timer" class:done={tstate === 'done'} class:dim={tstate === 'idle' || tstate === 'paused'}>
        <span class="time">{tstate === 'done' ? 'Zeit um ✓' : mm(remaining)}</span>
        {#if tstate === 'idle'}
          <button class="btn primary tbtn" onclick={start}>▶ Start</button>
        {:else if tstate === 'running'}
          <button class="btn ghost tbtn" onclick={pause}>Pause</button>
        {:else if tstate === 'paused'}
          <button class="btn primary tbtn" onclick={start}>Fortsetzen</button>
        {:else}
          <button class="btn ghost tbtn" onclick={restart}>Nochmal</button>
        {/if}
      </div>
    {:else if step.reps}
      <p class="reps">{step.reps}×</p>
    {/if}

    <div class="actions">
      <button class="btn primary main" onclick={confirm} disabled={!!asking}>{firstSide ? 'Seite wechseln →' : 'Gemacht ✓'}</button>
      <button class="btn ghost" onclick={swap} disabled={!!asking}>Tauschen</button>
      <button class="btn ghost" onclick={skip} disabled={!!asking}>Überspringen</button>
    </div>
  {/if}
  <button class="close" onclick={() => close(false)} aria-label="Schließen">✕</button>
</div>

{#if asking}
  {@const a = byId(asking)}
  <div class="fb" role="dialog" aria-label="Wie war die Übung?">
    <p class="fb-q">Wie war {a?.name ?? 'die Übung'}?</p>
    <div class="fb-row">
      <button class="btn ghost" onclick={() => answer('leicht')}>Zu leicht</button>
      <button class="btn primary" onclick={() => answer('passt')}>Passt</button>
      <button class="btn ghost" onclick={() => answer('schwer')}>Zu schwer</button>
    </div>
    <div class="fb-bar"><i style={`animation-duration:${FB_MS}ms`}></i></div>
  </div>
{/if}

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
  .titlerow { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin: 4px 0 6px; }
  .title { font-size: 26px; margin: 0; letter-spacing: -0.02em; }
  .lvl { display: flex; gap: 3px; flex-shrink: 0; }
  .lvl i { width: 7px; height: 7px; border-radius: 50%; background: var(--line); }
  .lvl i.on { background: var(--accent); }
  .side { margin: 0 0 10px; display: inline-block; align-self: flex-start; background: var(--accent); color: #fff; font-weight: 700; font-size: 15px; padding: 5px 12px; border-radius: 999px; }
  .imgwrap { position: relative; margin-bottom: 12px; }
  .img { display: block; width: 100%; max-height: 38vh; object-fit: contain; border-radius: 18px; background: var(--card); }
  .img.second { position: absolute; inset: 0; height: 100%; opacity: 0; transition: opacity .4s; }
  .img.second.show { opacity: 1; }
  .frame { position: absolute; left: 10px; bottom: 10px; font-size: 12px; font-weight: 600; color: #fff; background: rgba(0,0,0,.5); padding: 3px 8px; border-radius: 8px; }
  .cue { background: var(--accent-soft); color: var(--accent); font-weight: 600; font-size: 14px; padding: 10px 12px; border-radius: 12px; margin: 0 0 10px; }
  .instr { font-size: 16px; line-height: 1.5; margin: 0 0 16px; }
  .timer { display: flex; align-items: center; justify-content: center; gap: 16px; margin: 6px 0 18px; }
  .timer .time { font-size: 48px; font-weight: 750; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
  .timer.dim .time { opacity: .55; }
  .timer.done .time { color: var(--green, var(--accent)); font-size: 34px; }
  .tbtn { min-width: 120px; }
  .reps { font-size: 32px; font-weight: 750; text-align: center; margin: 10px 0 20px; }
  .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: auto; padding-top: 8px; }
  .actions .btn { min-width: 0; white-space: nowrap; }
  .actions .main { grid-column: 1 / -1; }
  .done { display: flex; flex-direction: column; align-items: center; justify-content: center; flex: 1; gap: 8px; text-align: center; }
  .unlocked { background: var(--card); border-radius: 16px; padding: 12px 16px; margin-top: 6px; width: 100%; }
  .ul-title { margin: 0 0 6px; font-weight: 700; }
  .ul-item { margin: 2px 0; color: var(--muted); }
  .muted { color: var(--muted); }
  .wide { width: 100%; margin-top: 14px; }
  .fb { position: fixed; left: 0; right: 0; bottom: 0; z-index: 32; max-width: 640px; margin: 0 auto; background: var(--card);
        border-radius: 20px 20px 0 0; padding: 16px 20px calc(env(safe-area-inset-bottom) + 16px); box-shadow: 0 -8px 30px rgba(0,0,0,.35); animation: up .2s; }
  .fb-q { margin: 0 0 12px; font-weight: 700; text-align: center; }
  .fb-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
  .fb-row .btn { min-width: 0; padding: 0 6px; }
  .fb-bar { height: 3px; background: var(--line); border-radius: 2px; margin-top: 12px; overflow: hidden; }
  .fb-bar i { display: block; height: 100%; background: var(--accent); animation: shrink linear forwards; transform-origin: left; }
  @keyframes shrink { from { transform: scaleX(1); } to { transform: scaleX(0); } }
</style>
