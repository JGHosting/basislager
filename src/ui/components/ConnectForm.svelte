<script lang="ts">
  import { connect } from '../app.svelte';
  let athlete = $state(''), key = $state(''), busy = $state(false), error = $state('');
  async function submit(e: Event) {
    e.preventDefault();
    busy = true; error = (await connect(athlete, key)) ?? ''; busy = false;
    if (!error) key = '';
  }
</script>

<form class="card" onsubmit={submit}>
  <h2>Mit intervals.icu verbinden</h2>
  <p class="muted">Beides findest du in intervals.icu unter Settings → Developer Settings. Der Schlüssel bleibt nur auf diesem Gerät.</p>
  <label>Athlete-ID
    <input bind:value={athlete} placeholder="i123456" autocapitalize="off" autocomplete="off" required />
  </label>
  <label>API-Schlüssel
    <input bind:value={key} type="password" placeholder="Schlüssel einfügen" autocapitalize="off" autocomplete="off" required />
  </label>
  {#if error}<p class="error">{error}</p>{/if}
  <button class="btn primary wide" disabled={busy}>{busy ? 'Verbinde …' : 'Verbinden'}</button>
</form>
