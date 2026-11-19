# Einstellungen aus anderen Launchern

Beim Import aus einem anderen Launcher (Import-Dialog → „Aus anderem Launcher“) übernimmt Vibe neben dem
Spielordner auch die **Einstellungen der Instanz** im alten Launcher. Code: `src-tauri/src/content/extsettings.rs`
(Auslesen, Vergleichen, Übernehmen), `content/external.rs` (Scan/Import), `content/norisk.rs`;
Frontend: `src/features/import/ExternalImport.tsx`, `SettingsOffer.tsx`, `settingsFormat.ts`.

## Grundregeln

- Fremde Launcher-Ordner werden **nur gelesen**. SQLite-Datenbanken (Modrinth App, NoRisk) werden vorher samt
  `-wal`/`-shm` nach `cache/tmp/` kopiert und nur die Kopie geöffnet (`external::open_db_copy_named`).
- Aus Datenbanken werden **nur benannte Spalten** gelesen (`extsettings::select_rows`, nie `SELECT *`), aus globalen
  Konfigurationsdateien nur eine feste Liste von Schlüsseln (`PRISM_GLOBAL_KEYS`, `atlauncher_global`).
- **Nie gelesen:** `accounts.json` (Prism, ATLauncher, NoRisk), Konto-Tabellen (`minecraft_users`, `modrinth_users`
  der Modrinth App), API-Schlüssel/Proxy-Passwörter der Launcher-Konfiguration.
- **Erbt** eine Instanz einen Wert von den Standard-Einstellungen des alten Launchers, wird der *effektive* Wert
  übernommen (`ExtSettings::inherited`). Entspricht er ohnehin dem Vibe-Standard, wird er nicht je Instanz
  festgeschrieben (`ExtSettings::effective`).
- **Java:** nur ein fest eingestellter Pfad der *Instanz* (die globale Java-Wahl macht jeder Launcher selbst). Vor der
  Übernahme wird geprüft: Datei existiert, startet (`java -version`), Hauptversion passt zur Minecraft-Version
  (< 1.17 → Java 8, 1.17 → 16+, 1.18–1.20.4 → 17+, ab 1.20.5 → 21+). Sonst: automatische Wahl + Hinweis.
- **Start-Befehle** (Pre-Launch, Post-Exit, Wrapper) werden **nie automatisch** übernommen: im Import-Dialog ist der
  Bereich standardmäßig aus; wählt man ihn, stehen die Befehle sichtbar bei jeder Instanz. Prism-/ATLauncher-Variablen
  (`$INST_DIR`, `${INST_JAVA}`) werden unter Windows zu `%INST_DIR%` umgeschrieben (Vibe setzt dieselben Variablen).
- **Dateien im Spielordner** (`options.txt`, `optionsof.txt`, `optionsshaders.txt`, `config/`, `defaultconfigs/`,
  `servers.dat`, Resource-/Shaderpacks samt aktiver Auswahl in `options.txt`/`optionsshaders.txt`/`config/iris.properties`)
  kommen beim Import mit dem Spielordner. Verlinkte Dateien werden mit ihrem Inhalt kopiert, verlinkte Ordner auf
  oberster Ebene (z. B. geteiltes `config`) ebenfalls. Nachträglich werden Dateien **nur auf ausdrücklichen Wunsch**
  erneut kopiert („Dateien erneut übernehmen“ in den Instanz-Einstellungen), vorher wird ein Snapshot angelegt.

## Quellen je Launcher

### Prism Launcher / PolyMC / MultiMC

| Bereich | Instanz (`<instanz>/instance.cfg`) | Standard (`prismlauncher.cfg`/`polymc.cfg`/`multimc.cfg`) |
|---|---|---|
| RAM | `OverrideMemory` + `MinMemAlloc`, `MaxMemAlloc` | `MinMemAlloc`, `MaxMemAlloc` |
| Java | `OverrideJavaLocation` (alt: `OverrideJava`) + `JavaPath`, Anzeige `JavaVersion` | – (nicht übernommen) |
| JVM-Argumente | `OverrideJavaArgs` + `JvmArgs` | `JvmArgs` |
| Fenster | `OverrideWindow` + `MinecraftWinWidth`, `MinecraftWinHeight` | dieselben Schlüssel |
| Start-Befehle | `OverrideCommands` + `PreLaunchCommand`, `PostExitCommand`, `WrapperCommand` | dieselben Schlüssel |
| Umgebungsvariablen | `OverrideEnv` + `Env` (JSON-Objekt; Qt-`@Variant` wird ignoriert) | `Env` |
| Notizen | `notes` (Qt-Escapes `\n` usw. werden aufgelöst) | – |
| Gruppe | `<instanzen>/instgroups.json` → `groups.<name>.instances[]` | – |
| Spielzeit | `totalTimePlayed`, `lastLaunchTime` | – |
| Icon | `iconKey` → `<IconsDir>/<key>.*` bzw. Instanzordner | – |
| Modpack-Herkunft | `ManagedPack`, `ManagedPackType` (`modrinth`/`flame`), `ManagedPackID`, `ManagedPackVersionID`, `ManagedPackName`, `ManagedPackVersionName` | – |

### Modrinth App (Theseus)

Datenbank `app.db` (Kopie). Instanzzeile aus `profiles` (bzw. `instances` im neueren Schema, gleiche Spaltennamen,
soweit vorhanden), Standards aus der einzigen Zeile in `settings`. `NULL` in `override_*` = Standard der App.

