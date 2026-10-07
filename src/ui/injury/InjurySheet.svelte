<script lang="ts">
  import { swipeDismiss } from '../actions/swipeDismiss';
  import { db, type Movement, type MoveStatus, type Injury } from '../../core/db';
  import { today } from '../../core/dates';
  import { REGIONS, MOVEMENTS, STATUS_LABEL, movementPreset, allBlocked } from '../../domain/injury/injury';
  import { saveInjury, deleteInjury } from '../../domain/injury/repo';
  import { app, closeInjury } from '../app.svelte';

  const target = app.injurySheet!;
  let existing = $state<Injury | null>(null);
  let region = $state(''), side = $state<Injury['side']>('keine'), severity = $state<Injury['severity']>('mittel');
  let startDate = $state(today()), note = $state('');
  let mode = $state<'stufen' | 'ausfall'>('stufen');
  let movement = $state<Record<Movement, MoveStatus>>(movementPreset(''));
  let touchedMove = false;
  let err = $state(''), confirmDel = $state(false);

  $effect(() => {
    if (!target.id) return;
    db.injuries.get(target.id).then(i => {
      if (!i) return;
      existing = i; region = i.region; side = i.side; severity = i.severity; startDate = i.startDate; note = i.medicalNote ?? '';
      movement = { ...i.movement }; touchedMove = true; mode = i.mode ?? 'stufen';
    });
  });
  function pickRegion(r: string) { region = r; if (!touchedMove) movement = mode === 'ausfall' ? allBlocked() : movementPreset(r); }
  function pickMode(m: 'stufen' | 'ausfall') {
    mode = m;
    if (m === 'ausfall') { severity = 'schwer'; if (!touchedMove || !existing) movement = allBlocked(); }
    else if (!existing) movement = movementPreset(region);
  }
  function setMove(m: Movement, s: MoveStatus) { movement = { ...movement, [m]: s }; touchedMove = true; }

  async function save() {
    if (!region) { err = 'Bitte eine Körperregion wählen.'; return; }
    await saveInjury({ id: existing?.id, region, side, severity, startDate, medicalNote: note.trim() || undefined, movement: $state.snapshot(movement), mode });
    closeInjury();
  }
  async function remove() { if (existing) await deleteInjury(existing.id); closeInjury(); }
</script>

