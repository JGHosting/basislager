<script lang="ts">
  let { title, text }: { title: string; text: string } = $props();
</script>

<header class="page-head"><div><h1>{title}</h1></div></header>
<section class="card soon">
  <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M6 40 L20 16 L27 28 L31 22 L42 40 Z" /><path d="M20 16 V8 l7 3 -7 3" /></svg>
  <p>{text}</p>
</section>

<style>
  .soon { text-align: center; padding: 36px 24px; }
  .soon svg { width: 64px; height: 64px; fill: none; stroke: var(--accent); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
  .soon p { color: var(--muted); max-width: 30ch; margin: 12px auto 0; }
</style>
