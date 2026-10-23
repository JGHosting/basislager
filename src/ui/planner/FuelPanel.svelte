<script lang="ts">
  import { onMount } from 'svelte';
  import type { PlanSession } from '../../domain/planner/plan';
  import { loadFuelEnv, planFor, setOverride, getLoc, setLoc, forecastTemps, LEVEL_LABEL, LEG_LABEL, levelOf, type FuelEnv, type FuelLevel } from '../../domain/nutrition/fueling';
  import { pushPlan } from '../../domain/planner/garmin';
  let { s }: { s: PlanSession } = $props();
  let env = $state.raw<FuelEnv | null>(null);
  let hasLoc = $state(true), locErr = $state('');
  async function load(fetchWeather = true) { env = await loadFuelEnv(fetchWeather); hasLoc = !!(await getLoc()); }
  onMount(() => load());
  const plan = $derived(env ? planFor(s, env) : null);
  const o = $derived(env?.overrides[s.key]);
  const autoTemp = $derived(env?.temps[s.date]);
  async function change(c: { level?: FuelLevel; tempC?: number; minutes?: number }) {
    await setOverride(s.key, { ...o, ...c });
    await load(false);
    pushPlan().catch(() => {});
  }
  async function resetDay() { await setOverride(s.key, o?.logged ? { level: undefined, tempC: undefined, minutes: undefined } : null); await load(false); pushPlan().catch(() => {}); }
  function useLocation() {
    locErr = '';
    if (!navigator.geolocation) { locErr = 'Standort nicht verfügbar.'; return; }
    navigator.geolocation.getCurrentPosition(async p => {
      await setLoc({ lat: Math.round(p.coords.latitude * 100) / 100, lon: Math.round(p.coords.longitude * 100) / 100 });
      await forecastTemps(true); await load(false);
    }, () => (locErr = 'Standort wurde nicht freigegeben – Temperatur unten von Hand wählen.'), { maximumAge: 86400e3, timeout: 15000 });
  }
  const eff = $derived(o?.tempC ?? autoTemp ?? null);
  const bucket = (t: number) => (t < 10 ? 5 : t < 20 ? 15 : t < 26 ? 23 : 30);
  const TEMPS = [{ v: 5, l: 'Kalt' }, { v: 15, l: 'Mild' }, { v: 23, l: 'Warm' }, { v: 30, l: 'Heiß' }];
  const hm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
  const levels: FuelLevel[] = ['z2', 'mittel', 'hart', 'wettkampf'];
  const isRace = $derived(s.sport === 'wettkampf');
  let durH = $state(''), durM = $state('');
  $effect(() => { if (plan && isRace) { durH = String(Math.floor(plan.minutes / 60)); durM = String(plan.minutes % 60).padStart(2, '0'); } });
  function setDur() {
    const m = (parseInt(durH) || 0) * 60 + (parseInt(durM) || 0);
    if (m >= 20 && m <= 24 * 60) change({ minutes: m });
  }
</script>

