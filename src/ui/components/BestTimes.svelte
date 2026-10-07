<script lang="ts">
  /** Bestzeiten (gesamt + letzte 12 Monate) und Prognose für die Standarddistanzen. */
  import { liveQuery } from 'dexie';
  import { db, getSetting, type Activity } from '../../core/db';
  import { fmtDay } from '../../core/dates';
  import { bestTable, refreshCurves, type CurveCache, type Effort } from '../../domain/planner/besttimes';
  import { fmtTime, fmtPace } from '../../domain/planner/goals';
  import { openActivity, app } from '../app.svelte';

  let { activities }: { activities: Activity[] } = $props();
  const cacheQ = liveQuery(() => getSetting<CurveCache>('bestCurves'));
  const rows = $derived(bestTable(activities, $cacheQ ?? null));
  const usesCurve = $derived(!!$cacheQ && Object.keys($cacheQ.all).length > 0);
  let busy = $state(false), err = $state('');
  // Einmal versuchen, falls noch nie geladen
  $effect(() => { if ($cacheQ === undefined && app.connected && navigator.onLine && !busy) void load(false); });
  async function load(force: boolean) {
    busy = true; err = '';
    try { await refreshCurves(force); } catch (e) { err = e instanceof Error ? e.message : String(e); }
    finally { busy = false; }
  }
  async function open(e: Effort | null) {
    if (!e?.activityId) return;
    const a = await db.activities.where('sourceId').equals(e.activityId).first();
    if (a) openActivity(a.id);
  }
  const pace = (secs: number, m: number) => fmtPace(secs / 60 / (m / 1000));
</script>

<section class="card best">
  <div class="head"><h2>Bestzeiten & Prognose</h2><span class="muted">Laufen</span></div>
  <table>
    <thead><tr><th></th><th>Bestzeit</th><th>12 Monate</th><th>Prognose</th></tr></thead>
    <tbody>
      {#each rows as r (r.m)}
        <tr>
          <th scope="row">{r.label}</th>
          <td>{#if r.all}<button onclick={() => open(r.all)}><b>{fmtTime(r.all.secs)}</b><small>{r.all.date ? fmtDay(r.all.date, { month: '2-digit', year: '2-digit' }) : ''}</small></button>{:else}<span class="muted">–</span>{/if}</td>
          <td>{#if r.year}<button onclick={() => open(r.year)}><b>{fmtTime(r.year.secs)}</b><small>{pace(r.year.secs, r.m)}/km</small></button>{:else}<span class="muted">–</span>{/if}</td>
          <td>{#if r.predicted}<b class="pred">{fmtTime(r.predicted.secs)}</b><small>{pace(r.predicted.secs, r.m)}/km</small>{:else}<span class="muted">–</span>{/if}</td>
        </tr>
      {/each}
    </tbody>
  </table>
  <p class="muted small">
    {usesCurve ? 'Schnellste Abschnitte aus allen Läufen (auch mitten in längeren Läufen), von intervals.icu.' : 'Aus ganzen Läufen berechnet (genauere Abschnittszeiten nach dem nächsten Abgleich).'}
    Prognose aus deinen Bestleistungen der letzten 12 Monate (Riegel-Formel){rows.at(-1)?.predicted ? ', beim Marathon abhängig von deinem Wochenumfang' : ''}. Tippe auf eine Zeit, um den Lauf zu öffnen.
  </p>
  {#if err}<p class="error small">{err}</p>{/if}
  {#if app.connected}<button class="link" disabled={busy} onclick={() => load(true)}>{busy ? 'Lade …' : 'Neu berechnen'}</button>{/if}
</section>

<style>
  .best { margin-bottom: 12px; }
  .head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
  .head h2 { margin: 0; }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  th, td { text-align: left; padding: 8px 4px; border-top: 1px solid var(--line); vertical-align: top; font-size: 14px; }
  thead th { border-top: none; font-size: 12px; color: var(--muted); font-weight: 600; padding-top: 0; }
  tbody th { font-weight: 600; white-space: nowrap; }
  td button { background: none; border: none; font: inherit; color: var(--text); padding: 0; text-align: left; cursor: pointer; display: flex; flex-direction: column; }
  td b { font-weight: 650; }
  td small { display: block; font-size: 11px; color: var(--muted); }
  .pred { color: var(--accent); }
  .small { font-size: 12px; margin: 10px 0 0; line-height: 1.45; }
  .link { background: none; border: none; color: var(--accent); font: inherit; font-weight: 600; padding: 8px 0 0; cursor: pointer; }
</style>
