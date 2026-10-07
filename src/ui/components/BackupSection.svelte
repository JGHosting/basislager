<script lang="ts">
  import { app, refreshAfterImport } from '../app.svelte';
  import { fmtAgo, fmtDay } from '../../core/dates';
  import { num } from '../format';
  import {
    exportBackup, backupFileName, shareFile, markBackupDone, checkBackup, importBackup,
    runRoundtripTest, listSnapshots, restoreSnapshot, activitiesCsv, morningCsv,
    type Preview, type ImportMode, type RoundtripResult
  } from '../../backup/backup';

  let busy = $state(''), msg = $state(''), err = $state('');
  let preview = $state.raw<Preview | null>(null);
  let mode = $state<ImportMode>('merge');
  let test = $state<RoundtripResult | null>(null);
  let snaps = $state<Awaited<ReturnType<typeof listSnapshots>>>([]);
  let showSnaps = $state(false);
  let fileInput: HTMLInputElement;

  const daysSince = $derived(app.lastBackupAt ? Math.floor((Date.now() - app.lastBackupAt) / 86400000) : null);

  async function doExport() {
    busy = 'export'; err = ''; msg = '';
    try {
      const b = await exportBackup();
      if (await shareFile(JSON.stringify(b), backupFileName(), 'application/json')) {
        await markBackupDone(); await refreshAfterImport();
        msg = `Backup gespeichert: ${num(b.tables.activities.length)} Aktivitäten, ${num(b.tables.morning.length)} Tage Morgenwerte.`;
      }
    } catch (e) { err = 'Export fehlgeschlagen: ' + (e as Error).message; }
    busy = '';
  }

  async function pick(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = '';
    if (!f) return;
    err = ''; msg = ''; test = null;
    preview = checkBackup(await f.text());
    mode = 'merge';
  }

  async function doImport() {
    if (!preview?.data) return;
    busy = 'import'; err = '';
    try {
      const r = await importBackup(preview.data, mode);
      await refreshAfterImport();
      msg = mode === 'replace'
        ? `Daten ersetzt: ${num(r.added)} Einträge eingespielt. Eine Sicherheitskopie des alten Stands liegt unten bereit.`
        : `Zusammengeführt: ${num(r.added)} neu, ${num(r.updated)} aktualisiert, ${num(r.unchanged)} unverändert.`;
      preview = null;
    } catch (e) { err = 'Import abgebrochen, deine Daten sind unverändert. (' + (e as Error).message + ')'; }
    busy = '';
  }

  async function doTest() {
    busy = 'test'; err = ''; msg = ''; test = null;
    try { test = await runRoundtripTest(); } catch (e) { err = 'Prüfroutine fehlgeschlagen: ' + (e as Error).message; }
    busy = '';
  }

  async function toggleSnaps() {
    showSnaps = !showSnaps;
    if (showSnaps) snaps = await listSnapshots();
  }
  let confirmSnap = $state<number | null>(null);
  async function doRestore(seq: number) {
    busy = 'restore'; err = ''; confirmSnap = null;
    try { await restoreSnapshot(seq); await refreshAfterImport(); msg = 'Sicherheitskopie wiederhergestellt.'; snaps = await listSnapshots(); }
    catch (e) { err = (e as Error).message; }
    busy = '';
  }

  async function csv(which: 'activities' | 'morning') {
    const text = which === 'activities' ? await activitiesCsv() : await morningCsv();
    await shareFile(text, backupFileName('csv', which === 'activities' ? 'aktivitaeten' : 'morgenwerte'), 'text/csv');
  }
</script>