<div class="backdrop" role="presentation" onclick={closeInjury}></div>
<div class="sheet" use:swipeDismiss={closeInjury} role="dialog" aria-modal="true" aria-label="Verletzung">
  <div class="grab"></div>
  <h2 class="title">{existing ? 'Verletzung bearbeiten' : 'Verletzung melden'}</h2>
  <p class="muted small">Der Plan wird sofort pausiert bzw. auf erlaubte Bewegungen reduziert. Die App stellt keine Diagnosen.</p>

  <section>
    <h3>Art</h3>
    <div class="modes">
      <button class:on={mode === 'stufen'} onclick={() => pickMode('stufen')}><b>Mit Rückkehrstufen</b><small>Zerrung, Reizung, Überlastung: schrittweise zurück zum Normalplan</small></button>
      <button class:on={mode === 'ausfall'} onclick={() => pickMode('ausfall')}><b>Ernste Verletzung</b><small>z. B. Bruch, Bänderriss, OP: alles Nicht-Mögliche sperren, Ende per Knopf</small></button>
    </div>
  </section>

  <section>
    <h3>Körperregion</h3>
    <div class="chips">{#each REGIONS as r}<button class:on={region === r} onclick={() => pickRegion(r)}>{r}</button>{/each}</div>
  </section>

  <section>
    <h3>Seite</h3>
    <div class="seg">{#each [['links', 'Links'], ['rechts', 'Rechts'], ['beidseitig', 'Beide'], ['keine', '–']] as [v, l]}<button class:on={side === v} onclick={() => (side = v as Injury['side'])}>{l}</button>{/each}</div>
    <h3>Schweregrad (eigene Einschätzung)</h3>
    <div class="seg">{#each [['leicht', 'Leicht'], ['mittel', 'Mittel'], ['schwer', 'Schwer']] as [v, l]}<button class:on={severity === v} onclick={() => (severity = v as Injury['severity'])}>{l}</button>{/each}</div>
    <label>Seit<input type="date" bind:value={startDate} max={today()} /></label>
  </section>

  <section>
    <h3>{mode === 'ausfall' ? 'Was geht trotzdem?' : 'Was geht gerade?'}</h3>
    {#if mode === 'ausfall'}<p class="muted small">Alles ist gesperrt. Tippe ✓ bei dem, was trotz Verletzung geht (z. B. Oberkörperkraft).</p>{/if}
    {#each MOVEMENTS as m}
      <div class="mrow">
        <span>{m.label}</span>
        <div class="tri">
          {#each (['geht', 'eingeschraenkt', 'nicht'] as MoveStatus[]) as st}
            <button class="{st}" class:on={movement[m.id] === st} onclick={() => setMove(m.id, st)} aria-label="{m.label}: {STATUS_LABEL[st]}">{st === 'geht' ? '✓' : st === 'eingeschraenkt' ? '~' : '✕'}</button>
          {/each}
        </div>
      </div>
    {/each}
    <p class="muted small">✓ geht · ~ eingeschränkt · ✕ geht nicht. Kannst du jederzeit ändern.</p>
  </section>

  <section>
    <label>Ärztliche/physiotherapeutische Einschätzung (optional)<textarea bind:value={note} rows="3" placeholder="z. B. Zerrung, 2 Wochen kein Laufen"></textarea></label>
  </section>

  {#if err}<p class="error">{err}</p>{/if}
  <div class="actions">
    {#if existing && !confirmDel}<button class="btn ghost" onclick={() => (confirmDel = true)}>Löschen</button>
    {:else if confirmDel}<button class="btn ghost del" onclick={remove}>Wirklich?</button>
    {:else}<button class="btn ghost" onclick={closeInjury}>Abbrechen</button>{/if}
    <button class="btn primary" onclick={save}>{existing ? 'Speichern' : 'Verletzungsmodus starten'}</button>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 20; touch-action: none; }
  .sheet { position: fixed; left: 0; right: 0; bottom: 0; z-index: 21; max-height: calc(100% - env(safe-area-inset-top) - 12px); overflow-y: auto; overscroll-behavior: contain;
           background: var(--bg); border-radius: 26px 26px 0 0; padding: 8px 18px calc(env(safe-area-inset-bottom) + 16px); max-width: 640px; margin: 0 auto;
           animation: up .3s cubic-bezier(.2,.9,.3,1); }
  @keyframes up { from { transform: translateY(100%); } }
  .grab { width: 40px; height: 5px; border-radius: 3px; background: var(--line); margin: 4px auto 12px; }
  .title { font-size: 26px; margin: 0 0 4px; }
  .small { font-size: 13px; }
  section { background: var(--card); border-radius: 18px; padding: 14px 16px; margin: 10px 0; }
  h3 { margin: 4px 0 8px; font-size: 15px; }
  h3 + .seg + h3 { margin-top: 14px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chips button, .seg button { border: 1px solid var(--line); background: var(--bg); color: var(--text); border-radius: 10px; padding: 8px 11px; font: inherit; font-size: 14px; cursor: pointer; min-height: 40px; }
  .chips button.on, .seg button.on { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
  .seg { display: grid; grid-template-columns: repeat(auto-fit, minmax(60px, 1fr)); gap: 6px; }
  label { margin-top: 14px; }
  textarea { display: block; width: 100%; margin-top: 6px; padding: 12px; border-radius: 14px; border: 1px solid var(--line); background: var(--bg); color: var(--text); font: inherit; font-size: 16px; resize: vertical; }
  .mrow { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-top: 1px solid var(--line); }
  .mrow:first-of-type { border-top: none; }
  .tri { display: flex; gap: 4px; }
  .tri button { width: 42px; height: 38px; border-radius: 10px; border: 1px solid var(--line); background: var(--bg); color: var(--muted); font-size: 16px; font-weight: 700; cursor: pointer; }
  .tri button.on.geht { background: var(--green); border-color: var(--green); color: #fff; }
  .tri button.on.eingeschraenkt { background: var(--yellow); border-color: var(--yellow); color: #fff; }
  .tri button.on.nicht { background: var(--red); border-color: var(--red); color: #fff; }
  .modes { display: grid; gap: 8px; }
  .modes button { text-align: left; border: 1px solid var(--line); background: var(--bg); color: var(--text); border-radius: 14px; padding: 12px 14px; font: inherit; display: flex; flex-direction: column; gap: 2px; cursor: pointer; }
  .modes button.on { border-color: var(--accent); background: var(--accent-soft); }
  .modes button.on b { color: var(--accent); }
  .modes small { font-size: 12px; color: var(--muted); }
  .actions { display: grid; grid-template-columns: 1fr 2fr; gap: 10px; margin-top: 6px; }
  .del { color: var(--red); }
</style>
