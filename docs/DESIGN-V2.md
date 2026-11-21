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

Geprüft (Skript, alle Flächen canvas/s1/s2): Text 1–3, Status ok/warn/danger als Schrift, Akzent als Schrift und
Schrift auf Akzent jeweils ≥ 4,5:1, in v1 und v2.

## Mock

- `localStorage vl.mock.design = v2` – v2 im Mock
- `localStorage vl.mock.theme = light|midnight|ocean|forest|sunset|sakura|nether|end|retro|contrast|winter|graphite`
- `window.__VL_MOCK_APPEARANCE = { tone: "light", radius: "round", sidebar: {…}, … }` per Init-Skript
- weitere Schalter wie bisher: `vl.mock.mode = simple`, `vl.mock.onboarding = 1`, `vl.mock.isx = 0` (ohne
  Einstellungs-Import-Hinweis), `vl.mock.notices = 1`, `vl.mock.many`

## Bekannte Lücken

- MOTD-Vorschau nutzt Minecraft-Farben (für dunklen Grund gedacht).
- Standard/Winter/Graphit behalten in v1 ihren bisherigen, schwächeren Tertiärtext (v1 bleibt unverändert);
  v2 hebt ihn an.
- Cosmetics: Kategorie-Leiste scrollt bei 1280 px in v2 seitlich (gewollter Scroll-Streifen, wie v1 bei
  schmaleren Fenstern).