| Bereich | Instanz | Standard (`settings`) |
|---|---|---|
| RAM (nur Maximum) | `override_mc_memory_max` | `mc_memory_max` |
| Java | `override_java_path`, Version aus `java_versions.full_version` (gleicher Pfad) | – |
| JVM-Argumente | `override_extra_launch_args` (JSON-Liste) | `extra_launch_args` |
| Umgebungsvariablen | `override_custom_env_vars` (JSON `[[k, v], …]`) | `custom_env_vars` |
| Fenster | `override_mc_game_resolution_x/_y`, `override_mc_force_fullscreen` | `mc_game_resolution_x/_y`, `mc_force_fullscreen` |
| Start-Befehle | `override_hook_pre_launch`, `override_hook_wrapper`, `override_hook_post_exit` (je Feld Rückfall) | `hook_pre_launch`, `hook_wrapper`, `hook_post_exit` |
| Gruppe | `groups` (JSON-Liste, erster Eintrag) | – |
| Spielzeit / zuletzt | `submitted_time_played + recent_time_played`, `last_played` | – |
| Icon | `icon_path` | – |
| Modpack-Herkunft | `linked_project_id`, `linked_version_id` bzw. `instance_links` (`modrinth_modpack`) | – |

Sehr alte Versionen: `profiles/<p>/profile.json` → `java.override_version.path`, `java.extra_arguments`,
`java.custom_env_args`, `memory.maximum`, `resolution [w, h]`, `fullscreen`, `hooks.*`, `metadata.groups`.

### CurseForge App

`<Instances>/<instanz>/minecraftinstance.json`:

| Bereich | Quelle |
|---|---|
| RAM (nur Maximum) | `allocatedMemory`, nur wenn `isMemoryOverride` = `true` (fehlt das Feld: Wert gilt) |
| JVM-Argumente | `javaArgsOverride` |
| Zuletzt gespielt | `lastPlayed` |
| Icon | `profileImagePath` |
| Modpack-Herkunft | `installedModpack.addonID`, `installedModpack.installedFile.id` |

### ATLauncher

Instanz: `<wurzel>/instances/<instanz>/instance.json` (`launcher.*`), Standards: `<wurzel>/configs/ATLauncher.json`.

| Bereich | Instanz | Standard |
|---|---|---|
| RAM | `maximumMemory`, `initialMemory` | `maximumMemory`, `initialMemory` |
| Java | `javaPath`, nur wenn `useJavaProvidedByMinecraft` (Instanz, sonst Standard; Vorgabe `true`) = `false` | – |
| JVM-Argumente | `javaArguments` | `javaParameters` |
| Fenster | – | `windowWidth`, `windowHeight` |
| Start-Befehle | `enableCommands` + `preLaunchCommand`, `postExitCommand`, `wrapperCommand` | dieselben Schlüssel |
| Spielzeit / zuletzt | `totalPlayTime`, `lastPlayed` | – |
| Icon | `instance.png` | – |
| Modpack-Herkunft | `modrinthProject.id`/`modrinthVersion.id` bzw. `curseForgeProject.id`/`curseForgeFile.id` | – |

### NoRisk Client

Datenbank `meta/app.db` (Kopie), Tabelle `profiles`, Spalte `settings` (JSON); ältere Versionen `profiles.json`.
`accounts.json` wird nie geöffnet.

| Bereich | Quelle |
|---|---|
| RAM | `settings.memory.min`, `settings.memory.max` |
| Java | `settings.java_path`, nur wenn `settings.use_custom_java_path` |
| JVM-Argumente | `settings.custom_jvm_args` |
| Fenster | `settings.resolution.width/height`, `settings.fullscreen` |
| Notizen | `description` |
| Gruppe | `group_name` |
| Spielzeit / zuletzt | `playtime_seconds`, `last_played` |
| Icon | `banner` (nur `https://`-URL) |

Spieldaten werden bei NoRisk per Positivliste kopiert (`norisk::COPY`, jetzt inkl. `defaultconfigs`).

## Nachträglich übernehmen

Importierte Instanzen tragen `instances/<id>/external.json` (Launcher + Quellpfad). `import_settings_pending` liest
alle Quellen erneut (Modrinth-/NoRisk-Wurzeln nur einmal) und liefert Instanzen, deren Original noch existiert und
deren Werte abweichen. Vorausgewählt ist ein Bereich nur, wenn in Vibe noch kein eigener Wert steht (und nie
Start-Befehle). Spielzeit, Icon und Modpack-Herkunft werden nur angeboten, wenn sie in Vibe noch fehlen.

Der Hinweis unten links erscheint einmal; „Nicht jetzt“ blendet ihn bis zum nächsten Start aus, „Nie“ oder eine
Übernahme setzt `import-settings-2026-11` in `settings.dismissed_notices`. Dauerhaft: Instanz-Einstellungen →
Allgemein → „Herkunft“ → „Einstellungen aus <Launcher> übernehmen“.

## Bewusst nicht übernommen

- Globale Java-Wahl der Launcher (je Version automatisch; Vibe wählt selbst).
- Prism `LaunchMaximized`, ATLauncher `maximiseMinecraft` (keine Entsprechung in Vibe), Prism `PermGen`.
- Zusätzliche Spiel-Argumente (NoRisk `extra_game_args`) – Vibe hat dafür kein Feld.
- CurseForge-Standards der App (Speicherort/Format nicht stabil), CurseForge `preferenceReleaseType` (Vibe folgt beim
  Modpack-Update dem Kanal der installierten Version).
- Konten, Tokens, Skins, Launcher-weite Einstellungen ohne Instanzbezug.
- Datei-Import (`.mrpack`, CurseForge-ZIP, Prism-Export): unverändert RAM/JVM-Argumente/Notizen aus Prism-Exporten;
  Java-Pfade und Start-Befehle aus heruntergeladenen Dateien werden bewusst nie übernommen.
