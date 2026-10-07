<script lang="ts">
  import type { Light } from '../../domain/recovery/recovery';
  let { score, light, size = 96 }: { score: number | null; light: Light; size?: number } = $props();
  const r = 42, c = 2 * Math.PI * r;
  const color = $derived({ gruen: 'var(--green)', gelb: 'var(--yellow)', rot: 'var(--red)', grau: 'var(--muted)' }[light]);
</script>

<svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={score == null ? 'Keine Bewertung' : `Erholung ${score} von 100`}>
  <circle cx="50" cy="50" r={r} fill="none" stroke="var(--line)" stroke-width="9" />
  <circle cx="50" cy="50" r={r} fill="none" stroke={color} stroke-width="9" stroke-linecap="round"
          stroke-dasharray={c} stroke-dashoffset={c * (1 - (score ?? 0) / 100)} transform="rotate(-90 50 50)"
          style="transition: stroke-dashoffset .6s ease" />
  <text x="50" y="50" text-anchor="middle" dominant-baseline="central" fill="var(--text)"
        font-size={score == null ? 22 : 30} font-weight="750">{score ?? '–'}</text>
</svg>
