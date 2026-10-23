# Basislager — Projekt-Kontext / Übergabe

Kompakte, vollständige Übergabe für einen neuen Chat. Stand: 2026-10-23 spät (PR #1–#5 auf `main`/deployed; **PR #6 `feat/mobility-progression` offen, noch nicht gemergt**).

## Was ist das
Persönliche Trainings- & Ernährungs-PWA fürs iPhone (deutsche UI), nur für Jakob. Kein Server, keine laufenden Kosten, offline nutzbar.
- **Live:** https://jghosting.github.io/basislager/
- **Repo:** JGHosting/basislager (Branch `main`).
- **Deploy:** `.github/workflows/deploy.yml` (GitHub Actions → Pages, bei Push auf `main`), ~40–60 s. Status: `gh api "repos/JGHosting/basislager/actions/runs?branch=main&per_page=1"`.
- **Arbeitsweise:** Jakob ist nicht technisch. Claude entscheidet Stack, baut, testet, pusht, deployed; Jakob testet am iPhone (App schließen/neu öffnen für Update). Deutsch, knapp, **ressourcenschonend**. Größere Features: erst analysieren, Rückfragen, Plan, erst nach „Go“ bauen. **Niemals** API-Keys im Chat.
- **Git in Claude-Sessions:** push-fähiger Clone via `add_repo` mit `access:"push"` (z. B. `/home/claude/basislager`), danach `npm install`. Clone kennt nur `main` → Stop-Hook meldet bei Feature-Branches fälschlich „unpushed commits“ (Stand per `gh api repos/JGHosting/basislager/branches/<b>` prüfen; nach Push `git update-ref refs/remotes/origin/<b> HEAD`). `gh pr create` geht nicht (GraphQL 403) → REST `gh api repos/JGHosting/basislager/pulls -f title=… -f head=… -f base=main -f body=…`; Merge `gh api -X PUT …/pulls/<n>/merge -f merge_method=merge -f sha=<sha>` (**nur mit ausdrücklichem „mergen“ vom Nutzer**, sonst blockiert der Auto-Mode). Remote-Branches löschen ist über den Proxy nicht erlaubt. Kein `pkill -f` mit Muster aus der eigenen Befehlszeile (killt die Shell; Preview-Server stattdessen mit `fuser -k 4173/tcp` beenden).
- **Sichtprüfung:** Playwright in eigenem Ordner (`npm i playwright@1` im Scratchpad), Chromium `/opt/pw-browsers/chromium-1243/chrome-linux64/chrome`, `npx vite preview --port 4173` (URL `http://localhost:4173/`, nicht `/basislager/`), Viewport 390 px, dark; intervals/OSM/OFF-Routen abbrechen; Mobility-Erinnerung mit „Später“ wegklicken. Testdaten per `indexedDB.open('basislager', 140)` (Dexie-Version × 10) erst nach App-Start einspielen, dann neu laden.

## Stack / Architektur
- Svelte 5 (Runes) + TypeScript + Vite 6, `vite-plugin-pwa` (globPatterns inkl. **webp**). Hash-Routing (`route` in `App.svelte`).
- **Dexie** (IndexedDB): **DB-Version 14**, **Backup SCHEMA_VERSION 14** (ab PR #6; v14 = Tabelle `mobilityProgress`). Settings als JSON-Blobs (`getSetting/setSetting`).
- intervals.icu als Garmin-Brücke (Key nur lokal, `EXCLUDED_SETTINGS = {'intervals'}` im Backup). Charts uPlot, BLS/OFF für Ernährung, OSM-Karten.
- **Mobility-Bilder:** RepDB Free Tier (Illustrationen; Attribution „Exercise data by RepDB (repdb.co)“; keine Weitergabe als Datensatz, keine GenAI-Nutzung) + **Free Exercise DB** (github.com/yuhonas/free-exercise-db, Unlicense; Fotos Start/Ende, Herkunft der Fotos unklar → nur für private App ok). Bilder in `public/mobility/<id>.webp` (+ `<id>-2.webp`), WebP 640 px q72. Holen: `GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 --filter=blob:none --no-checkout` + gezielter `git checkout HEAD -- <pfade>` (`dist/exercises.json`, `exercises/<Id>/0.jpg|1.jpg`); Konvertierung mit Python PIL. `exercise-dataset.com` ist im Proxy gesperrt. Lizenzhinweise in Mehr → Über.

## Wichtige Dateien
- `src/core/db.ts` — Schema v1–v14. `PlanEdit.warmup?`, `MobilityLog {date, items[{exerciseId, done}], minutes, sig?}`, `MobilityTest {id, date, results}`, `MobilityProgress {exerciseId, step 0–4, count, total, hard?, lastDate?, lastFb?, unlockedAt?, updatedAt}`.
- `src/backup/backup.ts` — neue Tabellen immer in BACKUP_TABLES, migrate, checkBackup, import (replace/merge), `canonical()` ergänzen.
- **Planer:** `src/domain/planner/plan.ts` Pipeline `applyVacation → applyInjury → applyEdits → applyDone → applyStrengthActual → applyInteractions → applyWarmup → sort`. `warmup.ts` (Kategorien kraft/lauf/rad/schwimmen, Aus/Auto/Immer, Setting `warmup`, Override pro Einheit; kein Cool-down). `workout.ts` (`workoutText` = details + Aufwärmblock + `body()`), `garmin.ts`, `repo.ts` (`editSession` inkl. `warmup`), `sports.ts`.
- **Mobility** `src/domain/mobility/`:
  - `library.ts` — `ALL` (alle Übungen) → `LIBRARY = ALL.filter(e => e.image)` (ohne Bild nicht in Auswahl). Felder: regions (hüfte, rueckseite, bws_schultern, sprunggelenk, nacken, rumpf), goals (+hohlkreuz), difficulty 0–2 (steuert Freischaltung, siehe `progression.ts`), sides, holdSec/reps (Basiswerte Stufe 0), avoid, image/image2, source repdb|fedb|custom.
  - `select.ts` — `buildRoutine`: Hälfte Rotation durch alle Regionen, Hälfte gewichtet nach Zielen (Ziel-Tag 1.5×, Region 1×, Selbsttest-Boost, zuletzt gemachte 0.4×), Rest auffüllen; `pickReplacement` (gleiche Region/Kategorie bevorzugt, verletzungsgerecht).
  - `injury.ts` — Verletzungsregion → Übungen direkt/indirekt belastend; direkt aus bis Stufe 6 (dann nur difficulty 0), indirekt aus bis Stufe 3; schwer/Ausfall = immer aus; plus `avoid` ↔ Bewegung „nicht“. Zuordnung neuer Übungen in der `extra`-Liste.
  - `settings.ts` — Setting `mobility` (minutes 5/10/15, goals[{id, weight 1–3}] nur feste GOALS — eigene Ziele entfernt, intrusiveness aus/sanft/hartnaeckig/brutal, pauseMode/pauseAuto, level 0–2, testIntervalWeeks, rotationIdx) + `mobilityPauseRanges`.
  - `tests.ts` — 7 Selbsttests, `regionScore`, `regionWeightBoost`, `suggestedLevel` (Stufe +1 nur wenn die letzten zwei Tests in ≥2 Regionen ≥0.15 besser).
  - `repo.ts` — `ensureTodayRoutine` (ersetzt offene, inzwischen verletzungsbedingt ausgeschlossene/entfernte Übungen; plant neu, wenn `sig` abweicht und noch nichts erledigt), `rebuildToday` (Button „Routine aktualisieren“; erledigte bleiben), `swapExercise`, `sigOf`, `excludedCount`, `DONE_THRESHOLD 0.8`, `skipToday`, `currentStreak`.
- **Mobility-UI:** `src/ui/views/Mobility.svelte` — Heutige Routine (+Verletzungshinweis) / **Ziele & Einstellungen** (Ziele, Gewichte, Länge, Aufdringlichkeit als Entwurf → erst „Routine aktualisieren“ speichert + plant neu) / Selbsttest / Pausenmodus-Knopf unten. `src/ui/mobility/MobilityPlayer.svelte` — „Gemacht ✓“ (volle Breite) hakt ab, „Tauschen“/„Überspringen“ darunter; bei Seiten erst „Seite wechseln →“; Start/Ende-Fotos wechseln alle 1,6 s. Außerdem `SelfTestSheet`, `MobilityNag`, `MobilityLock`, Abschnitt im `MorningSheet`.
- **Navigation:** Tabs heute/plan/ernaehrung/mobility/mehr. `Mehr.svelte` mit Untermenü (lokaler State): Statistik / Training (Sportarten, Kraft-Split, Pulswerte, Aufwärmen) / Körper (Gewicht, Verletzung → `openInjury()`) / Verbindungen / Daten / Über. `SessionCard.svelte` zeigt Aufwärmen + Aus/Auto/Immer pro Einheit.
- Erinnerungen nur in der App (beim Öffnen + alle 15 min solange offen), keine Push/Kurzbefehle (Nutzerwunsch).

## Muster / Fallstricke
- JSON-Clone bzw. `$state.snapshot` vor IndexedDB-`put`. liveQuery mit Parametern: `$effect` + subscribe. Props → State per `$effect`. iOS-Viewport `--app-h`. null ≠ 0.
- Prüfen: `npx tsc --noEmit`, `npx vite build`; Domänenlogik mit `npx -y tsx <script>` (Script im Scratchpad, absolute Imports). Alte Build-Warnungen (Statistik unused CSS, BarcodeScanner `video`, a11y Heute) sind bekannt.
- Commit-Attribution: die im jeweiligen Chat vorgegebene verwenden.

## Mobility-Paket „App-Store-Niveau“ (PR #6, gebaut, wartet auf Merge + iPhone-Test)
Nutzerentscheidungen: Selbsttest-Stufe schaltet nur Schwierigkeit frei (keine pauschale Haltezeit mehr); Feedback freiwillig; alle Übungen starten bei Stufe 0; alles in einem PR; Seiten einzeln mit Weiterklicken; Halte-Timer per „Start“ mit Signalton.
- `src/domain/mobility/progression.ts`: Stufe 0–4 je Übung, `holdFor` (+25 %/Stufe, auf 5 s gerundet), `repsFor` (+2/Stufe), `STEP_AFTER = 3` Durchgänge je Stufe; `applyFeedback` (leicht = sofort +1, schwer = −1 bzw. auf 0 `hard` → Gewicht 0.3; pro Tag zählt eine Übung nur einmal). „Sitzt“ = Stufe ≥ 1 (Anzeige 2. Punkt). `CHAINS` (Varianten-Ketten leicht→schwer, ODER-Vorgänger), `isUnlocked` (difficulty 0 oder ≤ settings.level immer frei; sonst Vorgänger aus Kette sitzt; ohne Kette: leichtere Übung derselben Region sitzt). `recordExercise` liefert neu freigeschaltete Übungen (+ `unlockedAt`).
- `select.ts`: Pool nur freigeschaltete Übungen; `toItem(e, progress)`; `progressWeight` (neu freigeschaltete schwere 1.6×, `hard` 0.3×). `scaledHold/scaledReps` entfernt. `pickReplacement(..., progress)`.
- `repo.ts`: `rateExercise(id, fb)`; `ensureTodayRoutine`/`swapExercise` laden Fortschritt.
- `history.ts`: `dayStates` (done/partial/skipped/paused), `totals` (Tage, Minuten ≈ minutes×completion, beste Serie), `testSeries` (regionScore je Test).
- UI: Mobility-Tab mit Segment **Heute | Verlauf**; `src/ui/mobility/MobilityHistory.svelte` (Kennzahlen, Monatskalender, Selbsttest-Sparklines je Region, Übungsliste je Region mit Stufenpunkten, 🔒 + „frei, wenn … sitzt“, „neu“-Badge 7 Tage). Player: jede Seite eigener Schritt mit Pill „Linke/Rechte Seite“, Stufenpunkte neben Titel, Timer idle → „▶ Start“ → Pause/Fortsetzen → „Zeit um ✓“ + `beep()` (`src/ui/mobility/beep.ts`, Web Audio, `unlockAudio()` beim Start-Tippen, `navigator.audioSession.type='playback'` für iOS-Stummschalter, Vibration wo verfügbar), Zeit über `endAt` (stimmt nach Bildschirmsperre). Nach „Gemacht ✓“ Feedback-Leiste unten (Zu leicht/Passt/Zu schwer, 4-s-Balken → „passt“; beim Schließen offenes Feedback = „passt“). Abschluss-Screen zeigt „🔓 Neu freigeschaltet“.
- 32 neue Übungen (Free Exercise DB, je `<id>.webp` + `<id>-2.webp`): wadendehnung-wand, soleus-dehnung, knie-kreisen, hueftbeuger-stand, hueftkreisen-stand, figur-vier-liegend, knie-zur-brust-einbeinig, adduktoren-seitlage, quad-dehnung-seitlage, quad-dehnung-vierfuss, hueftkreisen-vierfuss, worlds-greatest-stretch, ausfallschritt-rotation, skorpion, adduktoren-einrollen, beinstrecken-9090, laeufer-dehnung, inchworm, oberschenkel-umarmen, rumpfdrehung-stand, armschwingen, seitdehnung-liegend, lat-dehnung-wand, strecken-nach-oben, drehsitz, knie-umarmen, windmuehle, superman, schultern-heben, oberer-ruecken-rund, ellbogen-zurueck, knie-ueber-koerper. Verletzungs-Zuordnung in `injury.ts` (`extra`). `deep-squat-hold` zusätzlich Region/Ziel Sprunggelenk. Jetzt 91 Übungen, 47 zu Beginn frei. Partner-/Gurt-/Stuhl-Übungen der FEDB bewusst weggelassen.
- Geprüft: tsc, vite build, Domänentest (tsx), Playwright-Screens (Heute, Verlauf, Player, Timer, Feedback; Feedback „zu leicht“ hebt Stufe und schaltet 90/90 frei).
- Offen: Merge von PR #6 (nur auf ausdrückliches „mergen“), dann iPhone-Test (v. a. Signalton bei Stummschalter/gesperrtem Bildschirm, Feedback-Flow, Verlauf).
- Weiterhin nicht gewählt: Programme über Wochen, Sprachansagen/Übergangspausen/Display-an.

## Weitere offene Punkte
- iPhone-Test durch Jakob: neue Mobility-Ansicht, Player, Aufwärmen auf der Garmin-Uhr.
- Nur am iPhone prüfbar: Kamera-Barcode, OSM-Kacheln standalone, Garmin-Übernahme der Workouts.

## Separate Projekte (NICHT Basislager)
Navigations-/Stadtführer-App (geplant), Spiele-Tracker (JGHosting/Spiele-Tracker).
