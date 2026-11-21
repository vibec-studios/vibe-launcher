# Weltkarte aus Xaero's World Map und JourneyMap

Die Weltvorschau kann neben den Welt-Dateien auch die Kartendaten beliebter Karten-Mods zeigen. Das lohnt sich vor allem für Server, auf denen es keine Welt-Dateien gibt, und für große Gebiete, die du schon erkundet hast.

## Wo es auftaucht

- **Welten-Tab:** In der Weltvorschau wählst du oben die **Quelle** (Welt-Dateien, Xaero's World Map, JourneyMap) und die **Dimension** (Oberwelt, Nether, Ende). Quellen erscheinen nur, wenn Daten für genau diese Welt existieren.
- **Server-Tab:** Gibt es Mod-Kartendaten für einen Server, erscheint neben dem Eintrag ein Kartensymbol und im Menü **Karte ansehen**.
- Fehlen Xaero-Daten, zeigt der Launcher einen kurzen Hinweis mit **Installieren**. Der Knopf installiert Xaero's World Map über die normale Inhalte-Installation (Modrinth `NcUtCpym`). Bei Vanilla-Instanzen weist der Hinweis auf den nötigen Mod-Loader hin.

Die Karte lässt sich ziehen, mit dem Mausrad oder den Knöpfen zoomen und mit dem Fadenkreuz zurücksetzen. Mit der Tastatur gehen Pfeiltasten, `+`, `-` und `0`. Unten links steht die Blockkoordinate unter dem Mauszeiger.

## Gelesene Daten (nur lesend)

| Mod | Ordner in der Instanz | Inhalt |
| --- | --- | --- |
| Xaero's World Map | `xaero/world-map/<Welt>/<Dimension>/<mw$…>/<x>_<z>.zip`, älter `XaeroWorldMap/…` | Regionen à 512 × 512 Blöcke |
| Xaero's Minimap | `xaero/minimap/<Welt>/dim%<n>/<mw$…>_<n>.txt`, älter `XaeroWaypoints/…` | Wegpunkte mit Name, Kürzel, Farbe |
| JourneyMap | `journeymap/data/sp|mp/<Welt>/<Dimension>/day/<x>,<z>.png` | PNG-Kacheln à 512 × 512 Blöcke |

- Welt-Ordner: Einzelspieler nutzt den Namen des Speicherordners, Server `Multiplayer_<Adresse>` (Xaero) bzw. den Servernamen (JourneyMap). Der Launcher ordnet Server über Adresse mit und ohne Port, Hauptdomain und Servernamen aus `servers.dat` zu.
- Dimensionen: Xaero `null`/`DIM0`, `DIM-1`, `DIM1` und `namespace$pfad`, JourneyMap `overworld`, `the_nether`, `the_end`, `minecraft~…` oder `DIM…`.
- Mehrere Unterwelten (`mw$…`): Der Launcher nimmt die zuletzt geänderte. Hat eine Dimension nur Höhlenebenen (`caves/<n>`), zeigt er die Ebene mit den meisten Regionen und sagt das unter der Karte.
- Wegpunkte: Deaktivierte Wegpunkte werden ausgeblendet, Todespunkte bekommen ein Kreuz. Bei Einzelspieler-Welten erscheinen sie auch auf der Karte aus den Welt-Dateien.

## Xaero-Regionsformat

`region.xaero` in der ZIP ist ein Big-Endian-Strom: optional `0xFF` + `int` Version (`major << 16 | minor`), danach bis Dateiende Kachel-Abschnitte (`(cx << 4) | cz`, 4 × 4 Kacheln, je 16 × 16 Pixel oder `-1` für leer). Pro Pixel liest der Launcher Blockzustand (Palette mit NBT-`Name`, ab Major 8 `id`), Höhe, Überlagerungen wie Wasser und Biom. Unterstützt werden alle Versionen bis 8.8, also bis Minecraft 26.3, auch Dateien ohne Versionskopf (sehr alte Mod-Versionen mit numerischen Block-IDs). Neuere oder kaputte Dateien werden übersprungen und bleiben auf der Karte leer, ohne Fehler. Die Farben kommen aus derselben Blockfarbtabelle wie die Welt-Vorschau, mit einfacher Biomtönung für Gras, Laub und Wasser und Höhenschattierung.

Das Format folgt dem MIT-lizenzierten Leser von [xaerotools](https://github.com/dekrom/xaerotools). Der Code wurde nicht kopiert, sondern neu geschrieben.

## Leistung und Sicherheit

- Die Übersicht listet nur Dateinamen (höchstens 40 000 Regionen). Kacheln lädt die Ansicht erst, wenn sie sichtbar sind, nach Nähe zur Mitte und höchstens zwei gleichzeitig.
- Je nach Zoomstufe holt sie 512, 256, 128 oder 64 Pixel große Kacheln. Beim ersten Lesen einer Region entstehen alle Stufen und landen in `cache/world-map/<Ebene>/`. Eine `.stamp`-Datei mit Größe und Änderungszeit der Quelldatei macht den Cache ungültig, sobald die Mod die Region neu schreibt.
- Schließt du die Ansicht, bricht `world_map_cancel` die Sitzung ab. Laufende Kacheln stoppen zwischen den Abschnitten.
- Grenzen: ZIP ≤ 96 MB, entpackter Strom ≤ 64 MB, JourneyMap-PNG ≤ 2048 px. Alle Pfade bleiben innerhalb des Instanzordners. Quell- und Ebenen-IDs aus dem Frontend werden geprüft.
- Mod-Daten und Welten werden nie verändert.

## Befehle

`world_map_sources`, `world_map_overview`, `world_map_tile`, `world_map_waypoints`, `world_map_cancel`. `world_preview_render` hat zusätzlich den optionalen Parameter `dimension`. Liegt der gewählte Mittelpunkt in einer anderen Dimension, rechnet der Launcher die Koordinaten um (Nether ÷ 8, Ende 0/0). Alle Befehle haben Mock-Handler in `src/dev/mock/world-map.ts`.

## Tests

`cargo test --lib world_map` prüft synthetische Regionen der Versionen 7.8 und 8.8 (Palette, Biom, Wasser-Überlagerung, Luft, Höhe), alte Dateien ohne Versionskopf, unbekannte Versionen, abgeschnittene und verrauschte Daten, Abbruch, Wegpunkte, Server-Zuordnung, Pfadprüfung, Cache und JourneyMap-Kacheln. Alles läuft auf Kopien im Temp-Ordner und prüft, dass sich keine Quelldatei ändert.

Den optionalen Test `world_map_renders_fixture_copies` startest du mit `VIBE_WORLD_MAP_FIXTURES=<Temp-Ordner mit Kopien von .zip-Regionen oder JourneyMap-PNGs>` und optional `VIBE_WORLD_MAP_OUT=<Ausgabeordner>`. Mit den öffentlichen Beispielregionen aus xaerotools (`tests/fixtures`, Versionen 0.4, 0.7 und 8.8 aus Oberwelt und Nether) liefert er plausible Karten.
