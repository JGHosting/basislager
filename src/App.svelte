<script lang="ts">
  import { onMount } from 'svelte';
  import { initApp, app } from './ui/app.svelte';
  import MorningSheet from './ui/components/MorningSheet.svelte';
  import StrengthSheet from './ui/components/StrengthSheet.svelte';
  import FoodSheet from './ui/nutrition/FoodSheet.svelte';
  import Ernaehrung from './ui/views/Ernaehrung.svelte';
  import InjurySheet from './ui/injury/InjurySheet.svelte';
  import TabBar from './ui/components/TabBar.svelte';
  import Heute from './ui/views/Heute.svelte';
  import Mehr from './ui/views/Mehr.svelte';
  import Soon from './ui/views/Soon.svelte';
  import Statistik from './ui/views/Statistik.svelte';

  // Einfaches Hash-Routing (#/heute, #/mehr …) – funktioniert auf GitHub Pages ohne Server
  const parse = () => (location.hash.replace(/^#\/?/, '').split('/')[0] || 'heute');
  let route = $state(parse());
  let scroller: HTMLElement;
  onMount(() => {
    const on = () => { route = parse(); scroller?.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    initApp();
    return () => window.removeEventListener('hashchange', on);
  });
</script>

<main bind:this={scroller} inert={app.showMorning || !!app.strengthEdit || !!app.foodSheet || !!app.injurySheet}>
  {#key route}
    <div class="view">
      {#if route === 'heute'}<Heute />
      {:else if route === 'plan'}<Soon title="Plan" text="Der Trainingsplaner kommt nach Kraft-Split und Verletzungsmodus." />
      {:else if route === 'ernaehrung'}<Ernaehrung />
      {:else if route === 'statistik'}<Statistik />
      {:else if route === 'mehr'}<Mehr />
      {:else}<Heute />{/if}
    </div>
  {/key}
</main>
<TabBar current={route} />
{#if app.showMorning}<MorningSheet />{:else if app.strengthEdit}<StrengthSheet />{:else if app.foodSheet}<FoodSheet />{:else if app.injurySheet}<InjurySheet />{/if}

<style>
  /* Einziger Scrollbereich der App */
  main { flex: 1; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior-y: contain;
         padding: env(safe-area-inset-top) 16px 24px; }
  main > .view { max-width: 640px; margin: 0 auto; }
  .view { animation: fade .2s ease-out; }
  @keyframes fade { from { opacity: 0; transform: translateY(4px); } }
</style>
