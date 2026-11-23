# Design v2 (Beta)

Umschaltbar unter Einstellungen → Darstellung → „Design v2 (Beta)“. Gespeichert als `appearance.design`
(`"v1"` Standard, `"v2"`). Wirkt sofort, auch in der Vorschau des Einstellungs-Popups. v1 bleibt Standard, bis v2
ausgereift ist.

## Ausgangslage (v1)

Flach und schwarz: Rahmen (Seitenleiste + Titelleiste) schwarz, Inhaltsfläche eine Stufe heller, Ebenen nur über
minimale Grautöne, eckig, kaum Schatten. Sehr dicht, kleine Schrift (13–13,5 px), Abschnittsüberschriften grau.
Wirkt konsequent, aber auf großen Fenstern leer und auf kleinen gedrängt; Hierarchie entsteht fast nur über
Schriftgewicht.

## Leitidee v2: „ruhige Ebenen“

Modern, ruhig, hochwertig. Weniger Linien, mehr Luft, klare Tiefe in drei Stufen, etwas größere Schrift.

- **Rahmen**: Fensterhintergrund = Rahmenfarbe. Die Inhaltsfläche ist eine schwebende Platte (rundum Abstand 8 px,
  große Ecke, Haarlinie, weicher Schatten). Seitenleiste und Kopfzeile liegen direkt auf dem Rahmen.
- **Tiefe**: e1 Karten (Haarlinie + sehr weicher Schatten), e2 Menüs/Popover, e3 Dialoge (Haarlinie, großer weicher
  Schatten, Hintergrund abgedunkelt und leicht unscharf).
- **Typo**: eigene Skala – Hero 28/1.15, Titel 20/1.25, Abschnitt 15/600 (in Textfarbe statt grau), Text 14/1.5,
  Meta 13, Caption 11.5. Überschriften mit leicht negativer Laufweite.
- **Ecken**: v2 interpretiert die Einstellung „Ecken“ weicher: eckig = 3 px, leicht = 8 px, rund = 14 px.
- **Abstände**: Seiten mit 28 px Rand ab 1600 px Breite, 20 px darunter; Karten-Innenabstand großzügiger.
- **Navigation**: Seitenleiste mit Abschnitten, aktive Einträge als weiche Pille mit Akzent-Markierung links und
  Icon in Akzentfarbe; Instanzen als eigene Liste mit Status-Punkt. Kompakt-Modus: breite Icons-Spalte (68 px).
- **Kopfzeile**: höher (52 px), Seitentitel größer, Werkzeuge in einer gemeinsamen Pillen-Gruppe.
- **Bedienelemente**: Knöpfe mit feiner Lichtkante und Akzent-Schatten (primär), Felder mit Haarlinie und
  Fokus-Halo (3 px Akzent, 35 %), Tabs als Pillen statt Unterstrich, Schalter/Segmente weicher.
- **Listen/Kacheln**: Instanz-Kacheln mit Akzent-Verlauf hinter dem Icon, Hover hebt die Kachel (Haarlinie wird
  Akzent), Zeilen mit weichem Hover.
- **Leerzustände**: Icon in einem weichen Akzent-Kreis, größere Überschrift.
- **Bewegung**: Seitenwechsel steigt 6 px auf (0,2 s), Kacheln heben sich beim Hover. Alles hängt an den
  bestehenden Schaltern (Bewegung normal/mehr, Seitenwechsel, „Animationen reduzieren“, System-Einstellung).

## Architektur

- `data-design="v1|v2"` an `<html>` (gesetzt von `applyAppearance`).
- `src/styles/v2.css`: eigene Token-Ebene (`:root[data-design="v2"]`) und die v2-Regeln für Bausteine. Bausteine in
  `src/components/ui` tragen dafür stabile Haken-Klassen (`vl-btn`, `vl-field`, `vl-tabs`, `vl-dialog` …); die
  Logik bleibt unverändert.
- Eigene v2-Komponenten nur, wo das Layout grundlegend anders ist:
  - `src/app/v2/RailV2.tsx`, `src/app/v2/TopbarV2.tsx` (Shell)
  - `src/features/home/v2/HomeV2.tsx` (Startseite)
  Gemeinsame Daten/Logik liegen in `src/app/nav.tsx` (Navigation, Seitentitel, laufende Spiele) und
  `src/features/home/data.ts` (`useHomeData`).
- Alle Seiten sonst gemeinsam: sie bekommen v2 über Tokens und Bausteine.

## Themes

Themes sind weiterhin Voreinstellungen (Akzent, Ton, Ecken, Kontrast, Karten, Statusfarben) plus Palette per
`data-theme`. Neu: Ton „hell“ (echtes Light-Theme). Paletten entstehen aus Ton-Basis + Theme-Tönung
(`--tint`, `--tint-amt`), dadurch funktioniert jedes Theme mit jedem Ton. Weiß-Utilities (`bg-white/[.06]` …)
folgen der Tinte (`--ink`), damit Hover/Felder auch im hellen Ton sichtbar sind.

