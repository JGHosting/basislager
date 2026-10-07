<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db } from '../../core/db';
  import { today, fmtDay, addDays } from '../../core/dates';
  import { openStrengthActivities, groupStatus, neglectWarnings, nextSplitDay, groupLabel } from '../../domain/strength/strength';
  import { activeSplit } from '../../domain/strength/repo';
  import { recentlyOnVacation } from '../../domain/vacation/vacation';
  import { openStrength } from '../app.svelte';
  import { dur } from '../format';

  const t = today();
  const data = liveQuery(async () => {
    const [acts, sessions, split, vacs] = await Promise.all([
      db.activities.where('sportType').equals('WeightTraining').toArray(), db.strength.toArray(), activeSplit(), db.vacations.toArray()
    ]);
    // Arme nur zeigen, wenn sie im aktiven Split vorkommen oder in den letzten 60 Tagen trainiert wurden
    const armsUsed = !!split?.days.flat().includes('arme') || sessions.some(s => !s.skipped && s.muscleGroups.includes('arme') && s.date >= addDays(t, -60));
    const status = groupStatus(sessions, acts, t).filter(s => s.group !== 'arme' || armsUsed);
    return {
      open: openStrengthActivities(acts, sessions, t),
      status, split,
      // Im Urlaub und eine Woche danach keine "seit X Tagen nicht trainiert"-Warnungen
      warnings: recentlyOnVacation(vacs, t) ? [] : neglectWarnings(status, sessions, split, t),
      next: split ? nextSplitDay(split, sessions) : null,
      any: sessions.some(s => !s.skipped) || acts.some(a => a.date >= '0')
    };
  });
</script>

{#if $data && ($data.any || $data.open.length)}
  <section class="card">
    <div class="head"><h2>Kraft</h2><button class="add" onclick={() => openStrength({ date: t, fresh: true })}>+ Einheit</button></div>

    {#if $data.open.length}
      <!-- Älteste zuerst, damit der Split-Vorschlag in der richtigen Reihenfolge weiterzählt -->
      {@const a = $data.open[$data.open.length - 1]}
      <button class="open" onclick={() => openStrength({ activityId: a.id })}>
        <span><b>{$data.open.length === 1 ? 'Krafttraining zuordnen' : `${$data.open.length} Krafttrainings zuordnen`}</b>
          <small>{$data.open.length === 1 ? '' : 'ab '}{fmtDay(a.date)} · {dur(a.duration ?? a.elapsed)}</small></span>
        <span class="go">Muskelgruppen →</span>
      </button>
    {/if}

    <div class="groups" style="grid-template-columns: repeat({$data.status.length}, 1fr)">
      {#each $data.status as s}
        <div class="g" class:ready={s.recovered && s.lastDate} class:rest={!s.recovered}>
          <b>{groupLabel(s.group)}</b>
          <small>{s.lastDate == null ? 'noch nie' : s.daysAgo === 0 ? 'heute' : s.daysAgo === 1 ? 'gestern' : `vor ${s.daysAgo} T`}</small>
          <small class="st">{s.lastDate == null ? '' : s.recovered ? 'erholt' : `noch ${s.readyIn} h`}</small>
        </div>
      {/each}
    </div>

    {#if $data.next}
      <p class="next">Nächster Split-Tag: <b>{$data.next.groups.map(groupLabel).join(' + ')}</b></p>
    {/if}
    {#each $data.warnings as w}<p class="warn">{w}</p>{/each}
  </section>
{/if}

<style>
  .head { display: flex; justify-content: space-between; align-items: baseline; }
  .head h2 { margin: 0 0 10px; }
  .add { background: none; border: none; color: var(--accent); font: inherit; font-weight: 600; font-size: 14px; cursor: pointer; padding: 4px 0; }
  .open { width: 100%; display: flex; justify-content: space-between; align-items: center; gap: 10px; text-align: left; font: inherit; color: var(--text);
          background: var(--accent-soft); border: none; border-radius: 14px; padding: 12px 14px; margin-bottom: 10px; cursor: pointer; }
  .open span:first-child { display: flex; flex-direction: column; }
  .open small { color: var(--muted); font-size: 13px; }
  .go { color: var(--accent); font-weight: 600; font-size: 14px; white-space: nowrap; }
  .groups { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
  .g { background: var(--bg); border-radius: 12px; padding: 10px 8px; display: flex; flex-direction: column; gap: 1px; border-top: 3px solid var(--line); }
  .g.ready { border-top-color: var(--green); }
  .g.rest { border-top-color: var(--yellow); }
  .g b { font-size: 14px; } .g small { font-size: 12px; color: var(--muted); }
  .g .st { color: var(--text); }
  .next { font-size: 14px; margin: 10px 0 0; color: var(--muted); }
  .next b { color: var(--text); }
  .warn { font-size: 13px; background: var(--accent-soft); padding: 8px 12px; border-radius: 10px; margin: 8px 0 0; }
</style>
