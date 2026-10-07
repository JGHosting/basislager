<script lang="ts">
  /** Kamera-Scanner (ZXing). Safari kennt die native BarcodeDetector-API nicht, ZXing läuft überall. */
  import { onMount } from 'svelte';
  let { ondetect, onclose }: { ondetect: (code: string) => void; onclose: () => void } = $props();
  let video: HTMLVideoElement;
  let error = $state('');
  let stop: (() => void) | null = null;

  onMount(() => {
    let cancelled = false;
    (async () => {
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        const reader = new BrowserMultiFormatReader();
        const controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } } }, video,
          (result) => { if (result && !cancelled) { cancelled = true; controls.stop(); navigator.vibrate?.(40); ondetect(result.getText()); } }
        );
        stop = () => controls.stop();
        if (cancelled) controls.stop();
      } catch (e) {
        error = (e as Error).name === 'NotAllowedError'
          ? 'Kein Kamerazugriff. Erlaube die Kamera in den iPhone-Einstellungen (Safari → Kamera) oder gib den Barcode unten ein.'
          : 'Kamera konnte nicht gestartet werden. Gib den Barcode unten ein.';
      }
    })();
    return () => { cancelled = true; stop?.(); };
  });
  let manual = $state('');
</script>

<div class="scan">
  {#if !error}
    <div class="frame">
      <!-- svelte-ignore a11y_media_has_caption -->
      <video bind:this={video} playsinline muted></video>
      <span class="aim"></span>
    </div>
    <p class="muted small">Barcode in den Rahmen halten.</p>
  {:else}
    <p class="error small">{error}</p>
  {/if}
  <form class="manual" onsubmit={e => { e.preventDefault(); if (manual.trim()) ondetect(manual.trim()); }}>
    <input bind:value={manual} inputmode="numeric" placeholder="Barcode eingeben" />
    <button class="btn">Suchen</button>
  </form>
  <button class="btn ghost wide" onclick={onclose}>Abbrechen</button>
</div>

<style>
  .frame { position: relative; border-radius: 18px; overflow: hidden; background: #000; aspect-ratio: 4 / 3; }
  video { width: 100%; height: 100%; object-fit: cover; display: block; }
  .aim { position: absolute; left: 12%; right: 12%; top: 35%; bottom: 35%; border: 2px solid rgba(255,255,255,.9); border-radius: 12px; box-shadow: 0 0 0 999px rgba(0,0,0,.25); }
  .small { font-size: 13px; text-align: center; }
  .manual { display: flex; gap: 8px; margin-top: 12px; }
  .manual input { margin: 0; }
  .manual .btn { flex-shrink: 0; }
</style>
