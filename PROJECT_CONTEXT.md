# Basislager — Projekt-Kontext / Übergabe

Kompakte, vollständige Übergabe für einen neuen Chat. Stand: 2026-10-22 (Update 1: Mehrsportarten + Physio).

## Was ist das
Persönliche Trainings- & Ernährungs-PWA fürs iPhone (deutsche UI), nur für Jakob. Kein Server, keine laufenden Kosten, offline nutzbar.
- **Live:** https://jghosting.github.io/basislager/
- **Repo:** JGHosting/basislager (Branch `main`; `data-raw` = BLS-Rohdaten; `fetch-sources`).
- **Deploy:** `.github/workflows/deploy.yml` (GitHub Actions → GitHub Pages). Nach jedem Push ~40–60 s. Prüfen: `gh run list --workflow deploy.yml -L 1`.
- **Arbeitsweise mit dem Nutzer:** Jakob ist nicht technisch. Claude entscheidet Stack, baut, testet, pusht, deployed. Jakob testet auf dem iPhone. Antworten auf Deutsch, knapp, konkret. **Niemals** API-Keys/Secrets im Chat erbeten/anzeigen.

## Stack / Architektur
- Svelte 5 (Runes) + TypeScript + Vite 6, `vite-plugin-pwa` (Workbox). `base: './'`, Hash-Routing.
- **Dexie.js** (IndexedDB), versioniertes Schema. Aktuell **DB-Version 12**, **Backup SCHEMA_VERSION 12**.
- Charts: **uPlot** (`UChart.svelte`), synced cursor key 'stats'. Muskelgruppen als Raster (`MuscleGrid.svelte`), Gewicht als Tageslinie.
- BLS-Lebensmittel: `public/data/bls-4.0.json` (7140, CC BY 4.0, Max-Rubner-Institut). Suche: MiniSearch (Umlaut-Folding, Synonyme). Barcode: @zxing/browser. Online-Ergänzung: Open Food Facts (ODbL).
- Datenquelle: **intervals.icu** API (Garmin ist dort angebunden). **Strava ist bewusst KEINE Quelle** (verlangt Abo). Basic-Auth user `"API_KEY"`, Key nur lokal (nie im Repo/Backup/Chat).
- **Karten:** OpenStreetMap-Standardkacheln (`tile.openstreetmap.org`, schlüssellos), per CSS-Filter verdunkelt/verblasst; Route in Orange. Workbox-Runtime-Cache `map-tiles`. Attribution © OpenStreetMap-Mitwirkende.
- **Sport-Icons:** Material Symbols (Apache-2.0), weiße gefüllte Glyphen auf farbiger „Liquid-Glass"-Kachel (`SportIcon.svelte`, viewBox `0 -960 960 960`).

