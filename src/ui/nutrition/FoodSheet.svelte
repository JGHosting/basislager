<script lang="ts">
  /**
   * Lebensmittel hinzufügen/bearbeiten:
   *   Suche (lokal sofort, Open Food Facts nach kurzer Pause) → Lebensmittel → Menge + Mahlzeit → Hinzufügen.
   * Alles in einem Sheet, damit der typische Ablauf mit wenigen Tipps auskommt.
   */
  import { onMount } from 'svelte';
  import { db, type Food, type FoodUnit, type Meal } from '../../core/db';
  import { fmtDay } from '../../core/dates';
  import { MEALS, scale, toGrams, unitLabel, fmtG } from '../../domain/nutrition/calc';
  import { loadBls, BLS_ATTRIBUTION } from '../../domain/nutrition/bls';
  import { OFF_ATTRIBUTION, offProduct, OffError } from '../../domain/nutrition/off';
  import { addEntry, updateEntry, deleteEntry, searchLocal, searchOnline, quickPicks, toggleFav, cacheFood, saveCustomFood, findByBarcode, dedupe } from '../../domain/nutrition/repo';
  import { app, closeFood } from '../app.svelte';
  import BarcodeScanner from './BarcodeScanner.svelte';

  const target = app.foodSheet!;
  type Step = 'search' | 'amount' | 'scan' | 'custom';
  let step = $state<Step>(target.mode === 'edit' ? 'amount' : 'search');
  let meal = $state<Meal>(target.mode === 'edit' ? target.entry.meal : target.meal);
  const date = target.mode === 'edit' ? target.entry.date : target.date;

  /* ---------- Suche ---------- */
  let q = $state('');
  let local = $state.raw<Food[]>([]);
  let online = $state.raw<Food[]>([]);
  let onlineState = $state<'idle' | 'loading' | 'done' | 'error'>('idle');
  let onlineMsg = $state('');
  let picks = $state.raw<{ favs: Food[]; recent: Food[] }>({ favs: [], recent: [] });
  let blsReady = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastOnlineQ = '';
  const cacheOnline = new Map<string, Food[]>();

  onMount(() => {
    loadBls().then(() => { blsReady = true; if (q) runLocal(); });
    quickPicks().then(p => (picks = p));
  });

  async function runLocal() { local = await searchLocal(q); }
  function onInput() {
    void runLocal();
    clearTimeout(timer);
    onlineState = 'idle'; online = [];
    // Open Food Facts erst nach einer Tipp-Pause und ab 3 Zeichen (Limit: wenige Suchen pro Minute)
    if (q.trim().length >= 3) timer = setTimeout(runOnline, 900);
  }
  async function runOnline() {
    const query = q.trim();
    if (query.length < 3 || query === lastOnlineQ && onlineState === 'done') return;
    if (cacheOnline.has(query)) { online = cacheOnline.get(query)!; onlineState = 'done'; lastOnlineQ = query; return; }
    onlineState = 'loading'; onlineMsg = '';
    try {
      const res = await searchOnline(query);
      if (q.trim() !== query) return;   // inzwischen weitergetippt
      cacheOnline.set(query, res); online = res; onlineState = 'done'; lastOnlineQ = query;
    } catch (e) { onlineState = 'error'; onlineMsg = (e as Error).message; }
  }
  const results = $derived(dedupe([...local, ...online]));

  /* ---------- Barcode ---------- */
  let scanMsg = $state('');
  let scannedCode = $state('');
  async function onBarcode(code: string) {
    scannedCode = code; scanMsg = '';
    const cached = await findByBarcode(code);
    if (cached) return choose(cached);
    step = 'search'; q = ''; onlineState = 'loading';
    try {
      const f = await offProduct(code);
      onlineState = 'idle';
      if (f) { await cacheFood(f); choose(f); }
      else { scanMsg = `Produkt ${code} ist bei Open Food Facts nicht bekannt. Du kannst es als eigenes Lebensmittel anlegen.`; }
    } catch (e) { onlineState = 'idle'; scanMsg = (e as Error).message + (e instanceof OffError && e.kind === 'offline' ? '' : ''); }
  }

  /* ---------- Menge ---------- */
  let food = $state<Food | null>(null);
  let amount = $state('');
  let unit = $state<FoodUnit>('g');
  let err = $state('');
  let busy = $state(false);

  if (target.mode === 'edit') {
    const e = target.entry;
    amount = String(e.amount).replace('.', ',');
    unit = e.unit;
    db.foods.get(e.foodId).then(f => {
      food = f ?? { id: e.foodId, source: e.snapshot.source, sourceId: '', name: e.snapshot.name, brand: e.snapshot.brand, per: e.snapshot.per,
        kcal: e.snapshot.kcal, protein: e.snapshot.protein, carbs: e.snapshot.carbs, fat: e.snapshot.fat, fiber: e.snapshot.fiber, sugar: e.snapshot.sugar, salt: e.snapshot.salt,
        fav: 0, useCount: 0, lastUpdated: 0, createdAt: 0, updatedAt: 0 };
    });
  }

  function choose(f: Food) {
    clearTimeout(timer);   // keine Online-Suche mehr nach der Auswahl (spart OFF-Kontingent)
    food = f; err = '';
    if (f.servingSize) { unit = 'portion'; amount = '1'; }
    else if (f.pieceGrams) { unit = 'stk'; amount = '1'; }
    else { unit = f.per; amount = f.per === 'ml' ? '250' : '100'; }
    step = 'amount';
  }
  const units = $derived.by((): FoodUnit[] => {
    if (!food) return ['g'];
    const u: FoodUnit[] = food.per === 'ml' ? ['ml', 'l'] : ['g', 'kg'];
    if (food.pieceGrams) u.push('stk');
    if (food.servingSize) u.push('portion');
    return u;
  });
  const num = $derived(Number(amount.trim().replace(',', '.')));
  const grams = $derived(food && amount.trim() && num > 0 ? toGrams(food, num, unit) : null);
  const preview = $derived(food && grams ? scale(food, grams) : null);

  async function confirm() {
    if (!food || !grams) { err = 'Bitte eine Menge eingeben.'; return; }
    busy = true; err = '';
    try {
      const plain = $state.snapshot(food) as Food;
      if (target.mode === 'edit') await updateEntry(target.entry, num, unit, meal);
      else await addEntry(plain, date, meal, num, unit);
      closeFood();
    } catch (e) { err = (e as Error).message; }
    busy = false;
  }
  async function remove() { if (target.mode === 'edit') { await deleteEntry(target.entry.id); closeFood(); } }
  async function fav() { if (food) food = await toggleFav($state.snapshot(food) as Food); }
  async function setPiece() {
    const v = Number(pieceInput.replace(',', '.'));
    if (!food || !(v > 0)) return;
    food = await cacheFood({ ...($state.snapshot(food) as Food), pieceGrams: v });
    unit = 'stk'; pieceEdit = false;
  }
  let pieceEdit = $state(false), pieceInput = $state('');

  /* ---------- Eigenes Lebensmittel ---------- */
  let cf = $state({ name: '', brand: '', kcal: '', protein: '', carbs: '', fat: '', per: 'g' as 'g' | 'ml', serving: '' });
  let cfErr = $state('');
  const pn = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));
  async function saveCustom() {
    const kcal = pn(cf.kcal);
    if (!cf.name.trim()) { cfErr = 'Bitte einen Namen eingeben.'; return; }
    if (kcal == null || !(kcal >= 0)) { cfErr = 'Bitte die Kalorien pro 100 ' + cf.per + ' eingeben.'; return; }
    const vals = [cf.protein, cf.carbs, cf.fat].map(pn);
    if (vals.some(v => v != null && !(v >= 0))) { cfErr = 'Nährwerte bitte als Zahl.'; return; }
    const f = await saveCustomFood({ name: cf.name.trim(), brand: cf.brand.trim() || undefined, barcode: scannedCode || undefined, per: cf.per,
      kcal, protein: vals[0], carbs: vals[1], fat: vals[2], fiber: null, sugar: null, salt: null,
      servingSize: pn(cf.serving), servingLabel: cf.serving ? `${cf.serving} ${cf.per}` : null, pieceGrams: null, imageUrl: null });
    choose(f);
  }
  const srcLabel = (f: Food) => (f.source === 'bls' ? 'BLS' : f.source === 'off' ? 'Open Food Facts' : 'Eigenes');
