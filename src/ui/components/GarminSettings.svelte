<script lang="ts">
  import { fmtAgo } from '../../core/dates';
  import { getCfg, setCfg, removeAll, DEFAULT_CFG, type GarminCfg } from '../../domain/planner/garmin';
  import { app, pushNow } from '../app.svelte';

  let cfg = $state<GarminCfg>({ ...DEFAULT_CFG });
  let msg = $state('');
  getCfg().then(c => (cfg = c));

  async function toggle(enabled: boolean) {
    msg = '';
    cfg = { ...cfg, enabled };
    await setCfg(cfg);
    if (enabled) {
      const r = await pushNow();
      if (r) msg = `${r.total} Einheiten für die nächsten ${cfg.days} Tage in intervals.icu eingetragen.`;
    } else {
      try { const n = await removeAll(); msg = n ? `${n} geplante Einheiten aus intervals.icu entfernt.` : ''; }
      catch (e) { app.garmin.error = e instanceof Error ? e.message : String(e); }
    }
  }
  async function setKraft(kraft: boolean) { cfg = { ...cfg, kraft }; await setCfg(cfg); }
  async function now() {
    msg = '';
    const r = await pushNow();
    if (r) msg = r.created + r.updated + r.removed ? `Neu ${r.created} · geändert ${r.updated} · entfernt ${r.removed}.` : 'Alles schon aktuell.';
  }
</script>

<section class="card list">
  <label class="sw"><span>Geplante Einheiten an die Uhr senden</span>
    <input type="checkbox" role="switch" checked={cfg.enabled} disabled={!app.connected} onchange={e => toggle(e.currentTarget.checked)} /></label>
  {#if cfg.enabled}
    <label class="sw"><span>Krafttraining auch senden</span>
      <input type="checkbox" role="switch" checked={cfg.kraft} onchange={e => setKraft(e.currentTarget.checked)} /></label>
    <div><span>Zuletzt gesendet</span><b>{app.garmin.last ? `${fmtAgo(app.garmin.last.at)} · ${app.garmin.last.total} Einheiten` : '–'}</b></div>
    <button class="rowbtn" onclick={now} disabled={app.garmin.busy}><span>Nächste {cfg.days} Tage</span><b>{app.garmin.busy ? 'Sende …' : 'Jetzt senden'}</b></button>
  {/if}
</section>
{#if app.garmin.error}<p class="error hint">{app.garmin.error}</p>{/if}
<p class="muted hint">
  {#if msg}{msg} {/if}
  {#if !app.connected}Erst intervals.icu verbinden.
  {:else}Basislager trägt deine Einheiten der nächsten {cfg.days} Tage als strukturierte Workouts (Pulsbereiche und Pace) in den intervals.icu-Kalender ein und hält sie bei Planänderungen aktuell. Damit sie auf der Uhr landen, in intervals.icu unter Einstellungen → Garmin das Hochladen geplanter Workouts einschalten.{/if}
</p>

<style>
  .list { padding: 4px 20px 8px; }
  .list > div, .sw { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; font-size: 15px; gap: 10px; }
  .sw { border-top: 1px solid var(--line); min-height: 48px; }
  .sw:first-child { border-top: none; }
  .list > div { border-top: 1px solid var(--line); }
  .list span { color: var(--muted); white-space: nowrap; }
  .list > div b { text-align: right; font-weight: 600; }
  .sw span { color: var(--text); white-space: normal; }
  .rowbtn { display: flex; justify-content: space-between; width: 100%; background: none; border: none; border-top: 1px solid var(--line);
            padding: 14px 0; color: var(--text); font-size: 15px; min-height: 48px; cursor: pointer; }
  .rowbtn b { color: var(--accent); }
  .hint { font-size: 13px; margin: 8px 4px 0; }
  input[role='switch'] { appearance: none; -webkit-appearance: none; width: 51px; height: 31px; border-radius: 16px; background: var(--line);
    position: relative; flex-shrink: 0; transition: background .2s; margin: 0; cursor: pointer; }
  input[role='switch']::after { content: ''; position: absolute; top: 2px; left: 2px; width: 27px; height: 27px; border-radius: 50%; background: #fff;
    box-shadow: 0 2px 4px rgba(0,0,0,.25); transition: transform .2s; }
  input[role='switch']:checked { background: var(--green); }
  input[role='switch']:checked::after { transform: translateX(20px); }
  input[role='switch']:disabled { opacity: .4; }
</style>