## Wichtige Dateien (Domäne)
- `src/core/db.ts` — Dexie-Schema v1–v12; Interfaces Activity(+extra: ActivityExtra mit hrHist/route), MorningEntry, StrengthSession, SplitTemplate(+BUILTIN_SPLITS inkl. `split-ppa` Push/Pull/Arme), Food, FoodLogEntry, NutritionDay, MealTemplate, Injury, Goal, PlanEdit, FixedEvent (nur noch Altdaten), Vacation(+sport?: VacationSport). MuscleGroup = push|pull|arme|beine|rumpf|ganzkoerper.
- `src/backup/backup.ts` — SCHEMA_VERSION 12; BACKUP_TABLES inkl. mealTemplates; migrate()-Kette; EXCLUDED_SETTINGS {'intervals'} (Key nie exportiert); runRoundtripTest. **Jede neue Tabelle hier ergänzen.**
- `src/sources/intervals/client.ts` — icu.athlete/activities/events/wellness/activity/streams(+data2 für latlng)/paceCurves/upsertEvents/updateEvent/deleteEvents.
- `src/sources/intervals/sync.ts` — Historie in Jahresblöcken, resume, 7-Tage-Overlap, behält prev.extra.
- `src/domain/planner/plan.ts` — Planer (regelbasiert). Standardwoche + Wettkampf-Periodisierung. `kraftCount` 0–6, `KRAFT_DAYS`, `assignKraft` (Beintage mit Abstand, Sa frei). `applyVacation` (Urlaub + Sport-Urlaub ersetzt Training, Tag davor keine Beine/harten Einheiten). `applyInjury` (Kraft bleibt unangetastet, nur Ausdauer). `applyStrengthActual` (zeigt tatsächlich trainierte Gruppen, setzt Split fort). `applyInteractions` (außerplanmäßiges Training). Pulszonen 5-Zonen %HFmax inkl. Z0.
- `src/domain/planner/sports.ts` — **Sportarten** (Einstellung `sports` = {main, list[{sport lauf|rad|schwimmen, perWeek 0–5, mode grundlage|leistung}]}); normalizeSports (Fallback aus altem `runsPerWeek`), rolesFor (Leistung: max. 2 Qualität, ab 2× eine lange; Grundlage: alles Z2). In plan.ts: `enduranceWeek` erzeugt + verteilt Ausdauer (lang: Haupt Sa/weitere So; Qualität mit Abstand; locker auf freieste Tage). Wettkampfmodus: Zusatzsportarten (nicht vom Ziel abgedeckt) laufen mit, Spitze/Taper nur locker, Wettkampfwoche keine. Keys `run-/ride-/swim-` + `easy|q|q2|long` (+Zähler).
- `src/domain/planner/repo.ts` — loadContext/planWeeks/sessionsOn/saveGoal/editSession/saveEvent/setRunsPerWeek/setStrengthPerWeek(0–6)/lowBase.
- `src/domain/planner/garmin.ts` — Plan-Einheiten als strukturierte Workouts in intervals.icu-Kalender (upsert via external_id `basislager:<key>`, Diff nachziehen, entfernen). `src/domain/planner/workout.ts` = Workout-Text (Puls-%/Pace). Einstellungen in `GarminSettings.svelte`.
- `src/domain/planner/besttimes.ts` — Bestzeiten aus intervals Pace-Kurve (Fallback ganze Läufe), Riegel-Prognose; `BestTimes.svelte` in Statistik; Zielzeit-Vorschlag in `GoalSheet.svelte`.
- `src/domain/strength/strength.ts` — GROUPS (inkl. arme), CORE_GROUPS, nextSplitDay. `repo.ts` — saveSession, sessionFor, dedupeStrength, ensureBuiltinSplits, **autoAssignStrength** (ordnet Garmin-Krafttrainings beim Abgleich automatisch nächste Split-Gruppe zu).
- `src/domain/activity/route.ts` — latlng-Stream (data=Breite, data2=Länge!), downsampleRoute (Roh lat/lng), normalizeRoute (Form-Fallback), ensureRoute (seriell, rate-limitiert, cached in extra.route), resetRoutes (Flag `routesFixedV3`). `details.ts` — Detaildaten (merged extra, überschreibt route/hrHist nicht).
- `src/domain/nutrition/repo.ts` — Tracker, Rezepte, „wie gestern"/Vorlagen (MealTemplate), Makroziele. `src/domain/stats/metrics.ts` — Kennzahlen; Muskelgruppen-Raster (heatmap), Gewicht (dayLine).
- `src/domain/injury/rehab.ts` — **Physio**: Erkennung `isPhysioName` (Name/Sport enthält Physio/Reha/Krankengymnastik) bzw. bewertete Aktivität; `physioIds` → ctx.physio (zählt nicht als Kraft/außerplanmäßig); `rehabCriteria` je Stufe/Region; `assessRehab` (bereit bei 2 Einheiten mit allen Zielen + Schmerz ≤3, bzw. 1 mit Physio-Freigabe; Blocker: Schmerz ≥5, Folgemorgen-Schmerz +2, advanceCheck). Stufenaufstieg nur nach Bestätigung (stageHistory.via 'physio'). Daten: `Injury.rehab: RehabCheck[]` (kein Schema-Bump nötig). UI: `PhysioSheet.svelte`, Abschnitt in `InjuryCard`, Hinweis in `ActivitySheet`.
- `src/domain/vacation/vacation.ts` — VACATION_SPORTS, VACATION_LEG, saveVacation. Urlaub & Fixtermine sind **zusammengelegt** (Fixtermine migriert zu Urlaub+Sport).

## UI (Views/Komponenten)
Routen: heute/plan/ernaehrung/statistik/mehr. `src/ui/app.svelte.ts` = globaler State + sync (ruft nach Erfolg autoAssignStrength, schedulePush, refreshCurves; initApp ruft ensureBuiltinSplits/dedupeStrength/autoAssignStrength/resetRoutes).
- `Heute.svelte` — Morgenpopup, Ampel, Load, Diese Woche, **Letzte Aktivitäten (6 Monate, nach Monat gruppiert)** mit SportIcon + Fakten je Sportart + RouteThumb.
- `ActivitySheet.svelte` — Detail inkl. breitem Karten-Banner (RouteThumb wide), Pulszonen.
- `SessionCard.svelte` (Kalender) — **Details-Knopf** (öffnet Aktivität) + **Bearbeiten-Knopf** (Erledigt/Auslassen/Verschieben/Zurücksetzen/Muskelgruppen).
- `SportIcon.svelte`, `RouteThumb.svelte` (Karte+Route), `MuscleGrid.svelte`, `Plan.svelte` (Urlaub&feste Termine mit optionalem Sport), `Mehr.svelte` (Datenquelle, Sportarten (`SportSettings.svelte`), Kraft-Split 0–6, Garmin, Backup, Lizenzen inkl. OSM/Material).

