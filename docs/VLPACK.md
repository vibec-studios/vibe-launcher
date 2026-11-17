# `.vlpack` – Modpack-Format des Vibe Launchers

Ein `.vlpack` ist ein ZIP-Archiv. Es enthält eine Beschreibung `vlpack.json`, optional ein Icon und einen
Ordner `overrides/`, dessen Inhalt 1:1 in den Spielordner (`.minecraft`) der neuen Instanz kopiert wird.
Dateien mit bekannter Herkunft (Modrinth, CurseForge, beliebige URL) werden nicht eingebettet, sondern beim
Import heruntergeladen und per SHA-1 geprüft.

```
mein-pack.vlpack
├─ vlpack.json
├─ icon.png            (optional, Name steht in vlpack.json → "icon")
└─ overrides/
   ├─ config/…
   ├─ options.txt
   └─ mods/eigener-mod.jar
```

## `vlpack.json`

```json
{
  "format_version": 1,
  "name": "Mein Pack",
  "version": "1.0.0",
  "author": "Vibe Craft Studios",
  "description": "Kurzbeschreibung",
  "mc_version": "1.20.1",
  "loader": { "kind": "fabric", "version": "0.16.9" },
  "icon": "icon.png",
  "files": [
    {
      "path": "mods/sodium-fabric-0.5.13+mc1.20.1.jar",
      "source": "modrinth",
      "project_id": "AANobbMI",
      "version_id": "OihdIimA",
      "url": "https://cdn.modrinth.com/data/AANobbMI/versions/OihdIimA/sodium-fabric-0.5.13%2Bmc1.20.1.jar",
      "sha1": "…",
      "size": 965275
    },
    {
      "path": "mods/jei-1.20.1-forge-15.20.0.106.jar",
      "source": "curseforge",
      "project_id": "238222",
      "file_id": "6075247",
      "url": "https://edge.forgecdn.net/files/…/jei-1.20.1-forge-15.20.0.106.jar",
      "sha1": "…",
      "size": 1291637
    },
    { "path": "config/extra.json", "source": "url", "url": "https://example.com/extra.json", "sha1": null, "size": null }
  ]
}
```

| Feld | Pflicht | Bedeutung |
|---|---|---|
| `format_version` | ja | Aktuell `1`. Höhere Versionen lehnt der Launcher mit Hinweis auf ein Update ab. |
| `name` | ja | Name der Instanz |
| `version`, `author`, `description` | nein | Anzeige |
| `mc_version` | ja | Minecraft-Version |
| `loader.kind` | ja | `vanilla`, `fabric`, `quilt`, `forge`, `neoforge` |
| `loader.version` | nein | Loader-Version; fehlt sie, wählt die Installation die empfohlene |
| `icon` | nein | Pfad des Icons im Archiv (PNG/JPEG/GIF/WEBP) |
| `files[].path` | ja | Zielpfad relativ zum Spielordner, `/` als Trenner. `..`, absolute Pfade und Laufwerksangaben sind verboten (Import bricht ab). |
| `files[].source` | ja | `modrinth`, `curseforge` oder `url` |
| `files[].project_id` | bei modrinth/curseforge | Projekt-ID der Plattform |
| `files[].version_id` / `files[].file_id` | bei modrinth / curseforge | Modrinth-Versions-ID bzw. CurseForge-Datei-ID |
| `files[].url` | ja | Direkter Download |
| `files[].sha1` | empfohlen | Prüfsumme; Abweichung = Import schlägt fehl |
| `files[].size` | nein | Dateigröße in Bytes (Fortschrittsanzeige) |

Projekt-/Versions-IDs werden beim Import in `instances/<id>/content.json` übernommen, damit Updates und
spätere Exporte die Dateien wiedererkennen.

## Export

`export_instance` mit `format: "vlpack"` schreibt Dateien mit bekannter Herkunft (Modrinth immer, CurseForge
nur mit Download-URL) als `files`-Einträge, alles andere (eigene Mods, deaktivierte `.disabled`-Dateien,
Konfiguration, Ordner-Resourcepacks …) unter `overrides/`. Das Instanz-Icon wird als `icon.png` mitgenommen.
