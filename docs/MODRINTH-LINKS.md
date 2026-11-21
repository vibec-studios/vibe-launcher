# `modrinth://`-Links und „In Vibe öffnen“

## Was der Nutzer sieht

- **Einstellungen → Allgemein → „Links aus dem Browser“ (auch im einfachen Modus sichtbar)**: Schalter „Modrinth-Links mit Vibe öffnen“.
  Danach öffnet der „Installieren“-Knopf auf modrinth.com Vibe. Die Karte zeigt, welches Programm gerade zuständig ist
  (z. B. „Modrinth App“). Beim Ausschalten bekommt dieses Programm die Links zurück.
- **„Link in Vibe öffnen“**: Feld in derselben Karte; außerdem erkennt die Suche in „Entdecken“ eingefügte
  modrinth.com-Links und bietet „In Vibe öffnen“ an.
- Jeder Link öffnet zuerst den Bestätigungsdialog (`ActionHost`): Projekt, Art (Mod, Modpack …), ggf. Version und was
  als Nächstes passiert. „Weiter“ öffnet den normalen Installationsdialog, in dem die Instanz gewählt wird
  (Modpacks: als neue Instanz). Ohne Bestätigung wird nichts installiert.

## Unterstützte Links

| Link | Aktion |
|---|---|
| `modrinth://mod/<slug\|id>` (auch `modpack`, `resourcepack`, `shader`, `datapack`, `plugin`, `project`) | `install` |
| `modrinth://mod/<slug>/version/<versions-id>` | `install` mit Version |
| `modrinth://version/<versions-id>` | `install_version` (Projekt wird über `content_version_project` ermittelt) |
| `https://modrinth.com/<typ>/<slug>[/…]` | `install` (Version nur bei 8-stelliger ID) |

Parser: `src-tauri/src/platform/mrlinks.rs` (in `links::parse_url` eingehängt, Tests dort).

## Registrierung (nur Windows)

`src-tauri/src/platform/mrscheme/`. Das Schema wird **nicht** vom Installer registriert, sondern erst, wenn der
Nutzer den Schalter einschaltet (sonst würde Vibe der Modrinth App ungefragt die Links wegnehmen).

- Einschalten: vorhandene Werte unter `HKCU\Software\Classes\modrinth` werden in `<Datenordner>/modrinth-links.json`
  gesichert, dann wird `"<vibe.exe>" "%1"` eingetragen.
- Ausschalten: gesicherte Werte zurückschreiben bzw. den eigenen Schlüssel löschen (ein HKLM-Eintrag der Modrinth App
  greift dann wieder).
- Start: Hat sich nur der Programmpfad von Vibe geändert, wird der Eintrag erneuert.
- Debug-Builds und `VIBE_LAUNCHER_HOME` schreiben nach `HKCU\Software\VibeLauncherTest\Classes\modrinth`
  (wirkungslos für Windows), damit Tests die echte Zuordnung nicht verändern.
- Weiterleitung an die laufende Instanz: der Single-Instance-Callback in `lib.rs` liest `modrinth:`-Argumente
  (`mrlinks::from_args`), da das Deep-Link-Plugin dynamische Schemata nicht selbst verarbeitet. Kaltstart über
  `links::parse_args`.

## Commands

`modrinth_links_status`, `modrinth_links_set(enabled)`, `app_link_parse(url)`, `content_version_project(versionId)`
(`src-tauri/src/commands/links.rs`). Mock: `src/dev/mock/packupdate.ts`.
