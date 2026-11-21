# Weltvorschau für Minecraft Java

Über das Kartensymbol neben einer Welt in der Weltliste öffnest du ihre Vorschau. Sie zeigt Seed, Spielmodus, Spielzeit, gespeicherte Version und Größe. Wenn der letzte Standort bekannt ist, öffnet sich die Karte dort. Mit **Startpunkt der Welt** kannst du den Ausschnitt wechseln.

Die Karte zeigt 128 Blöcke in jede Richtung. Norden liegt oben. Farben und Schattierung orientieren sich am obersten gespeicherten Block und an der Geländehöhe. Fehlendes oder unlesbares Gelände bleibt transparent. Im Nether zeigt die Ansicht von oben in der Regel die Netherdecke.

Mit **Als PNG speichern** exportierst du den 257 × 257 Pixel großen Ausschnitt. Wähle einen neuen Dateinamen außerhalb eines Weltordners. Mit **Bild kopieren** kannst du die Karte zum Beispiel in einen Chat einfügen.

Der Launcher liest die Anvil-Dateien der Welt und legt PNGs im Launcher-Cache unter `cache/world-preview` ab. Der Cache berücksichtigt den Kartenmittelpunkt und Änderungen an den betroffenen Regionsdateien. Du kannst die Kartenerstellung über **Abbrechen** oder durch Schließen der Vorschau stoppen. Fehlende Metadaten erscheinen als **Unbekannt**. Spielzeit stammt aus der zuordenbaren Minecraft-Spielerstatistik.

Der Renderer unterstützt klassische und neuere Anvil-Abschnittsformate, auch Blockpaletten als reine Namensliste wie in Java 26.3, sowie gzip-, zlib- und unkomprimierte Chunks. Chunks mit anderen Kompressionsarten bleiben transparent. Blöcke ohne bekannte Farbe erscheinen in einem neutralen Farbton. Für Java 26.1 berücksichtigt die Vorschau auch die neue Verzeichnisstruktur. [Mojangs Datenformat für Java 1.18](https://www.minecraft.net/de-de/article/caves---cliffs--part-ii-out-today-java) · [Mojangs Speicherstruktur für Java 26.1](https://www.minecraft.net/sv-se/article/minecraft-java-edition-26-1)

Die gezielten Rust-Tests erstellen temporäre Kopien synthetischer Welten. Der optionale Test `world_preview_renders_world_copies` rendert jede Welt in einem `saves`-Ordner unterhalb des Temp-Verzeichnisses für Startpunkt und letzten Standort, prüft den Cache und stellt sicher, dass keine Weltdatei verändert wurde. Setze `VIBE_WORLD_PREVIEW_FIXTURE_SAVES` auf diesen `saves`-Ordner und optional `VIBE_WORLD_PREVIEW_OUT` auf einen Ordner für die PNGs. Lege dort nur Kopien ab, zum Beispiel eigene Welten oder die [Java-1.18-Testwelt von Amulet](https://github.com/Amulet-Team/Amulet-Core/tree/master/tests/data/worlds_src/java/vanilla/1_18/vanilla).

Die Karte lässt sich ziehen und zoomen. Unter **Dimension** wechselst du zwischen Oberwelt, Nether und Ende. Liegt der gewählte Mittelpunkt in einer anderen Dimension, rechnet die Vorschau die Koordinaten um. Kartendaten von Xaero's World Map und JourneyMap sowie Xaero-Wegpunkte beschreibt [world-map-mods.md](world-map-mods.md).
