# Basislager

Persönliche Trainings-, Erholungs- und Ernährungs-App (PWA) für das iPhone.

- Läuft unter https://jghosting.github.io/basislager/
- Daten liegen ausschließlich lokal im Browser (IndexedDB). Im Repo liegen keine Daten und keine Schlüssel.
- Aktivitäten und Morgenwerte kommen über die intervals.icu-API (Garmin als Quelle).
- Jeder Push auf `main` baut und veröffentlicht die App automatisch (GitHub Actions → Pages).

Lokal: `npm install`, `npm run dev`, `npm run build`.
