<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db } from '../../core/db';
  import { loadSports, saveSports } from '../../domain/planner/repo';
  import { SPORTS, MAX_PER_WEEK, activeSports, type EnduranceSport, type SportsSetting, type SportMode } from '../../domain/planner/sports';
  import SportIcon from './SportIcon.svelte';

  // neu laden, wenn sich Einstellungen ändern (z. B. Backup-Import)
  const q = liveQuery(async () => { await db.settings.where('key').anyOf('sports', 'runsPerWeek').toArray(); return loadSports(); });
  const ICON: Record<EnduranceSport, string> = { lauf: 'Run', rad: 'Ride', schwimmen: 'Swim' };

  function update(s: SportsSetting, sport: EnduranceSport, change: { perWeek?: number; mode?: SportMode }) {
    saveSports({ ...s, list: s.list.map(c => (c.sport === sport ? { ...c, ...change } : c)) });
  }
  const setMain = (s: SportsSetting, sport: EnduranceSport) => saveSports({ ...s, main: sport });
</script>

{#if $q}
  {@const act = activeSports($q)}
  <section class="card sports">
    {#each SPORTS as sp}
      {@const c = $q.list.find(x => x.sport === sp.id)!}
      <div class="sp" class:off={!c.perWeek}>
        <div class="top">
          <SportIcon type={ICON[sp.id]} size={30} />
          <b>{sp.label}</b>
          {#if c.perWeek && $q.main === sp.id}<span class="badge">Hauptsportart</span>
          {:else if c.perWeek && act.length > 1}<button class="mk" onclick={() => setMain($q, sp.id)}>als Hauptsportart</button>{/if}
        </div>
        <div class="seg n" role="radiogroup" aria-label="{sp.label}: Einheiten pro Woche">
          {#each Array.from({ length: MAX_PER_WEEK + 1 }, (_, i) => i) as n}
            <button role="radio" aria-checked={c.perWeek === n} class:on={c.perWeek === n} onclick={() => update($q, sp.id, { perWeek: n })}>{n === 0 ? 'aus' : `${n}×`}</button>
          {/each}
        </div>
        {#if c.perWeek}
          <div class="seg m" role="radiogroup" aria-label="{sp.label}: Trainingsziel">
            <button role="radio" aria-checked={c.mode === 'grundlage'} class:on={c.mode === 'grundlage'} onclick={() => update($q, sp.id, { mode: 'grundlage' })}>
              <b>Nur Grundlage</b><small>alles in Zone 2</small></button>
            <button role="radio" aria-checked={c.mode === 'leistung'} class:on={c.mode === 'leistung'} onclick={() => update($q, sp.id, { mode: 'leistung' })}>
              <b>Leistung steigern</b><small>{sp.id === 'lauf' ? 'plus Tempo & Intervalle' : 'plus Intervalle'}</small></button>
          </div>
        {/if}
      </div>
    {/each}
  </section>
  <p class="muted hint">
    {#if !act.length}Keine Ausdauer-Sportart aktiv – der Plan enthält nur Kraft.{:else}
    Die Hauptsportart bekommt die besten Tage (lange Einheit am Samstag, Qualität am Donnerstag), weitere Sportarten werden drumherum verteilt – möglichst eine Ausdauereinheit pro Tag und harte Einheiten mit Abstand.
    „Leistung steigern“ plant höchstens zwei harte Einheiten pro Sportart und Woche, der Rest bleibt locker.
    Bei einem Wettkampf bestimmt der Wettkampfplan die Wettkampfsportart, andere Sportarten laufen mit – in den letzten Wochen davor nur noch locker.{/if}
  </p>
{/if}

<style>
  .sports { padding: 4px 16px; }
  .sp { padding: 14px 0; border-top: 1px solid var(--line); }
  .sp:first-child { border-top: none; }
  .top { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
  .top b { flex: 1; font-size: 16px; }
  .off .top b { color: var(--muted); }
  .badge { font-size: 12px; font-weight: 700; color: var(--accent); background: var(--accent-soft); border-radius: 8px; padding: 4px 8px; }
  .mk { border: none; background: none; color: var(--accent); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; padding: 4px 0; }
  .seg { display: grid; gap: 4px; background: var(--bg); border-radius: 12px; padding: 4px; }
  .seg.n { grid-template-columns: repeat(6, 1fr); }
  .seg.m { grid-template-columns: 1fr 1fr; margin-top: 8px; }
  .seg button { border: none; background: none; font: inherit; font-size: 15px; font-weight: 600; color: var(--muted); padding: 9px 0; border-radius: 9px; cursor: pointer; min-height: 40px; }
  .seg.m button { display: flex; flex-direction: column; gap: 1px; padding: 8px 6px; }
  .seg.m small { font-size: 11px; font-weight: 500; opacity: .85; }
  .seg button.on { background: var(--accent); color: #fff; }
  .hint { font-size: 13px; margin: 8px 4px 0; line-height: 1.45; }
</style>
