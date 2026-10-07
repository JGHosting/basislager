<script lang="ts">
  import type { Recovery } from '../../domain/recovery/recovery';
  import { RECOVERY } from '../../domain/recovery/recovery';
  import AmpelRing from './AmpelRing.svelte';
  import { num } from '../format';
  let { rec, injury = false }: { rec: Recovery; injury?: boolean } = $props();
  let open = $state(false);
  const title = $derived({ gruen: 'Gut erholt', gelb: 'Mittel erholt', rot: 'Wenig erholt', grau: 'Keine Bewertung' }[rec.light]);
  const fmtZ = (z: number | null) => (z == null ? '' : `${z > 0 ? '+' : ''}${z.toFixed(1).replace('.', ',')} σ`);
</script>

<section class="card ampel {rec.light}">
  <div class="top">
    <AmpelRing score={rec.score} light={rec.light} />
    <div class="txt">
      <span class="kicker">Tagesampel</span>
      <h2>{title}</h2>
      <p>{rec.advice}{injury ? ' Im Verletzungsmodus gilt zusätzlich: nur erlaubte Bewegungen.' : ''}</p>
    </div>
  </div>
  <div class="meta">
    {#if rec.buildingBaseline}<span class="pill">Baseline wird aufgebaut</span>{/if}
    {#if rec.used > 0 && rec.used < rec.total}<span class="pill">basiert auf {rec.used} von {rec.total} Werten</span>{/if}
    <button class="how" onclick={() => (open = !open)}>{open ? 'Rechenweg ausblenden' : 'Wie berechnet?'}</button>
  </div>
  {#if open}
    <table>
      <thead><tr><th>Wert</th><th>Heute</th><th>Ø 14 T</th><th>Punkte</th><th>Gew.</th></tr></thead>
      <tbody>
        {#each rec.components as c}
          <tr class:off={c.points == null}>
            <td>{c.label}</td>
            <td>{num(c.value)}</td>
            <td>{c.baseline == null ? (c.key === 'sleepScore' || c.key === 'pain' ? '–' : c.value == null ? '–' : 'zu wenig') : num(c.baseline, 1)} <small>{fmtZ(c.z)}</small></td>
            <td>{c.points == null ? '–' : Math.round(c.points)}</td>
            <td>{Math.round(c.weight * 100)} %</td>
          </tr>
        {/each}
        {#each rec.penalties as p}
          <tr><td colspan="3">{p.label}</td><td>{p.points || ''}</td><td></td></tr>
        {/each}
      </tbody>
    </table>
    <p class="explain">
      {#if injury}Schmerz (nur bei aktiver Verletzung): 100 − 10 × Schmerzwert, Gewicht 30 %; ab Schmerz 4 höchstens gelb, ab 7 rot.{' '}{/if}HRV: 70 + 15 × Abweichung, Ruhepuls: 70 − 15 × Abweichung (Abweichung in Standardabweichungen zu deinen letzten 14 Tagen).
      Sleep Score zählt direkt. Gewichteter Schnitt der vorhandenen Werte, dazu −{RECOVERY.penalty} bei Form unter {RECOVERY.tsbPenaltyBelow}
      und −{RECOVERY.penalty} bei Belastungsverhältnis über {String(RECOVERY.acwrPenaltyAbove).replace('.', ',')}.
      Grün ab {RECOVERY.green}, gelb ab {RECOVERY.yellow}.
    </p>
  {/if}
</section>

<style>
  .top { display: flex; gap: 16px; align-items: center; }
  .txt { flex: 1; min-width: 0; }
  .kicker { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); font-weight: 600; }
  h2 { margin: 2px 0 4px; font-size: 22px; }
  .gruen h2 { color: var(--green); } .gelb h2 { color: var(--yellow); } .rot h2 { color: var(--red); }
  .txt p { margin: 0; font-size: 15px; line-height: 1.35; }
  .meta { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 12px; }
  .pill { font-size: 12px; background: var(--bg); color: var(--muted); padding: 4px 10px; border-radius: 99px; }
  .how { margin-left: auto; background: none; border: none; color: var(--accent); font: inherit; font-size: 13px; font-weight: 600; padding: 6px 0; cursor: pointer; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 10px; font-variant-numeric: tabular-nums; }
  th { text-align: left; color: var(--muted); font-weight: 500; padding: 4px 3px; }
  td { padding: 7px 3px; border-top: 1px solid var(--line); }
  td small { color: var(--muted); }
  tr.off td { color: var(--muted); }
  .explain { font-size: 12px; color: var(--muted); line-height: 1.45; margin-top: 10px; }
</style>