{#if plan}
  <div class="fuel">
    {#if isRace}
      <div class="dur">
        <span>Dauer</span>
        <input inputmode="numeric" bind:value={durH} onchange={setDur} aria-label="Stunden" /><span>h</span>
        <input inputmode="numeric" bind:value={durM} onchange={setDur} aria-label="Minuten" /><span>min</span>
        <small class="muted">{o?.minutes ? 'von Hand' : s.race?.estimated ? 'geschätzt aus Distanz und Tempo' : 'aus deiner Zielzeit'}</small>
      </div>
      {#if plan.legs.length > 1}<p class="muted small legs">{plan.legs.map(l => `${LEG_LABEL[l.sport]} ${hm(l.minutes)}`).join(' · ')}</p>{/if}
    {:else}
    <div class="chips">
      {#each levels as l}<button class:on={plan.level === l} onclick={() => change({ level: l })}>{LEVEL_LABEL[l]}</button>{/each}
    </div>
    {/if}
    <div class="chips">
      {#each TEMPS as t}<button class:on={eff != null && bucket(eff) === t.v} onclick={() => change({ tempC: t.v })}>{t.l}</button>{/each}
      <small class="muted tlabel">{o?.tempC != null ? 'von Hand' : autoTemp != null ? `Vorhersage ${Math.round(autoTemp)} °C` : 'keine Vorhersage'}</small>
    </div>
    {#if !hasLoc}<button class="link" onclick={useLocation}>Wetter automatisch: Standort einmal freigeben</button>{/if}
    {#if locErr}<p class="muted small">{locErr}</p>{/if}
    {#if o?.level || o?.tempC != null || o?.minutes}<button class="link" onclick={resetDay}>Automatisch (aus dem Plan) verwenden</button>{/if}

    <div class="kpis">
      <div><b>{plan.carbsPerHour || '–'}</b><small>g KH/h{plan.optional ? ' (optional)' : ''}</small></div>
      <div><b>{plan.fluidPerHour}</b><small>ml/h</small></div>
      <div><b>{plan.sodiumPerHour ?? '–'}</b><small>mg Na/h</small></div>
    </div>

    {#if plan.dayBefore}<h4>Vortag</h4><p>{plan.dayBefore}</p>{/if}
    <h4>Vorher</h4>
    <ul>{#each plan.before as t}<li>{t}</li>{/each}</ul>
    <h4>Unterwegs</h4>
    <ul>{#each plan.during as t}<li>{t}</li>{/each}</ul>
    {#if plan.intakes.length}
      <ol class="sched">
        {#each plan.intakes as i}<li><span class="t">{hm(i.min)}</span>{i.item.name}{#if i.leg}<em>{LEG_LABEL[i.leg]}</em>{/if}<small>{i.item.carbs} g</small></li>{/each}
      </ol>
      <p class="muted small">Gesamt ca. {plan.totals.carbs} g Kohlenhydrate, {plan.totals.kcal} kcal{plan.isoPerHour && s.sport !== 'schwimmen' ? ' (inkl. Iso)' : ''}, {(plan.totals.fluid / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} l trinken.{env?.settings.watch && s.status === 'offen' && !isRace ? ' Essenszeiten kommen als Schritte aufs Garmin-Workout.' : ''}</p>
    {/if}
    <h4>Danach</h4>
    <ul>{#each plan.after as t}<li>{t}</li>{/each}</ul>
    <p class="muted small">Allgemeine Richtwerte, keine Ernährungsberatung. Neues immer im Training ausprobieren, nie zuerst im Wettkampf. {isRace ? 'Uhrzeiten ab Start.' : `Belastung „${LEVEL_LABEL[levelOf(s)]}“ kommt aus dem Plan.`}</p>
  </div>
{/if}

<style>
  .fuel { border-left: 2px solid var(--line); padding: 2px 0 10px 10px; margin-bottom: 8px; font-size: 14px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 6px; }
  .chips button { border: 1px solid var(--line); background: var(--card); color: var(--text); border-radius: 10px; padding: 6px 9px; font: inherit; font-size: 12px; cursor: pointer; min-height: 32px; }
  .chips button.on { border-color: var(--accent); color: var(--accent); font-weight: 600; }
  .tlabel { font-size: 12px; }
  .link { background: none; border: none; color: var(--accent); font: inherit; font-size: 13px; padding: 2px 0 6px; cursor: pointer; display: block; }
  .kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin: 6px 0 4px; }
  .kpis div { background: var(--card); border-radius: 10px; padding: 8px; display: flex; flex-direction: column; align-items: center; }
  .kpis b { font-size: 18px; } .kpis small { font-size: 11px; color: var(--muted); text-align: center; }
  h4 { margin: 10px 0 4px; font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
  ul { margin: 0; padding-left: 18px; line-height: 1.45; } p { margin: 0; line-height: 1.45; }
  .sched { list-style: none; padding: 0; margin: 6px 0; }
  .sched li { display: flex; gap: 10px; align-items: baseline; padding: 5px 0; border-top: 1px solid var(--line); }
  .sched li:first-child { border-top: none; }
  .sched .t { font-variant-numeric: tabular-nums; font-weight: 600; min-width: 40px; }
  .sched small { margin-left: auto; color: var(--muted); }
  .small { font-size: 12px; margin-top: 6px; }
  .dur { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 6px; }
  .dur input { width: 44px; text-align: center; border: 1px solid var(--line); background: var(--card); color: var(--text); border-radius: 8px; padding: 6px 4px; font: inherit; font-size: 15px; }
  .dur small { width: 100%; font-size: 12px; }
  .legs { margin: 0 0 6px; }
  .sched em { font-style: normal; font-size: 11px; color: var(--muted); border: 1px solid var(--line); border-radius: 6px; padding: 1px 5px; }
</style>