## Wichtige Muster / Fallstricke
- JSON-Clone vor IndexedDB-`put` (Svelte-Proxys → DataCloneError). `$state.snapshot`/`$state.raw` wo nötig.
- liveQuery mit wechselnden Params: `$effect` + `liveQuery(...).subscribe`, nicht `$derived(liveQuery)`.
- Prop nie `state` nennen (kollidiert mit `$state`).
- iOS standalone: Layout-Viewport ~59pt kurz → Höhe aus `--app-h` (screen.height), `src/core/viewport.ts`.
- Datumsfelder iOS: `appearance:none`, volle Breite im Raster (`src/app.css`).
- null ≠ 0 für fehlende Werte; manuelle Werte haben Vorrang vor Sync.
- Nach jedem Schema-Change: DB-`version()`-Upgrade **und** backup.ts migrate()/BACKUP_TABLES anpassen, Roundtrip prüfen.

## Testing (kein CI für Tests)
- Build: `npx tsc --noEmit -p .` und `npx vite build` (grep "built in").
- Playwright (Chromium `/opt/pw-browsers/chromium`) im Scratchpad, lokaler Static-Server auf `dist/`, intervals.icu/OSM/OFF-Routen gemockt. Screenshots zur Sichtprüfung (hell+dunkel).
- tsx für Unit-Tests der Planer-/Domänenlogik.
- Workflow je Feature: `git pull` → implementieren → tsc+build → Playwright/tsx → ggf. Backup-Roundtrip → commit (Attribution unten) → push → Deploy abwarten → kurz auf Deutsch berichten.

## Commit-Attribution (aktuell gültig)
```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FYUjpYrdbBXdgCdjAketx2
```
(Hinweis: Session-Link stammt aus diesem Chat; im neuen Chat die dort genannte Attribution verwenden.)

## Implementierungsstand
Alles unten ist umgesetzt, getestet und deployed:
- intervals.icu-Anbindung, Historie-Import, Ampel/Load, Morgenwerte/Gewicht, Kraft-Split (0–6×, Split PPL/OU/GK/PPA, Beintage mit Abstand), Statistik (Muskel-Raster, Gewicht-Tageslinie, Bestzeiten+Prognose), Ernährung (BLS/OFF, Barcode, Rezepte, „wie gestern"/Vorlagen, Makroziele), Verletzungsmodus (Kraft bleibt), Urlaub+Fixtermine zusammengelegt (optionaler fester Sport), Planer inkl. Trailrun/Triathlon, Garmin-Workout-Push, Mehrsportarten (Laufen/Rad/Schwimmen je 0–5×, Grundlage/Leistung, Hauptsportart), Physio-gestützter Stufenaufstieg (assistiert), Backup/Import mit Roundtrip, Sport-Icons (Material/Glas), Aktivitätsliste (6 Monate nach Monat, Fakten je Sportart, Routen-/Kartenvorschau), Kalender Details/Bearbeiten, Auto-Zuordnung der Kraft-Muskelgruppe beim Abgleich.

## Offene Punkte / mögliche nächste Schritte
- Update 1 (Mehrsportarten + Physio) ist umgesetzt → Jakob soll prüfen: Sportarten in Mehr, Wochenplan-Verteilung, und ob seine Garmin-Physio-Aktivität erkannt wird (Name muss „Physio“/„Reha“ enthalten; sonst in der Aktivität „Als Physio-Einheit bewerten“).
- Früherer Fix (5b1e05e): Garmin-Krafttraining bekommt beim Abgleich automatisch die nächste Split-Gruppe.
- Bekannte Unsicherheiten, die nur am echten iPhone verifizierbar sind: Kamera-Barcode; ob OSM-Kacheln im iOS-WebView/standalone laden und der Dunkel-Filter gut aussieht; ob Garmin die gepushten Workouts auf die Uhr übernimmt (intervals.icu → Einstellungen → Garmin, „geplante Workouts hochladen").
- OSM-Kachelpolitik: für Einzelnutzung ok; falls je „zu viele Anfragen"/Blockierung → auf einen kostenlosen Tile-Anbieter mit Key (z. B. MapTiler/Stadia) umstellen, Key wie den intervals-Key lokal speichern.

## Separate Projekte des Nutzers (NICHT Basislager, eigene Repos)
Nur zur Abgrenzung: Navigations-/Stadtführer-App (geplant), Spiele-Tracker (JGHosting/Spiele-Tracker). Gehören nicht hierher.
