<script lang="ts">
  import { swipeDismiss } from '../actions/swipeDismiss';
  import { TESTS } from '../../domain/mobility/tests';
  import { saveTestResult, suggestedLevel } from '../../domain/mobility/tests';
  import { getMobilitySettings, saveMobilitySettings } from '../../domain/mobility/settings';
  import { closeSelfTest } from '../app.svelte';

  let i = $state(0);
  let values = $state<Record<string, number>>({});
  const t = $derived(TESTS[i]);
  const isLast = $derived(i === TESTS.length - 1);

  function key(side?: 'links' | 'rechts') { return t.sides ? `${t.id}_${side}` : t.id; }
  function setStage(v: number, side?: 'links' | 'rechts') { values = { ...values, [key(side)]: v }; }
  function setCm(v: string, side?: 'links' | 'rechts') {
    const n = Number(v.replace(',', '.'));
    values = { ...values, [key(side)]: Number.isFinite(n) ? n : NaN };
  }
  function skip() { if (isLast) finish(); else i++; }
  function next() { if (isLast) finish(); else i++; }

  let done = $state(false);
  async function finish() {
    // Seitenwerte zum schlechteren Wert je Test zusammenfassen (die Routine filtert ohnehin pro Region).
    const results: Record<string, number> = {};
    for (const test of TESTS) {
      if (test.sides) {
        const l = values[`${test.id}_links`], r = values[`${test.id}_rechts`];
        if (l == null && r == null) continue;
        results[test.id] = test.lowerIsBetter ? Math.max(l ?? Infinity, r ?? Infinity) : Math.min(l ?? Infinity, r ?? Infinity);
      } else if (values[test.id] != null && !Number.isNaN(values[test.id])) results[test.id] = values[test.id];
    }
    await saveTestResult(results);
    const s = await getMobilitySettings();
    const lvl = await suggestedLevel(s.level);
    if (lvl !== s.level) await saveMobilitySettings({ level: lvl });
    done = true;
  }
</script>

<div class="backdrop" role="presentation" onclick={closeSelfTest}></div>
<div class="sheet" use:swipeDismiss={closeSelfTest} role="dialog" aria-modal="true" aria-label="Beweglichkeits-Selbsttest">
  <div class="grab"></div>
  {#if done}
    <div class="done">
      <h2>Test gespeichert</h2>
      <p class="muted">Die Ergebnisse fließen ab der nächsten Routine in die Auswahl ein.</p>
      <button class="btn primary wide" onclick={closeSelfTest}>Schließen</button>
    </div>
  {:else}
    <p class="eyebrow">Test {i + 1} / {TESTS.length}</p>
    <h2 class="title">{t.label}</h2>
    <p class="hint">{t.hint}</p>

    {#if t.input === 'stufe'}
      {#if t.sides}
        {#each (['links', 'rechts'] as const) as side}
          <p class="side-label">{side === 'links' ? 'Links' : 'Rechts'}</p>
          <div class="stages">
            {#each t.stages ?? [] as label, n}
              <button class:on={values[key(side)] === n} onclick={() => setStage(n, side)}>{n}<small>{label}</small></button>
            {/each}
          </div>
        {/each}
      {:else}
        <div class="stages">
          {#each t.stages ?? [] as label, n}
            <button class:on={values[key()] === n} onclick={() => setStage(n)}>{n}<small>{label}</small></button>
          {/each}
        </div>
      {/if}
    {:else if t.sides}
      <div class="cm-row">
        <label>Links<input inputmode="decimal" placeholder="cm" oninput={(e) => setCm((e.target as HTMLInputElement).value, 'links')} /></label>
        <label>Rechts<input inputmode="decimal" placeholder="cm" oninput={(e) => setCm((e.target as HTMLInputElement).value, 'rechts')} /></label>
      </div>
    {:else}
      <label>Abstand in cm<input inputmode="decimal" placeholder="cm" oninput={(e) => setCm((e.target as HTMLInputElement).value)} /></label>
    {/if}

    <div class="actions">
      <button class="btn ghost" onclick={skip}>Überspringen</button>
      <button class="btn primary" onclick={next}>{isLast ? 'Abschließen' : 'Weiter'}</button>
    </div>
  {/if}
</div>

<style>
  .backdrop { position: fixed; inset: 0; touch-action: none; background: rgba(0,0,0,.45); z-index: 30; animation: fade .2s; }
  .sheet { position: fixed; left: 0; right: 0; bottom: 0; z-index: 31; max-height: 92vh; max-height: 92dvh; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch;
           background: var(--bg); border-radius: 26px 26px 0 0; padding: 8px 20px calc(env(safe-area-inset-bottom) + 16px);
           max-width: 640px; margin: 0 auto; animation: up .3s cubic-bezier(.2,.9,.3,1); }
  @keyframes up { from { transform: translateY(100%); } }
  @keyframes fade { from { opacity: 0; } }
  .grab { width: 40px; height: 5px; border-radius: 3px; background: var(--line); margin: 4px auto 14px; }
  .eyebrow { margin: 0; color: var(--muted); font-size: 14px; }
  .title { font-size: 24px; margin: 2px 0 8px; letter-spacing: -0.02em; }
  .hint { color: var(--muted); font-size: 14px; margin: 0 0 16px; }
  .side-label { font-weight: 600; font-size: 14px; margin: 10px 0 6px; }
  .stages { display: grid; gap: 8px; margin-bottom: 8px; }
  .stages button { display: flex; align-items: center; gap: 10px; border: 1px solid var(--line); background: var(--card);
                   border-radius: 14px; padding: 10px 14px; text-align: left; color: var(--text); font-weight: 700; cursor: pointer; }
  .stages button small { font-weight: 500; color: var(--muted); font-size: 13px; }
  .stages button.on { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
  .cm-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .actions { display: grid; grid-template-columns: 1fr 2fr; gap: 10px; margin-top: 16px; }
  .done { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 6px; padding: 30px 0; }
  .muted { color: var(--muted); }
  .wide { width: 100%; margin-top: 10px; }
</style>
