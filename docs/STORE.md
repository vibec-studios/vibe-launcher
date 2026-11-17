# Vibe Store v1 – eigene Inhalte-Quellen für den Vibe Launcher

Ein **Store** ist eine einzelne JSON-Datei, die per HTTPS erreichbar ist (z. B. GitHub Pages). Der Launcher lädt
sie, cacht sie (ETag / `If-Modified-Since`, ca. 10 Minuten, zusätzlich auf der Platte für den Offline-Fall) und
bietet die Projekte in „Entdecken“ neben Modrinth und CurseForge an: Suche, Projektseite, Versionen,
Installation inkl. Abhängigkeiten, Updates und Zuordnung bereits installierter Dateien per Hash.

Standard-Store: **Vibe Craft Studios** – `https://vibec-studios.github.io/data/store.json`
(immer in der Liste, kann deaktiviert, aber nicht entfernt werden).

## Aufbau

```jsonc
{
  "format": "vibe-store",            // Pflicht, genau dieser Wert
  "version": 1,                      // Pflicht; höhere Versionen lehnt der Launcher mit Hinweis ab
  "id": "vibe-craft-studios",        // Pflicht, [a-z0-9-], eindeutig; erscheint in der Quelle als "store:<id>"
  "name": "Vibe Craft Studios",      // Pflicht, Anzeigename
  "icon": "https://…/logo.png",      // optional, absolute URL
  "homepage": "https://vibec-studios.github.io/",
  "description": "Mods von Vibe Craft Studios",
  "updated": "2026-11-17T12:00:00Z", // optional, ISO-8601
  "projects": [
    {
      "id": "hh-armors",             // Pflicht, eindeutig im Store
      "slug": "hh-armors",           // optional (Standard: id)
      "title": "H&H Armors",         // Pflicht
      "description": "Kurzbeschreibung (eine Zeile)",
      "author": "Vibe Craft Studios",
      "icon": "https://…/icon.png",
      "project_type": "mod",         // mod | modpack | resourcepack | shader | datapack
      "categories": ["equipment", "adventure"],
      "body": "# Markdown-Beschreibung …",
      "gallery": [{ "url": "https://…/1.png", "title": "Optional", "description": "Optional" }],
      "links": { "website": "…", "source": "…", "issues": "…", "wiki": "…", "discord": "…" },
      "license": "MIT",
      "client_side": "required",     // optional: required | optional | unsupported (wie Modrinth)
      "server_side": "optional",
      "downloads": 1234,             // optional
      "published": "2026-01-01T00:00:00Z",
      "updated": "2026-11-01T00:00:00Z",
      "versions": [
        {
          "id": "hh-armors-1.4.0-fabric-1.21.11",   // Pflicht, eindeutig im Projekt
          "version_number": "1.4.0",
          "name": "H&H Armors 1.4.0 (Fabric 1.21.11)",
          "release_type": "release",                // release | beta | alpha
          "date": "2026-11-01T00:00:00Z",           // Pflicht, ISO-8601 (bestimmt "neueste")
          "game_versions": ["1.21.11"],             // exakte Minecraft-Versionen
          "loaders": ["fabric"],                    // fabric | quilt | forge | neoforge | minecraft | iris | optifine | datapack …
          "changelog": "Markdown, optional",
          "files": [
            {
              "url": "https://github.com/…/hh-armors-1.4.0.jar",
              "filename": "hh-armors-1.4.0.jar",
              "size": 123456,
              "sha1": "…",                          // empfohlen: Prüfung beim Download + Hash-Zuordnung
              "sha256": "…",                        // optional, ebenfalls für die Zuordnung
              "sha512": "…",                        // optional
              "primary": true
            }
          ],
          "dependencies": [
            { "source": "modrinth", "project_id": "P7dR8mSH", "kind": "required" },   // Fabric API
            { "source": "self", "project_id": "vibe-core", "kind": "required" },     // Projekt im selben Store
            { "source": "curseforge", "project_id": "238222", "kind": "optional" }
          ]
        }
      ]
    }
  ]
}
```

### Regeln

- **Eine Version = ein Satz Minecraft-Versionen + Loader.** Gibt es für ein Release mehrere JARs (z. B. eine je
  Minecraft-Version/Loader), wird pro JAR eine eigene Version mit passenden `game_versions`/`loaders` angelegt.
  Der Launcher wählt daraus die neueste kompatible Version (Quilt akzeptiert Fabric, NeoForge 1.20.1 akzeptiert Forge).
- `dependencies[].kind`: `required` (wird mitinstalliert), `optional`, `incompatible`, `embedded`.
  `source`: `modrinth` (Projekt-ID oder Slug), `curseforge` (numerische ID, braucht API-Key), `self` (dieser Store).
- Unbekannte Felder werden ignoriert; fehlende optionale Felder sind erlaubt.
- Der Launcher prüft beim Download `sha1` (falls angegeben). Ohne `sha1`/`sha256` können bereits installierte
  Dateien nicht automatisch dem Store zugeordnet werden.
- In der Quelle eines Inhalts erscheint ein Store als `store:<id>` (z. B. `store:vibe-craft-studios`).

## Eigenen Store hinzufügen

Einstellungen → Stores → URL eingeben. Der Launcher lädt die Datei, prüft `format`/`version`/`id` und übernimmt
Name und Icon aus der Datei. Stores lassen sich an- und ausschalten oder entfernen.
