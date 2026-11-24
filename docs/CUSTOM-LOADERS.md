# Eigene Loader (experimentell)

Stand 2026-11-24. Der Launcher kann einen Mod-Loader als ZIP-Pack importieren und Instanzen damit erstellen. Das
Feature ist für Entwickler und Tests gedacht und steckt hinter einem Schalter:
**Einstellungen → Spiel → Experimentell → „Eigene Loader (experimentell)“** (`settings.custom_loaders`, Standard
`false`).

- **Aus:** Verwaltung und Auswahl im Erstellen-Dialog sind verborgen. Import und neue Instanzen lehnt das Backend ab.
  Vorhandene Instanzen mit eigenem Loader starten trotzdem weiter.
- **An:** Unter dem Schalter liegt die Verwaltung (Liste, Import, Löschen). Im Erstellen-Dialog stehen die
  importierten Packs unter den eingebauten Loadern.

Der Launcher liefert **kein** Loader-Pack mit.

## Pack-Format

Eine ZIP-Datei mit der Endung `.vibeloader` oder `.zip`. Im obersten Ordner liegt `vibeloader.json`:

```json
{
  "format": "vibe-launcher-loader",
  "version": 1,
  "id": "example",
  "name": "Example Loader",
  "loader_version": "0.1.0",
  "description": "Ein erfundener Loader als Beispiel.",
  "author": "Example Studio",
  "homepage": "https://example.com/loader",
  "icon": "icon.png",
  "minecraft": ["26.3", "26.2"],
  "mods": "fabric",
  "profile": {
    "mainClass": "com.example.loader.Main",
    "arguments": { "jvm": ["-Dexample.flag=true"], "game": [] },
    "libraries": [
      { "name": "com.example:example-loader:0.1.0", "file": "libraries/example-loader-0.1.0.jar" },
      {
        "name": "org.ow2.asm:asm:9.7",
        "url": "https://repo1.maven.org/maven2/org/ow2/asm/asm/9.7/asm-9.7.jar",
        "sha1": "<40 Hex-Zeichen>",
        "size": 125428
      }
    ]
  }
}
```

Passendes ZIP:

```
example-loader-0.1.0.vibeloader
├── vibeloader.json
├── icon.png
└── libraries/
    └── example-loader-0.1.0.jar
```

### Felder

| Feld | Pflicht | Regel |
|---|---|---|
| `format` | ja | genau `"vibe-launcher-loader"` |
| `version` | ja | `1` (andere Versionen werden abgelehnt) |
| `id` | ja | `^[a-z0-9][a-z0-9-]{1,31}$` |
| `name` | ja | 1–40 Zeichen, keine Steuerzeichen |
| `loader_version` | ja | `^[A-Za-z0-9._+-]{1,40}$` |
| `description` | nein | höchstens 300 Zeichen |
| `author` | nein | höchstens 60 Zeichen |
| `homepage` | nein | nur `https://` |
| `icon` | nein | Pfad zu einer PNG-Datei im ZIP, höchstens 512 KB |
| `minecraft` | ja | nicht leer, Versions-IDs (`1.21.4`, `26.3`, `24w14a` …), höchstens 200; Doppelte werden zusammengefasst |
| `mods` | ja | `fabric` · `quilt` · `forge` · `neoforge` · `vanilla` |
| `profile.mainClass` | ja | gültiger Java-Klassenname (`a.b.C`, `C$Inner`) |
| `profile.arguments` | nein | `jvm` und `game`, je eine Liste aus **einfachen Strings** (keine Mojang-Regel-Objekte), zusammen höchstens 200 |
| `profile.libraries` | ja | höchstens 500 Einträge (siehe unten) |

`mods` sagt, welche Mods die Instanz verwenden kann. Damit laufen Modsuche, Modrinth/CurseForge-Filter,
Abhängigkeitsprüfung und Mod-Sets so, als wäre die Instanz eine Instanz dieses Loaders.

### Bibliotheken

- `name` ist eine Maven-Koordinate `group:artifact:version[:classifier]` (ohne `@ext`). Der Ablagepfad wird daraus
  abgeleitet, z. B. `com/example/example-loader/0.1.0/example-loader-0.1.0.jar`.
