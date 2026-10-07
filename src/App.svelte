<script lang="ts">
  import { onMount } from 'svelte';
  import { initApp } from './ui/app.svelte';
  import TabBar from './ui/components/TabBar.svelte';
  import Heute from './ui/views/Heute.svelte';
  import Mehr from './ui/views/Mehr.svelte';
  import Soon from './ui/views/Soon.svelte';

  // Einfaches Hash-Routing (#/heute, #/mehr …) – funktioniert auf GitHub Pages ohne Server
  const parse = () => (location.hash.replace(/^#\/?/, '').split('/')[0] || 'heute');
  let route = $state(parse());
  onMount(() => {
    const on = () => { route = parse(); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    initApp();
    return () => window.removeEventListener('hashchange', on);
  });
</script>

<main>
  {#key route}
    <div class="view">
      {#if route === 'heute'}<Heute />
      {:else if route === 'plan'}<Soon title="Plan" text="Der Trainingsplaner kommt nach Kraft-Split und Verletzungsmodus." />
      {:else if route === 'ernaehrung'}<Soon title="Ernährung" text="Kalorien- und Makro-Tracker mit BLS und Open Food Facts kommen in einem der nächsten Schritte." />
      {:else if route === 'statistik'}<Soon title="Statistik" text="Verlaufsgrafiken für alle Kennzahlen kommen mit dem Dashboard-Schritt." />
      {:else if route === 'mehr'}<Mehr />
      {:else}<Heute />{/if}
    </div>
  {/key}
</main>
<TabBar current={route} />

<style>
  main { padding-bottom: calc(env(safe-area-inset-bottom) + 84px); max-width: 640px; margin: 0 auto; }
  .view { animation: fade .2s ease-out; }
  @keyframes fade { from { opacity: 0; transform: translateY(4px); } }
</style>
