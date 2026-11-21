# Screenshot-Vergleich (visuelle Regression)

Fotografiert den Launcher im Browser gegen das simulierte Backend (`VITE_MOCK=1`) und vergleicht zwei Stände Pixel für Pixel. Gedacht für Umbauten, die die Optik **nicht** ändern dürfen (Aufteilen von Dateien, Komponenten herauslösen …).

Keine Projekt-Abhängigkeit: `playwright-core` (fest **1.65.1**) wird verwendet, wenn es bereits auflösbar ist, sonst einmalig nach `%LOCALAPPDATA%\vibe-visual\playwright-1.65.1` installiert (anderer Ort: `VIBE_VISUAL_CACHE`). Fehlt der Browser, lädt das Skript `chromium-headless-shell` nach.

## Nutzung

```sh
# 1. Baseline vom unveränderten Stand
node scripts/visual/capture.mjs <baseline-ordner>

# 2. Nach dem Umbau
node scripts/visual/capture.mjs <neu-ordner>

# 3. Vergleichen (Exit 1 bei Unterschieden, HTML-Bericht in <neu-ordner>/report.html)
node scripts/visual/compare.mjs <baseline-ordner> <neu-ordner>
```

`capture.mjs` baut dafür selbst einen Mock-Build in einen Temp-Ordner (`vite build --outDir …`, `dist/` bleibt unberührt), liefert ihn über einen eigenen kleinen HTTP-Server auf `127.0.0.1:<freier Port>` aus und räumt danach alles weg. Es bleibt kein Server oder Browser zurück.

| Option | Bedeutung |
| --- | --- |
| `--dist <ordner>` | Vorhandenen Mock-Build nutzen statt neu zu bauen (`VITE_MOCK=1 pnpm exec vite build --outDir <ordner>`) |
| `--only <regex>` | Nur passende Szenen, z. B. `--only "^instance-"` oder `--only "settings|dialog-install"` |
| `--variants a,b` | Nur diese Varianten (`v1-dark`, `v2-light`, `pixel`) |
| `--jobs <n>` | Parallele Browser-Tabs (Standard 3) |

`compare.mjs`: `--threshold <0-255>` (Abweichung je Farbkanal, ab der ein Pixel als anders gilt, Standard 8), `--max-pixels <n>` (so viele abweichende Pixel je Bild werden toleriert, Standard 20; `--max-pixels 0` für pixelgenau), `--report <datei.html>`.

Ein voller Lauf (3 Varianten × 44 Szenen = 132 Bilder) dauert je nach Last 4–6 Minuten. Für schnelle Zwischenstände `--only` und `--variants` nutzen; vor dem Abschluss einmal komplett.

## Was fotografiert wird

1280 × 720, Deutsch, je Variante **v1 dunkel** (Standard), **v2 hell** (`vl.mock.design=v2`, Theme `light`) und **Vibe Pixel** (Theme `pixel`):

- Seiten: Start, Bibliothek, Entdecken, Mod-Sets, Konten, Skins, Statistik, Galerie, Server, Freunde, Cosmetics, Cosmetics-Creator
- Instanz `survival`: alle 9 Tabs
- Server `survival-smp`: alle 7 Tabs
- Einstellungen: alle 9 Tabs
- Dialoge: Neue Instanz, Import, Installieren (Entdecken → Installieren → „Version und Instanz wählen …“), Skin-Editor, Remote hinzufügen, AFK-Start
- Konsolenfenster (`console.html`) mit laufender Sitzung

Szenen stehen in [`scenes.mjs`](scenes.mjs). Neue Szene: Eintrag mit `name`, `path` (Hash-Route) bzw. `file`, optional `flags` (localStorage-Schalter des Mocks, siehe `src/dev/mock/*`) und `act(ui)` für Klicks (`ui.click(locator)`, `ui.button(name)`, `ui.menuItem(name)`, `ui.dialog()`).

## Warum die Bilder deterministisch sind

- **Uhr:** Playwright-Fake-Uhr, pausiert auf `2026-06-15 10:00` (Europe/Berlin). Timer, `Date`, `performance.now` und `requestAnimationFrame` laufen nur in festen 100-ms-Schritten weiter, und zwar insgesamt immer genau 8 s je Szene. Log-Streams, Server-Start und 3D-Ansichten stehen dadurch bei jedem Lauf am selben Punkt.
- **Zufall:** `Math.random` ist ein fest geseedeter Generator.
- **Animationen:** CSS-Animationen und Übergänge sind auf 1 ms gekürzt, `prefers-reduced-motion: reduce`, Screenshots mit `animations: "disabled"` und ohne Cursor.
- **Netz:** alle Anfragen außer an den lokalen Server werden abgebrochen (keine Modrinth-Bilder o. Ä.).
- **Rendern:** Chromium mit festem Farbprofil, ohne GPU, Subpixel-Schrift und LCD-Text.
- **Mock:** `vl.mock.notices=1`, `vl.mock.isx=0` (keine Hinweis-Popups), `vl.mock.latency=1`.

Zwei Läufe hintereinander ergeben 0 abweichende Pixel. Jede Szene wird so lange erneut fotografiert, bis zwei Aufnahmen gleich sind. Schlägt eine Szene fehl oder bleibt instabil (unter starker Rechnerlast lädt die Seite gelegentlich nicht), wird sie bis zu zweimal in einem frischen Browser-Kontext wiederholt („neuer Versuch“ in der Ausgabe); erst danach steht sie als Fehler bzw. „nicht stabil“ in der Ausgabe und in `manifest.json`.

## Ergebnis lesen

- `<ordner>/<variante>/<szene>.png` und `<ordner>/manifest.json` (Fehler, instabile Szenen, JS-Fehler der Seite)
- `compare.mjs` schreibt `<neu>/_diff/…` (rote Pixel = Unterschied) und `report.html` mit Baseline, Neu und Unterschied nebeneinander
- Exit-Code von `capture.mjs`: 1, wenn eine Szene fehlschlug oder instabil war; von `compare.mjs`: 1 bei Unterschieden, fehlenden oder neuen Bildern