Neue Themes: Hell, Mitternacht (OLED), Ozean, Wald, Sonnenuntergang, Sakura (hell), Nether, End, Retro-Pixel,
Hoher Kontrast. Kontraste (WCAG AA für Text auf Flächen, Statusfarben als Text) werden per Skript geprüft.
Saisonal (Winter im Dezember/Januar statt „Standard“) bleibt unverändert.

| Theme | Ton | Akzent | Besonderheit |
| --- | --- | --- | --- |
| Hell | hell | #6a4cf5 | echtes Light-Theme |
| Mitternacht | OLED | #8aa0ff | reines Schwarz, Nachtblau-Tönung |
| Ozean | schwarz | #3cc8ec | Petrol-Tönung, leicht gerundet |
| Wald | schwarz | #7fd36f | Moos-Tönung |
| Sonnenuntergang | schwarz | #ff7aa2 | Pflaumen-Tönung, rund |
| Sakura | hell | #c8346f | rosa getöntes Light-Theme |
| Nether | schwarz | #ff8a3d | Rot-Tönung, eckig |
| End | schwarz | #c39bff | Violett-Tönung, Karten mit Kante, Endstein-Gelb als „ok“ |
| Retro-Pixel | dunkelgrau | #ffd23f | Pixel-Überschriften, Klötzchen-Knöpfe |
| Hoher Kontrast | OLED | #ffd60a | Kontrast hoch, kräftige Linien, gelber Fokus |
| Vibe Pixel | schwarz | #ffb37d | Website-Stil: Nachtlila, Pixel-Karten, Inter Tight, Hintergrund „Pixel-Nacht“ |
| Vibe Pixel hell | hell | #6a4cf5 | warmes Papierweiß, Pixel-Karten, Inter Tight |

Geprüft (Skript, alle Flächen canvas/s1/s2): Text 1–3, Status ok/warn/danger als Schrift, Akzent als Schrift und
Schrift auf Akzent jeweils ≥ 4,5:1, in v1 und v2.

## Vibe Pixel (Website-Stil)

Adaptiert das Pixel-Design von vibe.axolite.app (`apps/web/public/site/pixel.css` im vibe-backend) für die App, nicht 1:1:

- **Farben**: Seitenfarbe Nachtlila `#170e26`, Flächen = Seitenfarbe + 5/9/14 % Weiß, Akzent Pfirsich `#ffb37d` mit dunkler
  Schrift, Status Mint/Gelb/Rosa wie auf der Website. Hell: Papier `#f5f4f1`, Flächen `#fffefc`, Violett `#6a4cf5`.
- **Kartenstil „Pixel“** (`data-cards="pixel"`, mit jedem Theme kombinierbar): alle Radien 0, Kanten 2 px, harte
  Schatten (4–8 px nach unten, ohne Unschärfe), keine Verläufe/Leuchten auf Knöpfen, Overlay ohne Unschärfe.
  Knöpfe als Pixel-Blöcke mit 3-px-Stufe unten (Hover hebt 1 px, Klick drückt), Reiter mit 4-px-Unterkante, gewählte
  Segmente in Akzentfarbe (wie die Filter-Chips der Website), Menüeinträge mit Akzentkante links, aktive Seite in
  der Seitenleiste als Akzentfläche mit 3-px-Kante.
- **Schrift**: Inter Tight (wie Website-Fließtext, `@fontsource-variable/inter-tight`, OFL, lokal gebündelt,
  Dateien werden per `unicode-range` nur bei Bedarf geladen). Pixel-Überschriften wie gehabt; neu „Pixel überall“
  (`data-headings="pixel_all"`) setzt auch Knöpfe, Reiter, Segmente, Karten- und Feldtitel in Silkscreen (Großbuchstaben).
  Bewusst nicht Standard, weil lange deutsche Beschriftungen in Silkscreen sehr breit werden.
- **Hintergrund „Pixel-Nacht“**: statisches SVG (Himmel in Bändern mit Dither-Kante, Sterne, Sonne, drei Hügelreihen),
  aus der Akzentfarbe erzeugt und zwischengespeichert (`src/lib/pixelScene.ts`), kein Canvas, keine Animation.
- Bewusst weggelassen: die animierte Landschaft (scene.js), Jahreszeiten-Farben, Pixelschrift für Fließtext.

## Anpassung (Einstellungen → Darstellung)

| Einstellung | Werte | Attribut/Variable |
| --- | --- | --- |
| Akzentfarbe | Vorschläge (inkl. aller Theme-Akzente), Farbwähler, Hex-Feld | `--ui-accent` |
| Schriftart | Inter, Inter Tight, System, Mono (JetBrains Mono) | `data-font` |
| Überschriften | wie Text, Pixel, Pixel überall | `data-headings` |
| Ecken | eckig, leicht, rund, **eigene** (Regler 0–24 px) | `data-radius="custom"` + `--r-custom` |
| Karten | flach, mit Kante, **erhaben**, **Pixel** | `data-cards` |
| Seitenleiste – Stil | Rahmen, schwebend, getönt | `data-rail` |
| Hintergrund | keiner, **Farbe**, Verlauf (Vorlagen, **Pixel-Nacht**, **eigener** mit 2 Farben + Winkel), Bild, Animiert | `data-bg` |
| Glas-Effekt | 0–100 %, nur mit Hintergrund | `data-glass` + `--glass` |