<section class="card">
  <div class="status" class:warn={daysSince == null || daysSince > 30}>
    <b>{daysSince == null ? 'Noch kein Backup' : daysSince === 0 ? 'Letztes Backup heute' : `Letztes Backup ${fmtAgo(app.lastBackupAt)}`}</b>
    <span>Speichere das Backup in der Dateien-App (iCloud Drive), nicht nur auf dem iPhone. Vor iOS-Updates oder Gerätewechsel immer ein frisches Backup machen.</span>
  </div>
  <button class="btn primary wide" onclick={doExport} disabled={!!busy}>{busy === 'export' ? 'Erstelle …' : 'Backup erstellen'}</button>
  <button class="btn wide" onclick={() => fileInput.click()} disabled={!!busy}>Backup importieren</button>
  <input bind:this={fileInput} type="file" accept=".json,application/json" onchange={pick} hidden />
  {#if msg}<p class="okmsg">{msg}</p>{/if}
  {#if err}<p class="error">{err}</p>{/if}
</section>

{#if preview}
  <section class="card sheet">
    <h2>Backup prüfen</h2>
    {#if !preview.ok}
      <p class="error">{preview.fatal}</p>
      <p class="muted small">Es wurde nichts verändert.</p>
      <button class="btn wide" onclick={() => (preview = null)}>Schließen</button>
    {:else}
      <div class="list">
        {#if preview.exportedAt}<div><span>Erstellt am</span><b>{new Date(preview.exportedAt).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}</b></div>{/if}
        <div><span>Aktivitäten</span><b>{num(preview.counts.activities)}</b></div>
        <div><span>Tage mit Morgenwerten</span><b>{num(preview.counts.morning)}</b></div>
        <div><span>Krafteinheiten</span><b>{num(preview.counts.strength)}</b></div>
        <div><span>Einstellungen</span><b>{num(preview.counts.settings)}</b></div>
        {#if preview.range}<div><span>Zeitraum</span><b>{fmtDay(preview.range.from, { day: '2-digit', month: '2-digit', year: 'numeric' })} – {fmtDay(preview.range.to, { day: '2-digit', month: '2-digit', year: 'numeric' })}</b></div>{/if}
      </div>
      {#each preview.warnings as w}<p class="warnmsg">{w}</p>{/each}
      <div class="modes">
        <label class:sel={mode === 'merge'}><input type="radio" bind:group={mode} value="merge" />
          <span><b>Zusammenführen</b><small>Fehlendes ergänzen. Bei doppelten Einträgen gewinnt der neuere Stand.</small></span></label>
        <label class:sel={mode === 'replace'}><input type="radio" bind:group={mode} value="replace" />
          <span><b>Alles ersetzen</b><small>Aktuelle Daten werden durch das Backup ersetzt. Die intervals.icu-Verbindung bleibt.</small></span></label>
      </div>
      <p class="muted small">Vorher wird automatisch eine Sicherheitskopie deines aktuellen Stands angelegt.</p>
      <div class="actions">
        <button class="btn primary" onclick={doImport} disabled={!!busy}>{busy === 'import' ? 'Importiere …' : 'Importieren'}</button>
        <button class="btn ghost" onclick={() => (preview = null)}>Abbrechen</button>
      </div>
    {/if}
  </section>
{/if}

<section class="card list compact">
  <button class="rowbtn" onclick={doTest} disabled={!!busy}>
    <span>Backup-Prüfroutine</span><b>{busy === 'test' ? 'läuft …' : 'Starten'}</b>
  </button>
  {#if test}
    <p class={test.ok ? 'okmsg' : 'error'}>
      {test.ok ? '✓ ' : '✗ '}{test.message}
      {#if test.ok}<br /><small>{num(test.counts.activities)} Aktivitäten, {num(test.counts.morning)} Morgenwerte, {num(test.counts.strength)} Krafteinheiten, {num(test.counts.settings)} Einstellungen verglichen · {Math.round(test.ms)} ms</small>{/if}
    </p>
  {/if}
  <button class="rowbtn" onclick={() => csv('activities')}><span>Aktivitäten als CSV</span><b>Teilen</b></button>
  <button class="rowbtn" onclick={() => csv('morning')}><span>Morgenwerte als CSV</span><b>Teilen</b></button>
  <button class="rowbtn" onclick={toggleSnaps}><span>Sicherheitskopien</span><b>{showSnaps ? 'Ausblenden' : 'Anzeigen'}</b></button>
  {#if showSnaps}
    {#if snaps.length === 0}<p class="muted small">Noch keine. Sie entstehen automatisch vor jedem Import.</p>{/if}
    {#each snaps as s}
      <div class="snap">
        <span>{new Date(s.createdAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })} · {s.reason}<br /><small class="muted">{num(s.counts.activities)} Aktivitäten, {num(s.counts.morning)} Morgenwerte</small></span>
        {#if confirmSnap === s.seq}
          <button class="btn primary sm" onclick={() => doRestore(s.seq)}>Sicher?</button>
        {:else}
          <button class="btn sm" onclick={() => (confirmSnap = s.seq)} disabled={!!busy}>Zurück</button>
        {/if}
      </div>
    {/each}
  {/if}
</section>

<style>
  .status { display: flex; flex-direction: column; gap: 4px; padding: 12px 14px; border-radius: 14px; background: var(--bg); }
  .status.warn { background: var(--accent-soft); }
  .status span { font-size: 13px; color: var(--muted); line-height: 1.4; }
  .btn.wide + .btn.wide { margin-top: 10px; }
  .okmsg { color: var(--green); font-weight: 500; font-size: 14px; }
  .warnmsg { background: var(--accent-soft); padding: 8px 12px; border-radius: 10px; font-size: 13px; }
  .small { font-size: 13px; }
  .sheet { outline: 2px solid var(--accent); }
  .list > div { display: flex; justify-content: space-between; gap: 12px; padding: 10px 0; border-top: 1px solid var(--line); font-size: 15px; }
  .list > div:first-child { border-top: none; }
  .list span { color: var(--muted); }
  .list b { text-align: right; font-variant-numeric: tabular-nums; }
  .modes { display: flex; flex-direction: column; gap: 8px; margin: 12px 0 6px; }
  .modes label { display: flex; gap: 12px; align-items: flex-start; margin: 0; padding: 12px; border-radius: 14px; border: 1px solid var(--line); color: var(--text); }
  .modes label.sel { border-color: var(--accent); background: var(--accent-soft); }
  .modes input { width: auto; margin: 3px 0 0; accent-color: var(--accent); }
  .modes span { display: flex; flex-direction: column; gap: 2px; }
  .modes small { color: var(--muted); font-size: 13px; line-height: 1.35; }
  .actions { display: flex; gap: 10px; margin-top: 12px; }
  .actions .btn { flex: 1; }
  .compact { padding: 4px 20px; }
  .rowbtn { display: flex; justify-content: space-between; width: 100%; background: none; border: none; border-top: 1px solid var(--line);
            padding: 14px 0; color: var(--text); font-size: 15px; text-align: left; min-height: 48px; cursor: pointer; }
  .compact > .rowbtn:first-child { border-top: none; }
  .rowbtn b { color: var(--accent); font-weight: 600; }
  .snap { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 10px 0; font-size: 14px; border-top: 1px solid var(--line); }
  .btn.sm { min-height: 36px; padding: 0 14px; font-size: 14px; }
</style>
