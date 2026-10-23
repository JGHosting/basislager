<script lang="ts">
  import { sessionsOn } from '../../domain/planner/repo';
  import { loadFuelEnv, planFor, needsFuelPlan, setOverride, FUEL_ITEMS, type FuelItem } from '../../domain/nutrition/fueling';
  import { addItems } from '../../domain/nutrition/repo';
  import type { PlanSession } from '../../domain/planner/plan';
  let { date }: { date: string } = $props();
  interface Ask { s: PlanSession; counts: Record<string, number> }
  let asks = $state<Ask[]>([]);
  let editing = $state<string | null>(null);
  $effect(() => {
    const d = date;
    (async () => {
      const [{ sessions }, env] = await Promise.all([sessionsOn(d), loadFuelEnv(false)]);
      const list: Ask[] = [];
      for (const s of sessions) {
        if (s.status !== 'erledigt' || !needsFuelPlan(s) || env.overrides[s.key]?.logged) continue;
        const p = planFor(s, env);
        const counts: Record<string, number> = {};
        for (const i of p.intakes) counts[i.item.id] = (counts[i.item.id] ?? 0) + 1;
        if (p.isoBottles) counts.iso = p.isoBottles;
        if (Object.keys(counts).length) list.push({ s, counts });
      }
      if (d === date) asks = list;
    })();
  });
  const item = (id: string) => FUEL_ITEMS.find(i => i.id === id)!;
  const kcalOf = (c: Record<string, number>) => Math.round(Object.entries(c).reduce((a, [id, n]) => a + (item(id).n.kcal ?? 0) * item(id).grams / 100 * n, 0));
  const snap = (f: FuelItem) => ({ name: f.name, source: 'custom' as const, per: f.per, ...f.n });
  async function answer(a: Ask, yes: boolean) {
    if (yes) {
      const items = Object.entries(a.counts).filter(([, n]) => n > 0).map(([id, n]) => { const f = item(id); return { foodId: 'fuel:' + id, snapshot: snap(f), amount: n, unit: 'stk' as const, grams: f.grams * n }; });
      if (items.length) await addItems(items, date, 'snack');
    }
    await setOverride(a.s.key, { logged: yes ? 'ja' : 'nein' });
    asks = asks.filter(x => x.s.key !== a.s.key); editing = null;
  }
  function step(a: Ask, id: string, d: number) { a.counts[id] = Math.max(0, Math.round(((a.counts[id] ?? 0) + d * (id === 'iso' ? 0.5 : 1)) * 2) / 2); asks = [...asks]; }
</script>

{#each asks as a (a.s.key)}
  <section class="card fl">
    <h2>Unterwegs gegessen wie geplant?</h2>
    <p class="muted">{a.s.title}: {Object.entries(a.counts).filter(([, n]) => n > 0).map(([id, n]) => `${n.toLocaleString('de-DE')}× ${item(id).short}`).join(', ')} · ca. {kcalOf(a.counts)} kcal</p>
    {#if editing === a.s.key}
      <div class="ed">
        {#each FUEL_ITEMS as f}
          {#if (a.counts[f.id] ?? 0) > 0 || f.id === 'gel' || f.id === 'iso' || f.id === 'banane' || f.id === 'riegel'}
            <div class="r"><span>{f.name}</span><button onclick={() => step(a, f.id, -1)} aria-label="weniger">−</button><b>{(a.counts[f.id] ?? 0).toLocaleString('de-DE')}</b><button onclick={() => step(a, f.id, 1)} aria-label="mehr">+</button></div>
          {/if}
        {/each}
      </div>
      <div class="acts"><button class="btn primary" onclick={() => answer(a, true)}>Eintragen</button><button class="btn" onclick={() => (editing = null)}>Zurück</button></div>
    {:else}
      <div class="acts">
        <button class="btn primary" onclick={() => answer(a, true)}>Ja</button>
        <button class="btn" onclick={() => (editing = a.s.key)}>Anpassen</button>
        <button class="btn" onclick={() => answer(a, false)}>Nein</button>
      </div>
    {/if}
  </section>
{/each}

<style>
  .fl h2 { font-size: 16px; margin: 0 0 4px; }
  .fl p { margin: 0 0 10px; font-size: 14px; }
  .acts { display: flex; gap: 8px; flex-wrap: wrap; }
  .ed { margin-bottom: 10px; }
  .r { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-top: 1px solid var(--line); }
  .r:first-child { border-top: none; }
  .r span { flex: 1; font-size: 14px; }
  .r b { min-width: 28px; text-align: center; }
  .r button { width: 34px; height: 34px; border-radius: 10px; border: 1px solid var(--line); background: var(--card); color: var(--text); font: inherit; font-size: 18px; cursor: pointer; }
</style>
