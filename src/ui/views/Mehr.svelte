<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db } from '../../core/db';
  import { fmtDay, fmtAgo } from '../../core/dates';
  import { app, sync, disconnect, reloadHistory, askPersist } from '../app.svelte';
  import { num } from '../format';
  import ConnectForm from '../components/ConnectForm.svelte';

  const counts = liveQuery(async () => ({
    activities: await db.activities.count(),
    morning: await db.morning.count(),
    first: (await db.activities.orderBy('date').first())?.date
  }));
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
  let confirmReload = $state(false);
</script>

<header class="page-head"><div><h1>Mehr</h1></div></header>

<h3 class="section">Datenquelle</h3>
{#if !app.connected}
  <ConnectForm />
{:else}
  <section class="card">
    <div class="row"><span class="ok-dot"></span><b>intervals.icu verbunden{app.athleteName ? ` · ${app.athleteName}` : ''}</b></div>
    <p class="muted small">Garmin → intervals.icu → Basislager. Abgleich automatisch beim Öffnen.</p>
    <div class="actions">
      <button class="btn" onclick={() => sync(true)} disabled={app.syncing}>{app.syncing ? 'Synchronisiere …' : 'Abgleichen'}</button>
      <button class="btn ghost" onclick={disconnect}>Trennen</button>
    </div>
    {#if app.syncError}<p class="error small">{app.syncError}</p>{/if}
  </section>
{/if}

<h3 class="section">Gespeicherte Daten</h3>
<section class="card list">
  <div><span>Aktivitäten</span><b>{num($counts?.activities ?? 0)}</b></div>
  <div><span>Tage mit Morgenwerten</span><b>{num($counts?.morning ?? 0)}</b></div>
  <div><span>Älteste Aktivität</span><b>{$counts?.first ? fmtDay($counts.first, { day: '2-digit', month: '2-digit', year: 'numeric' }) : '–'}</b></div>
  <div><span>Letzter Abgleich</span><b>{app.syncState.lastSyncAt ? fmtAgo(app.syncState.lastSyncAt) : '–'}</b></div>
  <div><span>Historie</span><b>{app.syncState.historyDone ? 'vollständig' : 'wird importiert'}</b></div>
  {#if app.syncState.skippedStrava}
    <div><span>Übersprungen (über Strava, ohne Daten)</span><b>{app.syncState.skippedStrava}</b></div>
  {/if}
</section>
{#if app.connected}
  {#if !confirmReload}
    <button class="btn ghost wide" onclick={() => (confirmReload = true)}>Historie komplett neu laden</button>
  {:else}
    <section class="card">
      <p class="small">Alle Aktivitäten werden neu von intervals.icu geholt und aktualisiert. Deine eigenen Eingaben bleiben unverändert.</p>
      <div class="actions">
        <button class="btn primary" onclick={() => { confirmReload = false; reloadHistory(); }}>Neu laden</button>
        <button class="btn ghost" onclick={() => (confirmReload = false)}>Abbrechen</button>
      </div>
    </section>
  {/if}
{/if}

<h3 class="section">Gerät</h3>
<section class="card list">
  <div><span>Als App installiert</span><b>{standalone ? 'ja' : 'nein, läuft im Browser'}</b></div>
  <div><span>Dauerhafter Speicher</span><b>{app.persist === 'granted' ? 'gewährt' : app.persist === 'unsupported' ? 'nicht unterstützt' : 'nicht gewährt'}</b></div>
</section>
{#if app.persist === 'denied'}
  <button class="btn ghost wide" onclick={askPersist}>Dauerhaften Speicher erneut anfragen</button>
  <p class="muted small hint">Safari entscheidet selbst und gewährt ihn oft erst nach einiger Nutzung. Bis dahin schützen dich Backups (kommt im nächsten Schritt).</p>
{/if}

<p class="muted small footer">Basislager · Version {__APP_VERSION__}</p>

<style>
  .section { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); font-weight: 600; margin: 22px 4px 8px; }
  .section:first-of-type { margin-top: 4px; }
  .row { display: flex; align-items: center; gap: 10px; }
  .ok-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--green); flex-shrink: 0; }
  .small { font-size: 14px; }
  .actions { display: flex; gap: 10px; margin-top: 12px; }
  .actions :global(.btn) { flex: 1; }
  .list { padding: 6px 20px; }
  .list div { display: flex; justify-content: space-between; gap: 12px; padding: 12px 0; border-top: 1px solid var(--line); font-size: 15px; }
  .list div:first-child { border-top: none; }
  .list span { color: var(--muted); }
  .list b { font-weight: 600; text-align: right; font-variant-numeric: tabular-nums; }
  .hint { margin: 8px 4px; }
  .footer { text-align: center; margin-top: 28px; }
</style>
