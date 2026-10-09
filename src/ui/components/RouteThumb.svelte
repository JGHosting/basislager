<script lang="ts">
  /**
   * Routen-Vorschau: wenn möglich eine einfache (verblasste, dunkle/helle) Karte mit der Strecke in Orange.
   * Kartenkacheln: CARTO-Basemaps auf OpenStreetMap-Basis (Attribution unten). Offline/ohne Kacheln
   * fällt die Anzeige auf die reine Streckenform auf verblasster Fläche zurück.
   */
  import { liveQuery } from 'dexie';
  import { db, type Activity } from '../../core/db';
  import { ensureRoute, hasGps, normalizeRoute } from '../../domain/activity/route';

  let { a, size = 52, wide = false }: { a: Activity; size?: number; wide?: boolean } = $props();

  const live = liveQuery(() => db.activities.get(a.id));
  const route = $derived(($live?.extra?.route ?? a.extra?.route ?? undefined) as [number, number][] | null | undefined);

  let tried = false;
  $effect(() => { if (!tried && route === undefined && hasGps(a.sportType)) { tried = true; void ensureRoute($live ?? a); } });

  // Container-Maße (für die Kachelberechnung)
  let cw = $state(0), ch = $state(0);

  // Hell/Dunkel für den Kartenstil
  let darkMode = $state(true);
  $effect(() => {
    const read = () => {
      const t = document.documentElement.getAttribute('data-theme');
      darkMode = t === 'dark' ? true : t === 'light' ? false : window.matchMedia('(prefers-color-scheme: dark)').matches;
    };
    read();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', read);
    return () => mq.removeEventListener('change', read);
  });

  const TILE = 256, PAD = 8;
  const lon2x = (lon: number, z: number) => (lon + 180) / 360 * Math.pow(2, z);
  const lat2y = (lat: number, z: number) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z); };

  const map = $derived.by(() => {
    const r = route; if (!r || r.length < 2) return null;
    const w = wide ? cw : size, h = wide ? (ch || 150) : size;
    if (!(w > 0) || !(h > 0) || !navigator.onLine) return null;
    let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
    for (const [la, lo] of r) { if (la < minLat) minLat = la; if (la > maxLat) maxLat = la; if (lo < minLon) minLon = lo; if (lo > maxLon) maxLon = lo; }
    // größte Zoomstufe wählen, bei der die Route (mit Rand) in die Fläche passt
    let z = 2;
    for (let zz = 18; zz >= 2; zz--) {
      const sx = (lon2x(maxLon, zz) - lon2x(minLon, zz)) * TILE;
      const sy = (lat2y(minLat, zz) - lat2y(maxLat, zz)) * TILE;
      if (sx <= w - 2 * PAD && sy <= h - 2 * PAD) { z = zz; break; }
    }
    const cx = (lon2x(minLon, z) + lon2x(maxLon, z)) / 2 * TILE;
    const cy = (lat2y(minLat, z) + lat2y(maxLat, z)) / 2 * TILE;
    const ox = cx - w / 2, oy = cy - h / 2;
    const sub = ['a', 'b', 'c', 'd'], style = darkMode ? 'dark_all' : 'light_all';
    const r2 = (window.devicePixelRatio || 1) > 1 ? '@2x' : '';
    const max = Math.pow(2, z);
    const tiles: { left: number; top: number; url: string }[] = [];
    for (let x = Math.floor(ox / TILE); x <= Math.floor((ox + w) / TILE); x++)
      for (let y = Math.floor(oy / TILE); y <= Math.floor((oy + h) / TILE); y++) {
        if (y < 0 || y >= max) continue;
        const tx = ((x % max) + max) % max;
        tiles.push({ left: x * TILE - ox, top: y * TILE - oy, url: `https://${sub[(tx + y) % 4]}.basemaps.cartocdn.com/${style}/${z}/${tx}/${y}${r2}.png` });
      }
    const d = 'M' + r.map(([la, lo]) => `${(lon2x(lo, z) * TILE - ox).toFixed(1)} ${(lat2y(la, z) * TILE - oy).toFixed(1)}`).join('L');
    return { w, h, tiles, d };
  });

  // Fallback-Form (ohne Karte)
  const shape = $derived.by(() => {
    const r = route; if (!r || r.length < 2) return null;
    const n = normalizeRoute(r); if (!n) return null;
    return { w: n.w, h: n.h, d: 'M' + n.pts.map(([x, y]) => `${x.toFixed(3)} ${y.toFixed(3)}`).join('L') };
  });
</script>

{#if route && route.length >= 2}
  <span class="thumb" class:wide bind:clientWidth={cw} bind:clientHeight={ch} style={wide ? '' : `width: ${size}px; height: ${size}px`}>
    {#if map}
      {#each map.tiles as t}<img class="tile" src={t.url} alt="" loading="lazy" style="left: {t.left}px; top: {t.top}px" onerror={e => (e.currentTarget.style.visibility = 'hidden')} />{/each}
      <span class="scrim"></span>
      <svg class="over" viewBox="0 0 {map.w} {map.h}" preserveAspectRatio="none"><path d={map.d} /></svg>
      {#if wide}<span class="attr">© OpenStreetMap, © CARTO</span>{/if}
    {:else if shape}
      <svg class="shape" viewBox="-0.08 -0.08 {shape.w + 0.16} {shape.h + 0.16}" preserveAspectRatio="xMidYMid meet"><path d={shape.d} /></svg>
    {/if}
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
  .thumb.wide { display: block; width: 100%; height: 150px; border-radius: 16px; margin: 2px 0 10px; }
  .tile { position: absolute; width: 256px; height: 256px; }
  .scrim { position: absolute; inset: 0; background: color-mix(in srgb, var(--bg) 22%, transparent); }
  .over { position: absolute; inset: 0; width: 100%; height: 100%; }
  .over path { fill: none; stroke: var(--accent); stroke-width: 3; stroke-linejoin: round; stroke-linecap: round; paint-order: stroke;
               filter: drop-shadow(0 0 1.5px rgba(0,0,0,.5)); }
  .shape { position: absolute; inset: 8%; width: 84%; height: 84%; }
  .shape path { fill: none; stroke: var(--accent); stroke-width: 2px; stroke-linejoin: round; stroke-linecap: round; vector-effect: non-scaling-stroke; }
  .attr { position: absolute; right: 4px; bottom: 3px; font-size: 9px; line-height: 1.2; color: var(--text); opacity: .6;
          background: color-mix(in srgb, var(--bg) 55%, transparent); padding: 1px 4px; border-radius: 4px; }
  .loading { opacity: .5; }
</style>
