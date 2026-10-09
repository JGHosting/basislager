<script lang="ts">
  /** Kleines Sport-Icon in einer farbigen Kachel – zum schnellen Unterscheiden der Sportarten. */
  import { sportColor } from '../format';
  let { type, size = 38, done = false, flat = false }: { type: string; size?: number; done?: boolean; flat?: boolean } = $props();

  type Kind = 'run' | 'walk' | 'hike' | 'ride' | 'swim' | 'strength' | 'ski' | 'snowboard' | 'climb' | 'row' | 'yoga' | 'race' | 'other';
  // Planer-Sportarten (deutsch) auf Garmin-Typen abbilden
  const PLAN: Record<string, string> = { kraft: 'WeightTraining', lauf: 'Run', trail: 'TrailRun', rad: 'Ride', schwimmen: 'Swim', gehen: 'Walk', wettkampf: 'race' };
  const t = $derived(PLAN[type] ?? type);
  const kind = $derived<Kind>(
    t === 'race' ? 'race'
    : /TrailRun|VirtualRun|Run/.test(t) ? 'run'
    : t === 'Walk' ? 'walk'
    : /Hike|Snowshoe/.test(t) ? 'hike'
    : /Ride|Velomobile|Handcycle/.test(t) ? 'ride'
    : /Swim|Paddl|Kayak|Canoe|Surf|Sail|Row/.test(t) ? (/Row/.test(t) ? 'row' : 'swim')
    : /Weight|Workout|Crossfit|HighIntensity|Elliptical|StairStepper/.test(t) ? 'strength'
    : /Snowboard/.test(t) ? 'snowboard'
    : /Ski|NordicSki/.test(t) ? 'ski'
    : /Climb/.test(t) ? 'climb'
    : /Yoga|Pilates/.test(t) ? 'yoga'
    : 'other'
  );
  const color = $derived(kind === 'race' ? 'var(--red)' : sportColor(type));
</script>

<span class="tile" class:flat style="--c: {color}; width: {size}px; height: {size}px; border-radius: {Math.round(size * 0.3)}px">
  <svg viewBox="0 0 24 24" aria-hidden="true" style="width: {Math.round(size * 0.58)}px; height: {Math.round(size * 0.58)}px">
    {#if kind === 'run'}
      <circle cx="15.5" cy="4.5" r="1.9" /><path d="M13 9l-3 2 1 4-3 4 M13 9l3-1 2 3 3 1 M13 9l-2.5-.5-3 2.5" />
    {:else if kind === 'walk'}
      <circle cx="13" cy="4.3" r="1.8" /><path d="M12 8l-1.5 5 2 2.5 1 5 M10.5 13l-2.5 2 M13 10.5l3 1.5" />
    {:else if kind === 'hike'}
      <circle cx="12.5" cy="4.2" r="1.8" /><path d="M11.5 8l-1 5 2.5 3 1.5 4 M10.5 13l-2.5 2.5 M12.5 10.5l3.5 2 M18 4v16" />
    {:else if kind === 'ride'}
      <circle cx="5.5" cy="16.5" r="3.3" /><circle cx="18.5" cy="16.5" r="3.3" /><path d="M5.5 16.5l4-6h5l-3.5 6 M9.5 10.5l2.5 6h6.5 M13.5 7h2.5" /><circle cx="14" cy="4.6" r="1.4" />
    {:else if kind === 'swim'}
      <circle cx="17" cy="7" r="1.8" /><path d="M3 16.5c1.6 0 1.6 1.3 3.2 1.3s1.6-1.3 3.2-1.3 1.6 1.3 3.2 1.3 1.6-1.3 3.2-1.3 1.6 1.3 3.2 1.3 M6 13l5-2.5 2.5 2 M11 10.5l3.5-2.5" />
    {:else if kind === 'row'}
      <path d="M3.5 15q8.5 4.5 17 0 M9 15l-3.5-4.5 M15 15l3.5-4.5" />
    {:else if kind === 'strength'}
      <path d="M4 9v6 M7 7.5v9 M17 7.5v9 M20 9v6 M7 12h10" />
    {:else if kind === 'ski'}
      <path d="M4 19l15-5 M6.5 12l2 7 M18 7.5l-3 9.5 M5 17.5l13.5-4.5" /><circle cx="15.5" cy="5" r="1.6" />
    {:else if kind === 'snowboard'}
      <path d="M6 17c2 2 11-7 13-10-2-2-11 7-13 10Z M10 13l1.8 1.8 M13.2 9.8l1.8 1.8" />
    {:else if kind === 'climb'}
      <path d="M12 3l7 18H5z M12 9l3.5 8 M12 9l-3.5 8" />
    {:else if kind === 'yoga'}
      <circle cx="12" cy="5" r="1.9" /><path d="M12 8v6 M6 20c0-3 3-6 6-6s6 3 6 6 M8.5 12l7 0" />
    {:else if kind === 'race'}
      <path d="M7 4h10v3a5 5 0 0 1-10 0z M7 5H4.5v1.5A2.5 2.5 0 0 0 7 9 M17 5h2.5v1.5A2.5 2.5 0 0 1 17 9 M12 12v3 M9 20h6 M10 17.5h4" />
    {:else}
      <circle cx="12" cy="12" r="3.3" /><path d="M12 3v3 M12 18v3 M3 12h3 M18 12h3" />
    {/if}
  </svg>
  {#if done}<span class="badge"><svg viewBox="0 0 24 24"><path d="M5 12.5l4 4 10-10" /></svg></span>{/if}
</span>

<style>
  .tile { position: relative; flex-shrink: 0; display: inline-grid; place-items: center;
          background: color-mix(in srgb, var(--c) 16%, var(--card)); }
  .tile.flat { background: none; }
  svg { fill: none; stroke: var(--c); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; display: block; }
  .badge { position: absolute; right: -3px; bottom: -3px; width: 15px; height: 15px; border-radius: 50%;
           background: var(--green); display: grid; place-items: center; box-shadow: 0 0 0 2px var(--card); }
  .badge svg { width: 10px; height: 10px; stroke: #fff; stroke-width: 3.2; }
</style>
