<script lang="ts">
  let { current, mobilityDue = false }: { current: string; mobilityDue?: boolean } = $props();
  // Icons als einfache SVG-Pfade (24er Raster)
  const tabs = [
    { id: 'heute', label: 'Heute', d: 'M4 20 L10 9 L13 14 L15 11 L20 20 Z' },
    { id: 'plan', label: 'Plan', d: 'M5 6h14v13H5z M5 10h14 M9 4v4 M15 4v4' },
    { id: 'ernaehrung', label: 'Ernährung', d: 'M6 3v6a2.5 2.5 0 0 0 5 0V3 M8.5 3v18 M17.5 21V3c-2.2 1.6-3.2 4.6-3.2 8.5h3.2' },
    { id: 'mobility', label: 'Mobility', d: 'M4 12a8 8 0 0 1 14-5.3 M20 12a8 8 0 0 1-14 5.3 M18 4v4h-4 M6 20v-4h4' },
    { id: 'mehr', label: 'Mehr', d: 'M6 12h.01 M12 12h.01 M18 12h.01' }
  ];
</script>

<nav>
  {#each tabs as t}
    <a href={'#/' + t.id} class:active={current === t.id} aria-current={current === t.id ? 'page' : undefined}>
      <span class="icon">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d={t.d} /></svg>
        {#if t.id === 'mobility' && mobilityDue}<i class="dot"></i>{/if}
      </span>
      <span>{t.label}</span>
    </a>
  {/each}
</nav>

<style>
  nav {
    /* Kein position:fixed – die Leiste ist Teil des Gerüsts und bleibt immer unten */
    flex-shrink: 0; z-index: 10;
    display: grid; grid-template-columns: repeat(5, 1fr);
    /* Wie die iOS-Tab-Leiste: Beschriftung sitzt knapp über dem Home-Balken */
    padding: 4px 4px max(calc(env(safe-area-inset-bottom) - 12px), 8px);
    background: color-mix(in srgb, var(--bg) 82%, transparent);
    backdrop-filter: blur(18px) saturate(1.4); -webkit-backdrop-filter: blur(18px) saturate(1.4);
    border-top: 1px solid var(--line);
  }
  a { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 4px 0 2px;
      color: var(--muted); text-decoration: none; font-size: 11px; font-weight: 500; min-height: 44px; }
  svg { width: 26px; height: 26px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  a.active { color: var(--accent); }
  a.active svg { stroke-width: 2.2; }
  /* "Mehr"-Punkte etwas dicker */
  a:last-child svg { stroke-width: 3.2; }
  .icon { position: relative; display: flex; }
  .dot { position: absolute; top: -2px; right: -3px; width: 8px; height: 8px; border-radius: 50%; background: var(--accent); border: 1.5px solid var(--bg); }
</style>
