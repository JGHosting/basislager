<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db } from '../../core/db';
  import { fmtDay, fmtAgo } from '../../core/dates';
  import { app, sync, disconnect, reloadHistory, askPersist, openInjury } from '../app.svelte';
  import { num } from '../format';
  import ConnectForm from '../components/ConnectForm.svelte';
  import BackupSection from '../components/BackupSection.svelte';
  import HrSettings from '../components/HrSettings.svelte';
  import SplitSettings from '../components/SplitSettings.svelte';
  import SportSettings from '../components/SportSettings.svelte';
  import WeightSettings from '../components/WeightSettings.svelte';
  import GarminSettings from '../components/GarminSettings.svelte';
  import WarmupSettings from '../components/WarmupSettings.svelte';
  import Statistik from './Statistik.svelte';

  type Section = 'statistik' | 'training' | 'koerper' | 'verbindungen' | 'daten' | 'ueber' | null;
  let section = $state<Section>(null);
  const SECTIONS: { id: Exclude<Section, null>; label: string }[] = [
    { id: 'statistik', label: 'Statistik' },
    { id: 'training', label: 'Training' },
    { id: 'koerper', label: 'Körper' },
    { id: 'verbindungen', label: 'Verbindungen' },
    { id: 'daten', label: 'Daten' },
    { id: 'ueber', label: 'Über' }
  ];

  const counts = liveQuery(async () => ({
    activities: await db.activities.count(),
    morning: await db.morning.count(),
    first: (await db.activities.orderBy('date').first())?.date
  }));
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
  let confirmReload = $state(false);
  import { viewportInfo } from '../../core/viewport';
  import { BLS_ATTRIBUTION } from '../../domain/nutrition/bls';
  import { OFF_ATTRIBUTION } from '../../domain/nutrition/off';
  let vp = $state<ReturnType<typeof viewportInfo> | null>(null);
</script>

{#if section === null}
  <header class="page-head"><div><h1>Mehr</h1></div></header>
  <section class="card menu">
    {#each SECTIONS as s}
      <button class="rowbtn" onclick={() => (section = s.id)}><span>{s.label}</span><span class="chev">›</span></button>
    {/each}
  </section>
  <p class="muted small footer">Basislager · Version {__APP_VERSION__}</p>
{:else}
  <header class="page-head sub">
    <button class="back" onclick={() => (section = null)} aria-label="Zurück">‹</button>
    <h1>{SECTIONS.find(s => s.id === section)?.label}</h1>
  </header>

  {#if section === 'statistik'}
    <Statistik />
  {:else if section === 'training'}
    <h3 class="section">Sportarten</h3>
    <SportSettings />
    <h3 class="section">Kraft-Split</h3>
    <SplitSettings />
    <h3 class="section">Pulswerte</h3>
    <HrSettings />
    <h3 class="section">Aufwärmen</h3>
    <WarmupSettings />
  {:else if section === 'koerper'}
    <h3 class="section">Gewicht</h3>
    <WeightSettings />
    <h3 class="section">Verletzung</h3>
    <section class="card">
      <p class="small">Aktive Verletzung, Rückkehr-Stufen und betroffene Bewegungen verwalten.</p>
      <button class="btn ghost wide" onclick={() => openInjury()}>Verletzung verwalten</button>
    </section>
  {:else if section === 'verbindungen'}
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
    <h3 class="section">Garmin-Uhr</h3>
    <GarminSettings />
  {:else if section === 'daten'}
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
    <h3 class="section">Backup</h3>
    <BackupSection />
    <h3 class="section">Gerät</h3>
    <section class="card list">
      <div><span>Als App installiert</span><b>{standalone ? 'ja' : 'nein, läuft im Browser'}</b></div>
      <div><span>Dauerhafter Speicher</span><b>{app.persist === 'granted' ? 'gewährt' : app.persist === 'unsupported' ? 'nicht unterstützt' : 'nicht gewährt'}</b></div>
    </section>
    {#if app.persist === 'denied'}
      <button class="btn ghost wide" onclick={askPersist}>Dauerhaften Speicher erneut anfragen</button>
      <p class="muted small hint">Safari entscheidet selbst und gewährt ihn oft erst nach einiger Nutzung. Bis dahin schützen dich regelmäßige Backups.</p>
    {/if}
    <button class="btn ghost wide" onclick={() => (vp = viewportInfo())}>Anzeige-Maße prüfen</button>
    {#if vp}<p class="muted small hint">Fenster {vp.innerHeight} · sichtbar {vp.visual} · Dokument {vp.docHeight} · Bildschirm {vp.screenHeight} · App {vp.appHeight} · Leiste unten {vp.navBottom} · Rand oben {vp.safeTop} · unten {vp.safeBottom}</p>{/if}
  {:else if section === 'ueber'}
    <section class="card lic">
      <p><b>Bundeslebensmittelschlüssel (BLS) 4.0</b><br />{BLS_ATTRIBUTION} <a href="https://creativecommons.org/licenses/by/4.0/deed.de" target="_blank" rel="noopener">Lizenztext</a> · <a href="https://blsdb.de" target="_blank" rel="noopener">blsdb.de</a></p>
      <p><b>Open Food Facts</b><br />{OFF_ATTRIBUTION} <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener">ODbL</a> · <a href="https://world.openfoodfacts.org" target="_blank" rel="noopener">openfoodfacts.org</a>. An Open Food Facts wird nur der Suchbegriff bzw. Barcode gesendet.</p>
      <p><b>intervals.icu</b><br />Aktivitäten und Morgenwerte (Quelle: Garmin) über die API von intervals.icu.</p>
      <p><b>Karten</b><br />Kartendaten und -kacheln © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>-Mitwirkende.</p>
      <p><b>Sport-Icons</b><br />Material Symbols (Google), Apache License 2.0.</p>
      <p><b>Übungsbibliothek (Mobility)</b><br />Exercise data by RepDB (repdb.co).</p>
    </section>
    <p class="muted small footer">Basislager · Version {__APP_VERSION__}</p>
  {/if}
{/if}

<style>
  .page-head.sub { display: flex; align-items: center; gap: 4px; }
  .back { background: none; border: none; color: var(--accent); font-size: 26px; line-height: 1; padding: 4px 8px 4px 0; cursor: pointer; min-height: 44px; }
  .menu { padding: 2px 0; }
  .rowbtn { display: flex; justify-content: space-between; align-items: center; width: 100%; background: none; border: none; border-top: 1px solid var(--line);
            padding: 15px 20px; color: var(--text); font-size: 16px; min-height: 48px; cursor: pointer; text-align: left; }
  .rowbtn:first-child { border-top: none; }
  .chev { color: var(--muted); font-size: 18px; }
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
  .lic p { font-size: 13px; line-height: 1.5; color: var(--muted); margin: 0 0 10px; }
  .lic b { color: var(--text); }
  .lic a { color: var(--accent); }
</style>
