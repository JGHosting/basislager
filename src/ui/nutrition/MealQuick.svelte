<script lang="ts">
  /** Schnell eintragen für eine Mahlzeit: "wie zuletzt", Vorlagen einfügen, als Vorlage speichern, Rückgängig. */
  import { liveQuery } from 'dexie';
  import type { FoodLogEntry, Meal, MealTemplate } from '../../core/db';
  import { addDays, fmtDay } from '../../core/dates';
  import { lastMeal, addItems, removeEntries, listTemplates, saveTemplate, useTemplate, deleteTemplate } from '../../domain/nutrition/repo';
  import { sumEntries, MEALS } from '../../domain/nutrition/calc';

  let { date, meal, entries }: { date: string; meal: Meal; entries: FoodLogEntry[] } = $props();

  let last = $state.raw<Awaited<ReturnType<typeof lastMeal>>>(null);
  $effect(() => {
    const d = date, m = meal;
    const sub = liveQuery(() => lastMeal(d, m)).subscribe(v => (last = v));
    return () => sub.unsubscribe();
  });
  const templates = liveQuery(() => listTemplates());

  let mode = $state<'' | 'pick' | 'save'>('');
  let name = $state('');
  let undo = $state<{ ids: string[]; text: string } | null>(null);
  let undoTimer: ReturnType<typeof setTimeout> | undefined;

  const kcal = (items: { snapshot: FoodLogEntry['snapshot']; grams: number }[]) => Math.round(sumEntries(items as FoodLogEntry[]).kcal.value).toLocaleString('de-DE');
  const dayLabel = (d: string) => (d === addDays(date, -1) ? 'gestern' : fmtDay(d, { weekday: 'short' }));
  const mealLabel = MEALS.find(m => m.id === meal)?.label ?? '';

  function showUndo(ids: string[], text: string) {
    clearTimeout(undoTimer);
    undo = { ids, text };
    undoTimer = setTimeout(() => (undo = null), 8000);
  }
  async function copyLast() {
    if (!last) return;
    const ids = await addItems(last.entries, date, meal);
    showUndo(ids, `${ids.length} ${ids.length === 1 ? 'Eintrag' : 'Einträge'} von ${dayLabel(last.date)} übernommen.`);
  }
  async function pick(t: MealTemplate) {
    const ids = await useTemplate(t, date, meal);
    mode = '';
    showUndo(ids, `„${t.name}“ eingetragen.`);
  }
  async function save() {
    if (!name.trim() || !entries.length) return;
    await saveTemplate(name, entries, meal);
    mode = ''; name = '';
    showUndo([], 'Als Vorlage gespeichert.');
  }
  async function doUndo() {
    if (undo?.ids.length) await removeEntries(undo.ids);
    undo = null;
  }
  const sorted = $derived(($templates ?? []).slice().sort((a, b) => Number(b.meal === meal) - Number(a.meal === meal)));
</script>

{#if undo}
  <div class="undo"><span>{undo.text}</span>{#if undo.ids.length}<button onclick={doUndo}>Rückgängig</button>{/if}</div>
{/if}

<div class="chips">
  {#if last && !entries.length}
    <button class="chip" onclick={copyLast}>↻ Wie {dayLabel(last.date)} <small>{kcal(last.entries)} kcal</small></button>
  {/if}
  {#if $templates?.length}
    <button class="chip" class:on={mode === 'pick'} onclick={() => (mode = mode === 'pick' ? '' : 'pick')}>☰ Vorlage</button>
  {/if}
  {#if entries.length}
    <button class="chip" class:on={mode === 'save'} onclick={() => { mode = mode === 'save' ? '' : 'save'; name = name || mealLabel; }}>＋ Als Vorlage</button>
  {/if}
</div>

{#if mode === 'pick'}
  <ul class="tpl">
    {#each sorted as t (t.id)}
      <li>
        <button class="use" onclick={() => pick(t)}>
          <span><b>{t.name}</b><small>{t.items.map(i => i.snapshot.name).join(', ')}</small></span>
          <em>{kcal(t.items)} kcal</em>
        </button>
        <button class="del" aria-label="Vorlage löschen" onclick={() => deleteTemplate(t.id)}>×</button>
      </li>
    {/each}
  </ul>
{:else if mode === 'save'}
  <form class="save" onsubmit={e => { e.preventDefault(); save(); }}>
    <input bind:value={name} placeholder="Name, z. B. Standard-Frühstück" maxlength="40" />
    <button class="btn primary" disabled={!name.trim()}>Speichern</button>
  </form>
{/if}

<style>
  .chips { display: flex; gap: 8px; flex-wrap: wrap; padding: 2px 0 10px; }
  .chip { border: 1px solid var(--line); background: var(--bg); color: var(--text); font: inherit; font-size: 13px; font-weight: 600;
          border-radius: 99px; padding: 7px 12px; cursor: pointer; min-height: 34px; }
  .chip small { color: var(--muted); font-weight: 500; margin-left: 2px; }
  .chip.on { border-color: var(--accent); color: var(--accent); }
  .tpl { list-style: none; margin: 0 0 10px; padding: 0; border-top: 1px solid var(--line); }
  .tpl li { display: flex; align-items: center; border-bottom: 1px solid var(--line); }
  .use { flex: 1; display: flex; justify-content: space-between; align-items: center; gap: 10px; background: none; border: none; font: inherit; color: var(--text);
         text-align: left; padding: 10px 0; cursor: pointer; min-width: 0; }
  .use span { display: flex; flex-direction: column; min-width: 0; }
  .use b { font-weight: 600; font-size: 15px; }
  .use small { font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .use em { font-style: normal; color: var(--muted); font-size: 14px; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .del { background: none; border: none; color: var(--muted); font-size: 22px; width: 40px; height: 40px; cursor: pointer; }
  .save { display: flex; gap: 8px; margin: 0 0 10px; }
  .save input { flex: 1; margin: 0; }
  .undo { display: flex; justify-content: space-between; align-items: center; gap: 10px; background: var(--bg); border-radius: 12px;
          padding: 8px 12px; margin: 0 0 10px; font-size: 13px; }
  .undo button { background: none; border: none; color: var(--accent); font: inherit; font-weight: 650; cursor: pointer; padding: 4px 0; }
</style>