</script>

<div class="backdrop" role="presentation" onclick={closeFood}></div>
<div class="sheet" class:full={step !== 'amount'} role="dialog" aria-modal="true" aria-label="Lebensmittel">
  <div class="grab"></div>

  {#if step === 'search'}
    <div class="top">
      <h2 class="title">Hinzufügen</h2>
      <span class="muted small">{MEALS.find(m => m.id === meal)?.label} · {fmtDay(date)}</span>
    </div>
    <div class="searchrow">
      <input class="search" type="search" bind:value={q} oninput={onInput} placeholder="Lebensmittel suchen" autocomplete="off" enterkeyhint="search"
             onkeydown={e => { if (e.key === 'Enter') { clearTimeout(timer); runOnline(); (e.target as HTMLInputElement).blur(); } }} />
      <button class="scanbtn" aria-label="Barcode scannen" onclick={() => { scanMsg = ''; step = 'scan'; }}>
        <svg viewBox="0 0 24 24"><path d="M4 7V5a1 1 0 0 1 1-1h2 M17 4h2a1 1 0 0 1 1 1v2 M20 17v2a1 1 0 0 1-1 1h-2 M7 20H5a1 1 0 0 1-1-1v-2 M8 8v8 M11 8v8 M14 8v8 M17 8v8" /></svg>
      </button>
    </div>
    {#if scanMsg}
      <div class="note">{scanMsg}
        {#if scannedCode}<button class="link" onclick={() => { cf.name = ''; step = 'custom'; }}>Eigenes Lebensmittel anlegen</button>{/if}
      </div>
    {/if}

    {#if !q.trim()}
      {#if picks.favs.length}
        <h3>Favoriten</h3>
        <ul class="list">{#each picks.favs as f (f.id)}<li><button onclick={() => choose(f)}><span><b>{f.name}</b><small>{f.brand ?? srcLabel(f)}</small></span><em>{fmtG(f.kcal)} kcal</em></button></li>{/each}</ul>
      {/if}
      {#if picks.recent.length}
        <h3>Zuletzt verwendet</h3>
        <ul class="list">{#each picks.recent as f (f.id)}<li><button onclick={() => choose(f)}><span><b>{f.name}</b><small>{f.brand ?? srcLabel(f)}</small></span><em>{fmtG(f.kcal)} kcal</em></button></li>{/each}</ul>
      {/if}
      {#if !picks.favs.length && !picks.recent.length}
        <p class="muted small pad">Tippe einen Namen (z. B. „Banane“, „Haferflocken“, „Nutella“) oder scanne einen Barcode.</p>
      {/if}
      <button class="link pad" onclick={() => { scannedCode = ''; step = 'custom'; }}>+ Eigenes Lebensmittel anlegen</button>
    {:else}
      {#if !blsReady}<p class="muted small pad">Lebensmitteldatenbank wird geladen …</p>{/if}
      <ul class="list">
        {#each results as f (f.id)}
          <li><button onclick={() => choose(f)}>
            <span><b>{f.name}</b><small>{f.brand ? f.brand + ' · ' : ''}<i class="src {f.source}">{srcLabel(f)}</i>{f.fav ? ' · ★' : ''}</small></span>
            <em>{fmtG(f.kcal)} kcal<small>/100 {f.per}</small></em>
          </button></li>
        {/each}
      </ul>
      <p class="online muted small">
        {#if onlineState === 'loading'}Suche bei Open Food Facts …
        {:else if onlineState === 'error'}{onlineMsg}
        {:else if onlineState === 'done' && !online.length}Keine Markenprodukte bei Open Food Facts gefunden.
        {:else if onlineState === 'idle' && q.trim().length >= 3}<button class="link" onclick={runOnline}>Bei Open Food Facts suchen</button>{/if}
      </p>
      {#if !results.length && onlineState !== 'loading'}
        <button class="link pad" onclick={() => { cf.name = q; scannedCode = ''; step = 'custom'; }}>„{q}“ als eigenes Lebensmittel anlegen</button>
      {/if}
    {/if}
    <p class="attr">Daten: BLS 4.0 (Max Rubner-Institut, CC BY 4.0) · Open Food Facts (ODbL)</p>

  {:else if step === 'scan'}
    <h2 class="title">Barcode scannen</h2>
    <BarcodeScanner ondetect={onBarcode} onclose={() => (step = 'search')} />

  {:else if step === 'custom'}
    <h2 class="title">Eigenes Lebensmittel</h2>
    <section>
      <label>Name<input bind:value={cf.name} placeholder="z. B. Omas Gemüsesuppe" /></label>
      <label>Marke (optional)<input bind:value={cf.brand} /></label>
      {#if scannedCode}<p class="muted small">Barcode {scannedCode} wird gespeichert.</p>{/if}
      <div class="seg2">
        <button class:on={cf.per === 'g'} onclick={() => (cf.per = 'g')}>pro 100 g</button>
        <button class:on={cf.per === 'ml'} onclick={() => (cf.per = 'ml')}>pro 100 ml</button>
      </div>
      <div class="grid2">
        <label>Kalorien (kcal)<input bind:value={cf.kcal} inputmode="decimal" /></label>
        <label>Protein (g)<input bind:value={cf.protein} inputmode="decimal" placeholder="unbekannt" /></label>
        <label>Kohlenhydrate (g)<input bind:value={cf.carbs} inputmode="decimal" placeholder="unbekannt" /></label>
        <label>Fett (g)<input bind:value={cf.fat} inputmode="decimal" placeholder="unbekannt" /></label>
      </div>
      <label>Portionsgröße in {cf.per} (optional)<input bind:value={cf.serving} inputmode="decimal" /></label>
      {#if cfErr}<p class="error small">{cfErr}</p>{/if}
    </section>
    <div class="actions"><button class="btn ghost" onclick={() => (step = 'search')}>Zurück</button><button class="btn primary" onclick={saveCustom}>Weiter</button></div>

  {:else if step === 'amount'}
    {#if food}
      <div class="foodhead">
        {#if food.imageUrl}<img src={food.imageUrl} alt="" />{/if}
        <div>
          <h2 class="title2">{food.name}</h2>
          <p class="muted small">{food.brand ? food.brand + ' · ' : ''}<i class="src {food.source}">{srcLabel(food)}</i> · {fmtG(food.kcal)} kcal pro 100 {food.per}</p>
        </div>
        <button class="star" class:on={!!food.fav} onclick={fav} aria-label="Favorit">★</button>
      </div>

      <section>
        <div class="amount">
          <input bind:value={amount} inputmode="decimal" aria-label="Menge" onfocus={e => (e.target as HTMLInputElement).select()} />
          <div class="units">
            {#each units as u}
              <button class:on={unit === u} onclick={() => { if (unit !== u) { amount = u === 'stk' || u === 'portion' ? '1' : u === 'kg' || u === 'l' ? '0,1' : (food!.per === 'ml' ? '250' : '100'); unit = u; } }}>{unitLabel(u)}</button>
            {/each}
          </div>
        </div>
        <p class="muted small">
          {#if unit === 'stk'}1 Stück ≈ {fmtG(food.pieceGrams)} {food.per} · <button class="link inl" onclick={() => { pieceInput = String(food!.pieceGrams ?? ''); pieceEdit = true; }}>anpassen</button>
          {:else if unit === 'portion'}1 Portion = {fmtG(food.servingSize)} {food.per}{food.servingLabel && !food.servingLabel.replace(/\s/g, '').startsWith(String(food.servingSize)) ? ` (${food.servingLabel})` : ''}
          {:else if !food.pieceGrams}<button class="link inl" onclick={() => { pieceInput = ''; pieceEdit = true; }}>Stückgewicht festlegen</button>{/if}
          {#if grams && unit !== 'g' && unit !== 'ml' && !(Number(amount.replace(',', '.')) === 1 && (unit === 'stk' || unit === 'portion'))} · = {fmtG(grams)} {food.per}{/if}
        </p>
        {#if pieceEdit}
          <div class="pieceedit"><input bind:value={pieceInput} inputmode="decimal" placeholder="Gramm pro Stück" /><button class="btn" onclick={setPiece}>OK</button></div>
        {/if}
      </section>

      <section class="result">
        <div class="kcal"><b>{preview ? fmtG(preview.kcal) : '–'}</b><span>kcal</span></div>
        <div class="mac">
          <span><small>Protein</small><b>{preview ? fmtG(preview.protein) : '–'} g</b></span>
          <span><small>KH</small><b>{preview ? fmtG(preview.carbs) : '–'} g</b></span>
          <span><small>Fett</small><b>{preview ? fmtG(preview.fat) : '–'} g</b></span>
        </div>
        {#if food.kcal == null}<p class="warn small">Für dieses Produkt sind keine Kalorien hinterlegt.</p>{/if}
      </section>

      <div class="meals">
        {#each MEALS as m}<button class:on={meal === m.id} onclick={() => (meal = m.id)}>{m.label}</button>{/each}
      </div>
      {#if err}<p class="error small">{err}</p>{/if}
      <div class="actions">
        {#if target.mode === 'edit'}<button class="btn ghost del" onclick={remove}>Löschen</button>
        {:else}<button class="btn ghost" onclick={() => (step = 'search')}>Zurück</button>{/if}
        <button class="btn primary" onclick={confirm} disabled={busy || !grams}>{target.mode === 'edit' ? 'Speichern' : 'Hinzufügen'}</button>
      </div>
    {/if}
  {/if}
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 20; touch-action: none; animation: fade .2s; }
  .sheet { position: fixed; left: 0; right: 0; bottom: 0; max-height: calc(100% - env(safe-area-inset-top) - 12px); z-index: 21; overflow-y: auto; overscroll-behavior: contain;
           background: var(--bg); border-radius: 26px 26px 0 0; padding: 8px 18px calc(env(safe-area-inset-bottom) + 16px);
           max-width: 640px; margin: 0 auto; animation: up .3s cubic-bezier(.2,.9,.3,1); }
  .sheet.full { top: calc(env(safe-area-inset-top) + 12px); }
  @keyframes up { from { transform: translateY(100%); } }
  @keyframes fade { from { opacity: 0; } }
  .grab { width: 40px; height: 5px; border-radius: 3px; background: var(--line); margin: 4px auto 12px; }
  .top { display: flex; justify-content: space-between; align-items: baseline; }
  .title { font-size: 26px; margin: 0 0 10px; letter-spacing: -0.02em; }
  .title2 { font-size: 20px; margin: 0; }
  .small { font-size: 13px; }
  .pad { padding: 8px 4px; }
  h3 { font-size: 13px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); margin: 16px 4px 6px; }
  .searchrow { display: flex; gap: 8px; position: sticky; top: -8px; background: var(--bg); padding: 4px 0 8px; z-index: 1; }
  .search { margin: 0; font-size: 17px; }
  .scanbtn { width: 52px; flex-shrink: 0; border-radius: 14px; border: 1px solid var(--line); background: var(--card); color: var(--accent); display: grid; place-items: center; cursor: pointer; }
  .scanbtn svg { width: 26px; height: 26px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; }
  .list { list-style: none; margin: 0; padding: 0; background: var(--card); border-radius: 16px; overflow: hidden; }
  .list li + li { border-top: 1px solid var(--line); }
  .list button { width: 100%; display: flex; justify-content: space-between; align-items: center; gap: 10px; text-align: left; background: none; border: none;
                 padding: 12px 14px; font: inherit; color: var(--text); cursor: pointer; min-height: 52px; }
  .list span { display: flex; flex-direction: column; min-width: 0; }
  .list b { font-weight: 550; font-size: 15px; }
  .list small { font-size: 12px; color: var(--muted); }
  .list em { font-style: normal; font-size: 14px; white-space: nowrap; text-align: right; display: flex; flex-direction: column; font-variant-numeric: tabular-nums; }
  .src { font-style: normal; font-weight: 600; }
  .src.bls { color: var(--c-swim); } .src.off { color: var(--c-ride); } .src.custom { color: var(--c-strength); }
  .online { padding: 10px 4px; text-align: center; }
  .link { background: none; border: none; color: var(--accent); font: inherit; font-weight: 600; cursor: pointer; padding: 6px 0; }
  .link.inl { padding: 0; font-size: 13px; }
  .note { background: var(--accent-soft); border-radius: 12px; padding: 10px 12px; font-size: 14px; margin-bottom: 8px; display: flex; flex-direction: column; align-items: flex-start; }
  .attr { font-size: 11px; color: var(--muted); text-align: center; margin: 16px 0 4px; }
  section { background: var(--card); border-radius: 18px; padding: 14px 16px; margin-bottom: 10px; }
  .foodhead { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 12px; }
  .foodhead img { width: 56px; height: 56px; object-fit: contain; border-radius: 10px; background: #fff; }
  .foodhead div { flex: 1; min-width: 0; }
  .star { font-size: 26px; background: none; border: none; color: var(--line); cursor: pointer; padding: 0 4px; }
  .star.on { color: var(--yellow); }
  .amount { display: flex; gap: 10px; align-items: stretch; }
  .amount input { margin: 0; width: 38%; font-size: 30px; font-weight: 700; text-align: center; padding: 8px; font-variant-numeric: tabular-nums; }
  .units { flex: 1; display: flex; flex-wrap: wrap; gap: 6px; align-content: center; }
  .units button, .meals button, .seg2 button { border: 1px solid var(--line); background: var(--bg); color: var(--text); border-radius: 10px; padding: 8px 12px; font: inherit; font-size: 14px; cursor: pointer; min-height: 40px; }
  .units button.on, .meals button.on, .seg2 button.on { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
  .pieceedit { display: flex; gap: 8px; margin-top: 8px; } .pieceedit input { margin: 0; }
  .result { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
  .kcal { display: flex; align-items: baseline; gap: 4px; } .kcal b { font-size: 34px; font-weight: 750; font-variant-numeric: tabular-nums; } .kcal span { color: var(--muted); }
  .mac { display: flex; gap: 14px; flex: 1; justify-content: flex-end; }
  .mac span { display: flex; flex-direction: column; font-variant-numeric: tabular-nums; } .mac small { font-size: 12px; color: var(--muted); }
  .warn { color: var(--yellow); width: 100%; margin: 0; }
  .meals { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 10px; }
  .meals button { padding: 8px 2px; font-size: 13px; }
  .actions { display: grid; grid-template-columns: 1fr 2fr; gap: 10px; margin-top: 6px; }
  .del { color: var(--red); }
  .seg2 { display: flex; gap: 6px; margin: 12px 0 2px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 10px; }
  .grid2 label, section label { margin-top: 10px; font-size: 13px; }
</style>
