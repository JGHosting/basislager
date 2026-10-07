<script lang="ts">
  import type { PlanSession } from '../../domain/planner/plan';
  import { editSession } from '../../domain/planner/repo';
  import { addDays, weekStart, fmtDay, today } from '../../core/dates';
  import { openStrength, openActivity } from '../app.svelte';
  let { s, compact = false }: { s: PlanSession; compact?: boolean } = $props();
  let open = $state(false), moving = $state(false);
  const COLOR: Record<string, string> = { kraft: 'var(--c-strength)', lauf: 'var(--c-run)', trail: 'var(--c-mountain)', rad: 'var(--c-ride)', schwimmen: 'var(--c-swim)', gehen: 'var(--c-mountain)', wettkampf: 'var(--red)' };
  const ws = $derived(weekStart(s.origDate));
  // Verschieben innerhalb derselben Woche (ab heute)
  const days = $derived(Array.from({ length: 7 }, (_, i) => addDays(ws, i)).filter(d => d >= today()));
  const dur = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`);
</script>

<div class="sess {s.status}" class:race={s.sport === 'wettkampf'}>
  <button class="main" onclick={() => (open = !open)} aria-expanded={open}>
    <span class="dot" style="background: {COLOR[s.sport]}"></span>
    <span class="txt">
      <b>{s.title}</b>
      <small>{s.minutes ? dur(s.minutes) + ' · ' : ''}{s.intensity}{s.elevation ? ` · ${s.elevation} hm` : ''}{s.moved ? ' · verschoben' : ''}</small>
    </span>
    <span class="st">{s.status === 'erledigt' ? '✓' : s.status === 'ausgelassen' ? '–' : ''}</span>
  </button>
  {#if s.notes.length && !compact}{#each s.notes as n}<p class="note">{n}</p>{/each}{/if}
  {#if open}
    <p class="det">{s.details}</p>
    {#if s.notes.length && compact}{#each s.notes as n}<p class="note">{n}</p>{/each}{/if}
    {#if !moving}
      <div class="acts">
        {#if s.activityId}<button class="pri" onclick={() => openActivity(s.activityId!)}>Aktivität ansehen</button>{/if}
        {#if s.status !== 'erledigt'}<button onclick={() => editSession(s.key, { status: 'erledigt' })}>Erledigt</button>{/if}
        {#if s.status !== 'ausgelassen'}<button onclick={() => editSession(s.key, { status: 'ausgelassen' })}>Auslassen</button>{/if}
        {#if s.sport !== 'wettkampf'}<button onclick={() => (moving = true)}>Verschieben</button>{/if}
        {#if s.status !== 'offen' || s.moved}<button onclick={() => editSession(s.key, null)}>Zurücksetzen</button>{/if}
        {#if s.sport === 'kraft' && s.status === 'erledigt'}<button onclick={() => openStrength({ date: s.date })}>Gruppen eintragen</button>{/if}
      </div>
    {:else}
      <div class="days">
        {#each days as d}<button class:on={d === s.date} onclick={() => { editSession(s.key, { movedTo: d === s.origDate ? undefined : d }); moving = false; }}>{fmtDay(d, { weekday: 'short' })}<small>{fmtDay(d, { day: '2-digit', month: '2-digit' })}</small></button>{/each}
      </div>
      <button class="cancel" onclick={() => (moving = false)}>Abbrechen</button>
    {/if}
  {/if}
</div>

<style>
  .sess { background: var(--bg); border-radius: 14px; padding: 2px 12px; margin-top: 8px; }
  .sess.race { background: color-mix(in srgb, var(--red) 12%, var(--bg)); }
  .main { width: 100%; display: flex; align-items: center; gap: 10px; background: none; border: none; font: inherit; color: var(--text); text-align: left; padding: 10px 0; cursor: pointer; }
  .dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
  .txt { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .txt b { font-weight: 600; font-size: 15px; } .txt small { font-size: 12px; color: var(--muted); }
  .st { font-weight: 800; color: var(--green); font-size: 18px; }
  .erledigt .txt b { color: var(--muted); } .ausgelassen .txt b { text-decoration: line-through; color: var(--muted); }
  .det { font-size: 14px; line-height: 1.45; margin: 0 0 8px; }
  .note { font-size: 12px; color: var(--yellow); margin: -4px 0 8px 20px; }
  .acts, .days { display: flex; flex-wrap: wrap; gap: 6px; padding-bottom: 10px; }
  .acts button, .days button { border: 1px solid var(--line); background: var(--card); color: var(--text); border-radius: 10px; padding: 7px 10px; font: inherit; font-size: 13px; cursor: pointer; min-height: 36px; }
  .days button { display: flex; flex-direction: column; align-items: center; min-width: 52px; } .days small { font-size: 11px; color: var(--muted); }
  .acts button.pri { border-color: var(--accent); color: var(--accent); font-weight: 600; }
  .days button.on { border-color: var(--accent); color: var(--accent); }
  .cancel { background: none; border: none; color: var(--muted); font: inherit; font-size: 13px; padding: 0 0 10px; cursor: pointer; }
</style>