Im Pixel-Kartenstil sind Ecken immer 0 (der Ecken-Regler ist dann gedimmt). Glas macht Rahmen, Inhaltsfläche,
Karten, Dialoge und Menüs durchscheinend und legt `backdrop-filter` auf Seitenleiste, Inhaltsfläche, Dialoge, Menüs,
Toasts (Standard aus; kostet etwas GPU).

CSS: `src/styles/custom.css` (Anpassungen) und `src/styles/pixel.css` (Vibe Pixel), beide nach `v2.css` geladen.

### Eigene Themes

- „Aktuelle speichern“ legt einen Schnappschuss an (`appearance.custom_themes`, max. 24): Basis-Theme (Palette),
  Akzent, Ton, Ecken (+px), Kontrast, Karten, Überschriften, Schrift, Schriftgröße, Statusfarben, Glas,
  Seitenleisten-Stil, Hintergrund (eigenes Bild nur lokal). Nicht enthalten: Seitenleisten-Reihenfolge, Bibliothek,
  Bewegung, App-Icon, Skalierung.
- Anwenden setzt die Werte und merkt `appearance.active_custom`; weicht die Darstellung danach ab, erscheint
  „Änderungen speichern / Verwerfen“. Umbenennen (Doppelklick oder Menü), Überschreiben, Löschen (mit Rückfrage).
- Teilen: **Code** `VIBE-THEME-1:<base64url(JSON)>` in die Zwischenablage, oder **Datei** `*.vibetheme` (JSON
  `{ "format": "vibe-launcher-theme", "version": 1, "name", "values" }`, Rust-Befehle `appearance_theme_write/read`,
  nur `.vibetheme`/`.json`). Geteilte Themes enthalten nie Bildpfade. Format v2 (Palette, CSS für Parts,
  Deko-Plätze, `VIBE-THEME-2:`) steht in [THEMES.md](THEMES.md).
- Import-Validierung (`src/lib/customThemes.ts`): Format/Version geprüft, jede Aufzählung gegen eine Positivliste,
  Farben nur `#rrggbb`, Zahlen begrenzt, fehlende Felder bekommen Standardwerte, unbekannte Felder werden ignoriert,
  max. 20 000 Zeichen. Ungültig → verständliche Meldung, nichts wird übernommen. Rust bereinigt beim Speichern
  zusätzlich (`settings::theme::sanitize`: gültige/eindeutige Ids, Namen ≤ 40 Zeichen ohne Steuerzeichen, Werte wie
  bei der Darstellung, Video/eigene Animation entfernt, unbekanntes `active_custom` → null).
- „Alles zurücksetzen“ behält die eigenen Themes.

Theme-Wechsel räumt auf: Setzt das vorherige Theme Schrift/Überschriften/Hintergrund (Vibe Pixel, Retro) und das neue
nicht, gehen diese Werte auf Standard zurück, sonst bleiben eigene Werte erhalten.

## Mock

- `localStorage vl.mock.design = v2` – v2 im Mock
- `localStorage vl.mock.theme = pixel|pixel_light|light|midnight|ocean|forest|sunset|sakura|nether|end|retro|contrast|winter|graphite`
  (setzt das Theme wie ein Klick, inkl. Schrift und Pixel-Hintergrund)
- `localStorage vl.mock.custom = 1` – zwei Beispiel-Themes unter „Eigene Themes“ (Pixel-Morgen, Glas Ozean);
  Theme-Dateien schreibt/liest der Mock im Speicher (`src/dev/mock/appearance.ts`)
- `window.__VL_MOCK_APPEARANCE = { tone: "light", radius: "custom", radius_px: 12, cards: "pixel", glass: 60,
  headings: "pixel_all", sidebar: { …, style: "floating" }, background: { …, kind: "color" }, … }` per Init-Skript
- weitere Schalter wie bisher: `vl.mock.mode = simple`, `vl.mock.onboarding = 1`, `vl.mock.isx = 0` (ohne
  Einstellungs-Import-Hinweis), `vl.mock.notices = 1`, `vl.mock.many`

## Bekannte Lücken

- Ton manuell zwischen hell und dunkel wechseln behält Akzent und Statusfarben des Themes; diese sind dann als Schrift
  teils unter AA (gilt für alle Themes, z. B. Hell → Schwarz, Ozean → Hell). In ihrem eigenen Ton bestehen Vibe Pixel
  (auch Dunkelgrau/OLED) und Vibe Pixel hell die Prüfung in v1 und v2.
- Eigene Hintergrundfarben/-verläufe werden nicht auf Kontrast geprüft; die Flächen bleiben deckend genug
  (Inhaltsfläche 55 %, mit Glas weniger) und die Abdunklung wirkt wie bei Bildern.

- MOTD-Vorschau nutzt Minecraft-Farben (für dunklen Grund gedacht).
- Standard/Winter/Graphit behalten in v1 ihren bisherigen, schwächeren Tertiärtext (v1 bleibt unverändert);
  v2 hebt ihn an.
