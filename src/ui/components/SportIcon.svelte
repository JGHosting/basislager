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

<span class="tile" class:flat style="--c: {color}; width: {size}px; height: {size}px; border-radius: {Math.round(size * 0.28)}px">
  <svg class="glyph" viewBox="0 0 24 24" aria-hidden="true" style="width: {Math.round(size * 0.6)}px; height: {Math.round(size * 0.6)}px">
    {#if kind === 'run'}
      <circle cx="14" cy="5" r="1.6" /><path d="M7 9l4-1 3 3 3 1 M11 8l-1.5 4 3.5 3 .5 5 M14 15l-4-1-2.5 4" />
    {:else if kind === 'walk'}
      <circle cx="13.5" cy="4.5" r="1.6" /><path d="M13.5 7.5l-1.5 4.5 3 2.5 1 5.5 M12 12l-3.5 2.5-.5 3 M13.5 9l3 1.5" />
    {:else if kind === 'hike'}
      <circle cx="12.5" cy="4.5" r="1.6" /><path d="M12.5 7.5l-1.5 4.5 3 2.5 1 5.5 M11 12l-3 2.5-.5 3 M12.5 9l3 1.5" /><path d="M18 4.5v15.5" />
    {:else if kind === 'ride'}
      <circle cx="6" cy="16.5" r="3.5" /><circle cx="18" cy="16.5" r="3.5" /><path d="M6 16.5l3.5-6h5 M9 10.5l3 6h6 M14.5 7.5h2.5" /><circle cx="15" cy="5" r="1.4" />
    {:else if kind === 'swim'}
      <circle cx="17.5" cy="7" r="1.7" /><path d="M5.5 13l4-2.5 3 2 3-3" /><path d="M3 17.5c1.4 0 1.8-1 3.2-1s1.8 1 3.2 1 1.8-1 3.2-1 1.8 1 3.2 1 1.8-1 3.2-1" />
    {:else if kind === 'row'}
      <path d="M3 15.5q9 5 18 0" /><path d="M9 15l-3-4" /><path d="M15 15l3-4" /><circle cx="19" cy="7.5" r="1.3" />
    {:else if kind === 'strength'}
      <path d="M4 10v4 M7 8v8 M17 8v8 M20 10v4 M7 12h10" />
    {:else if kind === 'ski'}
      <circle cx="15" cy="5" r="1.5" /><path d="M14.5 7l-1.5 4 2.5 2 .5 3.5" /><path d="M9.5 9l3.5-1" /><path d="M4 18l15.5-4.5" /><path d="M5.3 19.8l15.5-4.5" />
    {:else if kind === 'snowboard'}
      <path d="M6.4 17.6c-.6-.6-.6-1.5 0-2.1L15.5 6.4c.6-.6 1.5-.6 2.1 0s.6 1.5 0 2.1L8.5 17.6c-.6.6-1.5.6-2.1 0Z" /><path d="M9.8 13.2l1.6 1.6" /><path d="M12.8 10.2l1.6 1.6" />
    {:else if kind === 'climb'}
      <path d="M4 21l6-14 5 7 2-3 3 10z" />
    {:else if kind === 'yoga'}
      <circle cx="12" cy="4.5" r="1.6" /><path d="M12 7v6 M12 13l-5 2 M12 13l5 2 M8.5 11.5h7" />
    {:else if kind === 'race'}
      <path d="M7 4h10v4.5a5 5 0 0 1-10 0z" /><path d="M7 5.5H4.5v1.5a3 3 0 0 0 3 3" /><path d="M17 5.5h2.5v1.5a3 3 0 0 1-3 3" /><path d="M12 13.5V17" /><path d="M8.5 20.5h7" /><path d="M9.5 20.5l.7-3.5h3.6l.7 3.5" />
    {:else}
      <path d="M3 12h4l2.5-6 5 13 2.5-7H21" />
    {/if}
  </svg>
  {#if done}<span class="badge"><svg viewBox="0 0 24 24"><path d="M5 12.5l4 4 10-10" /></svg></span>{/if}
</span>

<style>
  /* Farbiger „Liquid Glass“-Look: glänzende Kachel in der Sportfarbe, weiße Glyphe mit sanfter Tiefe. */
  .tile { position: relative; flex-shrink: 0; display: inline-grid; place-items: center;
          background:
            linear-gradient(150deg, rgba(255,255,255,.45), rgba(255,255,255,0) 46%),
            radial-gradient(130% 90% at 28% 12%, rgba(255,255,255,.35), rgba(255,255,255,0) 55%),
            linear-gradient(158deg, color-mix(in srgb, var(--c) 68%, white), var(--c) 82%, color-mix(in srgb, var(--c) 82%, black));
          box-shadow: inset 0 1px 0 rgba(255,255,255,.55), inset 0 -2px 5px rgba(0,0,0,.18),
                      inset 0 0 0 .5px rgba(255,255,255,.3), 0 2px 5px rgba(0,0,0,.2); }
  .glyph { display: block; fill: none; stroke: #fff; stroke-width: 2.1; stroke-linecap: round; stroke-linejoin: round;
           filter: drop-shadow(0 1px 1.2px rgba(0,0,0,.28)); }
  .tile.flat { background: none; box-shadow: none; }
  .tile.flat .glyph { stroke: var(--c); filter: none; }
  .badge { position: absolute; right: -3px; bottom: -3px; width: 15px; height: 15px; border-radius: 50%;
           background: var(--green); display: grid; place-items: center; box-shadow: 0 0 0 2px var(--card); }
  .badge svg { width: 10px; height: 10px; fill: none; stroke: #fff; stroke-width: 3.2; stroke-linecap: round; stroke-linejoin: round; }
</style>
