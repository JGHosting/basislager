<script lang="ts">
  let { current }: { current: string } = $props();
  // Icons als einfache SVG-Pfade (24er Raster)
  const tabs = [
    { id: 'heute', label: 'Heute', d: 'M4 20 L10 9 L13 14 L15 11 L20 20 Z' },
    { id: 'plan', label: 'Plan', d: 'M5 6h14v13H5z M5 10h14 M9 4v4 M15 4v4' },
    { id: 'ernaehrung', label: 'Ernährung', d: 'M6 3v6a2.5 2.5 0 0 0 5 0V3 M8.5 3v18 M17.5 21V3c-2.2 1.6-3.2 4.6-3.2 8.5h3.2' },
    { id: 'statistik', label: 'Statistik', d: 'M5 20V12 M10 20V6 M15 20v-9 M20 20V9' },
    { id: 'mehr', label: 'Mehr', d: 'M6 12h.01 M12 12h.01 M18 12h.01' }
  ];
</script>

<nav>
  {#each tabs as t}
    <a href={'#/' + t.id} class:active={current === t.id} aria-current={current === t.id ? 'page' : undefined}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d={t.d} /></svg>
      <span>{t.label}</span>
    </a>
  {/each}
</nav>

<style>
  nav {
    /* Kein position:fixed – die Leiste ist Teil des Gerüsts und bleibt immer unten */
    flex-shrink: 0; z-index: 10;
    display: grid; grid-template-columns: repeat(5, 1fr);
    padding: 6px 4px calc(env(safe-area-inset-bottom) + 4px);
    background: color-mix(in srgb, var(--bg) 82%, transparent);
    backdrop-filter: blur(18px) saturate(1.4); -webkit-backdrop-filter: blur(18px) saturate(1.4);
    border-top: 1px solid var(--line);
  }
  a { display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 6px 0;
      color: var(--muted); text-decoration: none; font-size: 11px; font-weight: 500; min-height: 48px; }
  svg { width: 26px; height: 26px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  a.active { color: var(--accent); }
  a.active svg { stroke-width: 2.2; }
  /* "Mehr"-Punkte etwas dicker */
  a:last-child svg { stroke-width: 3.2; }
</style>
