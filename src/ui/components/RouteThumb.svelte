<script lang="ts">
  /** Kleine Routen-Vorschau: GPS-Spur in Orange auf verblasster, dunkler Kartenfläche. */
  import { liveQuery } from 'dexie';
  import { db, type Activity } from '../../core/db';
  import { ensureRoute, hasGps } from '../../domain/activity/route';

  let { a, size = 52, wide = false }: { a: Activity; size?: number; wide?: boolean } = $props();

  // Route aus dem (ggf. aktualisierten) DB-Stand lesen
  const live = liveQuery(() => db.activities.get(a.id));
  const route = $derived($live?.extra?.route ?? (a.extra?.route ?? undefined));

  // Fehlt sie noch und GPS möglich: einmal nachladen (seriell, rate-begrenzt in ensureRoute)
  let tried = false;
  $effect(() => {
    if (!tried && route === undefined && hasGps(a.sportType)) { tried = true; void ensureRoute($live ?? a); }
  });

  const box = $derived.by(() => {
    if (!route || route.length < 2) return null;
    let w = 0, h = 0;
    for (const [x, y] of route) { if (x > w) w = x; if (y > h) h = y; }
    return { w: w || 1, h: h || 1, d: 'M' + route.map(([x, y]) => `${x.toFixed(3)} ${y.toFixed(3)}`).join('L') };
  });
</script>

{#if box}
  <span class="thumb" class:wide style={wide ? '' : `width: ${size}px; height: ${size}px`}>
    <svg viewBox="-0.08 -0.08 {box.w + 0.16} {box.h + 0.16}" preserveAspectRatio="xMidYMid meet">
      <path d={box.d} fill="none" stroke="var(--accent)" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
    </svg>
  </span>
{:else if hasGps(a.sportType) && route === undefined}
  <span class="thumb loading" class:wide style={wide ? '' : `width: ${size}px; height: ${size}px`}></span>
{/if}

<style>
  .thumb { display: inline-block; flex-shrink: 0; border-radius: 12px; overflow: hidden; position: relative;
           background:
             radial-gradient(120% 120% at 70% 20%, color-mix(in srgb, var(--c-swim) 10%, transparent), transparent 60%),
             linear-gradient(145deg, color-mix(in srgb, var(--text) 10%, var(--card)), color-mix(in srgb, var(--text) 3%, var(--card)));
           box-shadow: inset 0 0 0 1px var(--line); }
  .thumb svg { position: absolute; inset: 8%; width: 84%; height: 84%; }
  .thumb svg path { stroke-width: 2px; }
  .thumb.wide { display: block; width: 100%; height: 150px; border-radius: 16px; margin: 2px 0 10px; }
  .thumb.wide svg path { stroke-width: 2.5px; }
  .loading { opacity: .5; }
</style>