- Jeder Eintrag hat **genau eins** von:
  - `file`: ein `.jar`-Eintrag im ZIP. Der Launcher berechnet SHA-1 und Größe beim Import selbst. Angaben im Manifest
    werden dabei überschrieben.
  - `url`: nur `https://`, dazu Pflichtfelder `sha1` (40 Hex-Zeichen) und `size` (Bytes, größer als 0).
- Doppelte Koordinaten oder Koordinaten mit gleichem Pfad werden abgelehnt.
- Bibliotheken des Packs überschreiben Vanilla-Bibliotheken mit gleichem `group:artifact[:classifier]`, wie bei
  Fabric oder Forge.

## Grenzen und ZIP-Schutz

| Grenze | Wert |
|---|---|
| Einträge im ZIP | höchstens 1000 |
| Pack entpackt | höchstens 300 MB (Summe der Größen; beim Lesen zusätzlich begrenzt) |
| `vibeloader.json` | höchstens 1 MB |
| Icon | nur PNG (Signatur wird geprüft), höchstens 512 KB |

- Alle Pfade im ZIP müssen normalisierte relative Pfade sein: kein `..`, kein `.`, kein führender `/`, kein `\`, kein
  Laufwerk (`C:`), keine leeren Abschnitte, keine Symlinks. Ein einziger solcher Eintrag lehnt das ganze Pack ab.
- Eine Datei darf nicht doppelt im ZIP stehen. Stimmt die tatsächliche Größe nicht mit dem ZIP-Verzeichnis überein,
  gilt der Eintrag als beschädigt.
- Fehler kommen als Code mit Parametern ans Frontend (`cl.err.<code>` in `src/i18n/customloaders.ts`) und zusätzlich
  als deutsche Meldung. Die Codes stehen in `src-tauri/src/custom_loader/validate.rs` und `pack.rs`.

## Ablage

```
<daten>/loaders/<id>/<loader_version>/
├── vibeloader.json      normalisiert: file -> "libraries/<maven-pfad>", sha1/size berechnet, icon -> "icon.png"
├── icon.png             falls vorhanden
└── libraries/<maven-pfad>
```

- Der Import entpackt erst in einen versteckten Ordner `<daten>/loaders/.tmp-…` und benennt ihn am Ende um. Ein
  kaputtes Pack hinterlässt nichts.
- Gibt es dieselbe `id` und `loader_version` schon, fragt der Import-Dialog „Ersetzen?“. Erst danach wird ersetzt.
- Mehrere Versionen derselben `id` liegen nebeneinander. Im Erstellen-Dialog wählt man dann die Version.
- Löschen wird abgelehnt, solange Instanzen das Pack benutzen. Die Meldung nennt die Zahl der Instanzen.

## Instanzen

`instance.json` bekommt das optionale Feld `custom_loader`. Ältere Dateien ohne das Feld bleiben gültig, und es wird
nur geschrieben, wenn es gesetzt ist.

```json
{ "loader": { "kind": "fabric", "version": "0.1.0" }, "custom_loader": { "id": "example", "version": "0.1.0" } }
```

- `loader.kind` ist der `mods`-Wert des Packs, `loader.version` die `loader_version` des Packs. Für diese Instanzen
  holt der Launcher **keine** Standard-Loader-Version aus dem Netz.
- **Installation (Schritt 4):** Statt Fabric/Forge kopiert der Launcher die JARs des Packs mit SHA-1-Prüfung nach
  `meta/libraries/<maven-pfad>` und schreibt `meta/versions/<vid>/<vid>.json` mit
  `vid = "vibe-<id>-<loader_version>-<mc>"`, `inheritsFrom: <mc>`, `mainClass`, `arguments` und `libraries` im
  Mojang-Format (`downloads.artifact` mit `path`, `sha1`, `size`; `url` leer bei Dateien aus dem Pack). Danach greift
  der normale Weg: `load_chain`, Download der `url`-Bibliotheken, Natives, `link_client_jar`.
- **Schnellstart:** `loader_ready` erkennt die `vid`. Bibliotheken mit leerer `url` gelten nur als vorhanden, wenn
  die Datei existiert.
- Fehlt das Pack oder unterstützt es die Minecraft-Version nicht, bricht die Installation mit einer klaren Meldung ab.
- Ändert eine andere Funktion den Loader der Instanz (Versionswechsel, Modpack-Update), wird `custom_loader`
  entfernt. Die Instanz nutzt dann den eingebauten Loader.
- Anzeige: Karten, Liste, Startseite, Kopfzeile und Instanz-Einstellungen zeigen Pack-Name, Version und Icon.

## Verhalten anderer Funktionen

| Stelle | Entscheidung |
|---|---|
| Probleme beheben / Loaderfix | Keine Aktionen „Loader umstellen/reparieren“. `loaderfix::inspect`/`loader_needs` liefern nichts, `SetLoader`/`RepairLoader` werden abgelehnt, „Rückgängig“ setzt keinen Loader zurück. |
| Abhängigkeitsprüfung | Versionsbereiche für `fabricloader`/`forge` usw. werden nicht gegen die Pack-Version geprüft. Die Prüfung von Mods, Minecraft-Version und Mod-Loader-Art läuft normal mit `mods`. |
| Loader-Update-Hinweise | Aus (sie kommen nur aus „Probleme beheben“). |
| Modpack-Export (mrpack, CurseForge, vlpack) | **Blockiert** mit Hinweis im Dialog und Fehler im Backend: Andere Launcher kennen den Loader nicht, und die Pack-Version ist keine gültige Fabric-/Forge-Version. |
| Pack teilen (Vibe) | **Blockiert**, denn es baut auf dem vlpack-Export auf. |
| Server-Pack aus der Instanz | **Blockiert**: Das Pack enthält nur ein Client-Profil. |
| Server aus Instanz erstellen | **Blockiert**, aus demselben Grund. |
| Play-Links / `.vibe/instance.json` | Ehrlich als `mods`-Loader **ohne** Loader-Version (`"loader": { "kind": "fabric", "version": null }`). Wer beitritt, bekommt eine normale Instanz dieses Loaders. Eingehende Links werden nie automatisch einer Instanz mit eigenem Loader zugeordnet. |
| Crash-Diagnose | Bekommt die Art aus `mods` für die Regeln, aber keine Loader-Version. Jede Diagnose trägt `params.custom_loader` mit Pack-Name und Version. Bei Loader-nahen Ursachen nennt der Text den eigenen Loader. |
| Class Data Sharing (CDS) | Aus für Instanzen mit eigenem Loader. |
| Feedback-Bericht | Enthält zusätzlich `custom_loader` (id + Version). |

## Sicherheit

Ein eigener Loader ist beliebiger Java-Code. Er läuft mit denselben Rechten wie der Launcher und das Spiel. Der
Import-Dialog zeigt deshalb vor dem Speichern alles, was das Pack tut:

- Name, Version, Autor, Beschreibung, Homepage, MC-Versionen und Mods-Art,
- Zahl und Größe der Bibliotheken und jede Remote-URL,
- `mainClass` und JVM-Argumente,
- einen deutlichen Warnhinweis: **Nur Packs aus vertrauenswürdiger Quelle installieren.**

Die Prüfungen oben schützen den Launcher vor kaputten oder bösartigen ZIP-Dateien, also vor Path Traversal,
ZIP-Bomben und falschen Größen. Sie schützen **nicht** vor bösartigem Code im Loader selbst.

## Code

- Backend: `src-tauri/src/custom_loader/` (`validate.rs` Regeln, `pack.rs` ZIP-Lesen/Vorschau, `store.rs` Ablage,
  `install.rs` Versions-JSON, `guard.rs` Sperren, `commands.rs` Tauri-Befehle `custom_loader_inspect`,
  `custom_loader_import`, `custom_loaders_list`, `custom_loader_delete`), Tests in `custom_loader/tests/`.
- Frontend: `src/features/customloaders/` (Einstellungskarte, Import-Dialog, Auswahl im Erstellen-Dialog, Anzeige).
- Mock für visuelle Tests: `localStorage["vl.mock.customloaders"]` = `1` (Packs und eine Beispiel-Instanz),
  `empty` (Schalter an, keine Packs), `replace` (Import fragt „Ersetzen?“), `invalid` (Import meldet einen
  unzulässigen Pfad).
