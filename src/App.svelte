<script lang="ts">
  import { onMount } from 'svelte';
  import { initApp, app } from './ui/app.svelte';
  import MorningSheet from './ui/components/MorningSheet.svelte';
  import StrengthSheet from './ui/components/StrengthSheet.svelte';
  import FoodSheet from './ui/nutrition/FoodSheet.svelte';
  import Ernaehrung from './ui/views/Ernaehrung.svelte';
  import InjurySheet from './ui/injury/InjurySheet.svelte';
  import PhysioSheet from './ui/injury/PhysioSheet.svelte';
  import GoalSheet from './ui/planner/GoalSheet.svelte';
  import ActivitySheet from './ui/activity/ActivitySheet.svelte';
  import Plan from './ui/views/Plan.svelte';
  import TabBar from './ui/components/TabBar.svelte';
  import Heute from './ui/views/Heute.svelte';
  import Mehr from './ui/views/Mehr.svelte';
  import Soon from './ui/views/Soon.svelte';
  import Statistik from './ui/views/Statistik.svelte';
  import Mobility from './ui/views/Mobility.svelte';
  import MobilityPlayer from './ui/mobility/MobilityPlayer.svelte';
  import MobilityNag from './ui/mobility/MobilityNag.svelte';
  import MobilityLock from './ui/mobility/MobilityLock.svelte';
  import SelfTestSheet from './ui/mobility/SelfTestSheet.svelte';

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

<main bind:this={scroller} inert={app.showMorning || !!app.strengthEdit || !!app.foodSheet || !!app.injurySheet || !!app.physioSheet || !!app.goalSheet || !!app.activitySheet || !!app.mobilityPlayer || app.mobilitySelfTest || app.mobilityLocked}>
  {#key route}
    <div class="view">
      {#if route === 'heute'}<Heute />
      {:else if route === 'plan'}<Plan />
      {:else if route === 'ernaehrung'}<Ernaehrung />
      {:else if route === 'mobility'}<Mobility />
      {:else if route === 'statistik'}<Statistik />
      {:else if route === 'mehr'}<Mehr />
      {:else}<Heute />{/if}
    </div>
  {/key}
</main>
<TabBar current={route} mobilityDue={app.mobilityDue} />
{#if app.showMorning}<MorningSheet />{:else if app.strengthEdit}<StrengthSheet />{:else if app.foodSheet}<FoodSheet />{:else if app.injurySheet}<InjurySheet />{:else if app.physioSheet}<PhysioSheet />{:else if app.goalSheet}<GoalSheet />{:else if app.activitySheet}<ActivitySheet />{/if}
{#if app.mobilityPlayer}<MobilityPlayer routine={app.mobilityPlayer} />{/if}
{#if app.mobilitySelfTest}<SelfTestSheet />{/if}
{#if app.mobilityLocked}<MobilityLock />{:else if app.mobilityNag}<MobilityNag />{/if}

<style>
  /* Einziger Scrollbereich der App */
  main { flex: 1; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior-y: contain;
         padding: env(safe-area-inset-top) 16px 24px; }
  main > .view { max-width: 640px; margin: 0 auto; }
  .view { animation: fade .2s ease-out; }
  @keyframes fade { from { opacity: 0; transform: translateY(4px); } }
</style>
