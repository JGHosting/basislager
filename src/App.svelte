<script lang="ts">
  import { onMount } from 'svelte';
  import { getSetting, setSetting, deleteSetting, requestPersistence } from './core/db';
  import { icu, IcuError, normalizeAthleteId, type Credentials, type IcuActivity, type IcuWellness } from './sources/intervals/client';

  // Zustand
  let cred = $state<Credentials | null>(null);
  let athleteInput = $state('');
  let keyInput = $state('');
  let busy = $state(false);
  let error = $state('');
  let athleteName = $state('');
  let activities = $state<IcuActivity[]>([]);
  let wellness = $state<IcuWellness[]>([]);
  let persist = $state<'granted' | 'denied' | 'unsupported' | '…'>('…');
  const standalone = typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true);

  onMount(async () => {
    persist = await requestPersistence();
    const saved = await getSetting<Credentials>('intervals');
    if (saved) { cred = saved; await load(saved); }
  });

  async function load(c: Credentials) {
    busy = true; error = '';
    try {
      const [a, acts, well] = await Promise.all([icu.athlete(c), icu.activities(c, 30), icu.wellness(c, 7)]);
      athleteName = a.firstname || a.name || a.id;
      activities = acts.sort((x, y) => y.start_date_local.localeCompare(x.start_date_local));
      wellness = well.sort((x, y) => y.id.localeCompare(x.id));
      return true;
    } catch (e) {
      error = e instanceof IcuError ? e.message : 'Unbekannter Fehler: ' + String(e);
      return false;
    } finally { busy = false; }
  }

  async function connect(ev: Event) {
    ev.preventDefault();
    const c = { athleteId: normalizeAthleteId(athleteInput), apiKey: keyInput.trim() };
    if (!c.apiKey) { error = 'Bitte den API-Schlüssel eintragen.'; return; }
    if (await load(c)) { await setSetting('intervals', c); cred = c; keyInput = ''; }
  }

  async function disconnect() {
    await deleteSetting('intervals');
    cred = null; activities = []; wellness = []; athleteName = '';
  }

  // Anzeige-Helfer
  const SPORT: Record<string, string> = {
    Run: 'Laufen', TrailRun: 'Trailrun', VirtualRun: 'Laufen (indoor)', Ride: 'Rad', VirtualRide: 'Rad (indoor)',
    GravelRide: 'Gravel', MountainBikeRide: 'MTB', Swim: 'Schwimmen', OpenWaterSwim: 'Freiwasser',
    WeightTraining: 'Kraft', Workout: 'Workout', Hike: 'Wandern', Walk: 'Gehen', AlpineSki: 'Ski',
    BackcountrySki: 'Skitour', NordicSki: 'Langlauf', Snowboard: 'Snowboard', RockClimbing: 'Klettern', Yoga: 'Yoga'
  };
  const sport = (t: string) => SPORT[t] ?? t;
  const dur = (s?: number) => { if (!s) return '–'; const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h} h ${m} min` : `${m} min`; };
  const km = (m?: number) => (m ? (m / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' km' : '');
  const day = (iso: string) => new Date(iso).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
  const n = (v?: number | null, unit = '') => (v == null ? '–' : Math.round(v) + unit);
  const sleepH = (s?: number | null) => (s == null ? '–' : (s / 3600).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' h');
  const hasWellness = $derived(wellness.some(w => w.hrv != null || w.sleepScore != null || w.restingHR != null));
  const withoutData = $derived(activities.filter(a => !a.moving_time && !a.elapsed_time).length);
</script>

<header>
  <div class="logo" aria-hidden="true">
    <svg viewBox="0 0 32 32"><path d="M3 26 L13 9 L18 17 L21 13 L29 26 Z" fill="currentColor"/></svg>
  </div>
  <div>
    <h1>Basislager</h1>
    <p class="sub">Testversion · Verbindung zu intervals.icu</p>
  </div>
</header>

{#if !cred}
  <form class="card" onsubmit={connect}>
    <h2>Mit intervals.icu verbinden</h2>
    <p class="muted">Beides findest du in intervals.icu unter Settings → Developer Settings. Der Schlüssel bleibt nur auf diesem Gerät.</p>
    <label>Athlete-ID
      <input bind:value={athleteInput} placeholder="i123456" autocapitalize="off" autocomplete="off" required />
    </label>
    <label>API-Schlüssel
      <input bind:value={keyInput} type="password" placeholder="Schlüssel einfügen" autocapitalize="off" autocomplete="off" required />
    </label>
    {#if error}<p class="error">{error}</p>{/if}
    <button class="primary" disabled={busy}>{busy ? 'Verbinde …' : 'Verbindung testen'}</button>
  </form>
{:else}
  <section class="card ok">
    <div class="row"><span class="dot"></span><h2>Verbunden{athleteName ? ` als ${athleteName}` : ''}</h2></div>
    {#if error}<p class="error">{error}</p>{/if}
    <div class="actions">
      <button onclick={() => cred && load(cred)} disabled={busy}>{busy ? 'Lade …' : 'Neu laden'}</button>
      <button class="ghost" onclick={disconnect}>Trennen</button>
    </div>
  </section>

  <section class="card">
    <h2>Morgenwerte · letzte 7 Tage</h2>
    {#if !hasWellness}
      <p class="muted">Keine HRV-, Schlaf- oder Ruhepulswerte gefunden. Dann bleibt es beim manuellen Morgenpopup.</p>
    {:else}
      <table>
        <thead><tr><th>Tag</th><th>HRV</th><th>Schlaf</th><th>Score</th><th>Ruhepuls</th></tr></thead>
        <tbody>
          {#each wellness as w}
            <tr><td>{day(w.id)}</td><td>{n(w.hrv, ' ms')}</td><td>{sleepH(w.sleepSecs)}</td><td>{n(w.sleepScore)}</td><td>{n(w.restingHR)}</td></tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </section>

  <section class="card">
    <h2>Aktivitäten · letzte 30 Tage <span class="count">{activities.length}</span></h2>
    {#if withoutData > 0}
      <p class="warn">{withoutData} Aktivität(en) ohne Daten. Die kommen vermutlich über Strava und werden von intervals.icu nicht weitergegeben.</p>
    {/if}
    {#if activities.length === 0}
      <p class="muted">Keine Aktivitäten im Zeitraum.</p>
    {/if}
    <ul class="acts">
      {#each activities as a}
        <li>
          <div>
            <strong>{sport(a.type)}</strong>
            <span class="muted">{day(a.start_date_local)}{a.name ? ' · ' + a.name : ''}</span>
          </div>
          <div class="right">
            <span>{dur(a.moving_time ?? a.elapsed_time)}</span>
            <span class="muted">{km(a.distance)}{a.average_heartrate ? ' · Ø ' + Math.round(a.average_heartrate) + ' bpm' : ''}</span>
          </div>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<section class="card small">
  <h2>Gerätecheck</h2>
  <p>Als App installiert: <b>{standalone ? 'ja' : 'nein (läuft im Browser)'}</b></p>
  <p>Dauerhafter Speicher: <b>{persist === 'granted' ? 'gewährt' : persist === 'denied' ? 'nicht gewährt' : persist === 'unsupported' ? 'nicht unterstützt' : '…'}</b></p>
</section>

<style>
  header { display: flex; align-items: center; gap: 14px; padding: 20px 4px 16px; }
  .logo { width: 48px; height: 48px; border-radius: 14px; background: var(--accent); color: #fff; display: grid; place-items: center; }
  .logo svg { width: 30px; height: 30px; }
  h1 { margin: 0; font-size: 28px; letter-spacing: -0.02em; }
  .sub { margin: 2px 0 0; color: var(--muted); font-size: 14px; }
  h2 { margin: 0 0 10px; font-size: 18px; }
  .card { background: var(--card); border-radius: var(--radius); padding: 20px; margin-bottom: 14px;
          box-shadow: 0 1px 2px rgba(0,0,0,.04); animation: in .25s ease-out; }
  @keyframes in { from { opacity: 0; transform: translateY(6px); } }
  .muted { color: var(--muted); }
  p { margin: 6px 0; line-height: 1.4; }
  label { display: block; margin: 14px 0 0; font-size: 14px; color: var(--muted); }
  input { display: block; width: 100%; margin-top: 6px; padding: 14px; font-size: 17px; border-radius: 14px;
          border: 1px solid var(--line); background: var(--bg); color: var(--text); }
  input:focus { outline: 2px solid var(--accent); border-color: transparent; }
  button { min-height: 48px; padding: 0 18px; border-radius: 14px; border: 1px solid var(--line);
           background: var(--bg); color: var(--text); font-weight: 600; font-size: 16px; cursor: pointer; }
  button:disabled { opacity: .6; }
  .primary { width: 100%; margin-top: 18px; background: var(--accent); border: none; color: #fff; }
  .ghost { background: transparent; }
  .actions { display: flex; gap: 10px; margin-top: 12px; }
  .actions button { flex: 1; }
  .row { display: flex; align-items: center; gap: 10px; }
  .row h2 { margin: 0; }
  .dot { width: 12px; height: 12px; border-radius: 50%; background: var(--green); box-shadow: 0 0 0 4px color-mix(in srgb, var(--green) 25%, transparent); }
  .error { color: var(--red); font-weight: 500; }
  .warn { background: var(--accent-soft); padding: 10px 12px; border-radius: 12px; font-size: 14px; }
  .count { font-size: 14px; color: var(--muted); font-weight: 500; margin-left: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; font-variant-numeric: tabular-nums; }
  th { text-align: left; color: var(--muted); font-weight: 500; padding: 6px 4px; }
  td { padding: 8px 4px; border-top: 1px solid var(--line); }
  .acts { list-style: none; margin: 0; padding: 0; }
  .acts li { display: flex; justify-content: space-between; gap: 12px; padding: 12px 0; border-top: 1px solid var(--line); }
  .acts li:first-child { border-top: none; }
  .acts div { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .acts .muted { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .right { text-align: right; align-items: flex-end; flex-shrink: 0; font-variant-numeric: tabular-nums; }
  .small p { font-size: 14px; }
</style>
