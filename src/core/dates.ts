/** Datums-Helfer. Alle Tage als lokale ISO-Daten "YYYY-MM-DD" (keine UTC-Verschiebung). */
export function isoDate(d: Date): string {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
export function today(): string { return isoDate(new Date()); }
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return isoDate(new Date(y, m - 1, d + n));
}
/** Montag der Woche, in der iso liegt. */
export function weekStart(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const wd = (new Date(y, m - 1, d).getDay() + 6) % 7; // Mo=0
  return addDays(iso, -wd);
}
export function fmtDay(iso: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: '2-digit', month: '2-digit' }) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('de-DE', opts);
}
export function fmtAgo(ts: number): string {
  const min = Math.round((Date.now() - ts) / 60000);
  if (min < 1) return 'gerade eben';
  if (min < 60) return `vor ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `vor ${h} h`;
  return `vor ${Math.round(h / 24)} Tagen`;
}
