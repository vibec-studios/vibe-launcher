# Vibe Launcher – Architektur & Vertrag

Dieses Dokument ist die gemeinsame Grundlage für alle Module. **Öffentliche Typen, Command-Namen und
Event-Namen hier und in den genannten Dateien sind der Vertrag** – wer sie ändern muss, ändert Rust-Typ,
`src/lib/types.ts`, `src/lib/api.ts` und dieses Dokument gemeinsam.

## Stack

- **Tauri 2** (Rust) + **React 19 / TypeScript / Vite**
- UI: Tailwind CSS v4 (Tokens in `src/styles/globals.css`), Radix-Primitives, lucide-Icons
- Daten: TanStack Query (Cache) + Zustand (Live-Zustände), TanStack Router (Hash-History), TanStack Virtual
- Backend: tokio, reqwest (rustls), serde, zip, sha1/sha2, keyring, tracing

## Verzeichnisse

```
src-tauri/src/
  lib.rs            Plugins, State, Command-Registrierung (Integrator)
  error.rs          AppError -> {kind, message} fürs Frontend; AppResult<T>; Ctx-Trait (.ctx("..."))
  paths.rs          Datenordner-Layout, maven_path(), sanitize_file_name()
  net.rs            Net: HTTP-Client (User-Agent), get_json/get_bytes mit Retries, download()/download_all()
                    (parallel, SHA-1-Prüfung, .part-Dateien, Fortschritt), sha1_file/sha512_file
  tasks.rs          Tasks/TaskHandle/SubProgress – Hintergrundaufgaben mit Fortschritt (task://update)
  events.rs         Event-Namen + emit()
  settings.rs       Settings (settings.json), curseforge_key(), msa_client()
  instance.rs       Instance-Modell + InstanceStore (CRUD, modify(), insert_new())
  state.rs          AppState (in Commands: `State<'_, AppState>`)
  util.rs           write_json_atomic, copy_dir_all, open_in_explorer, safe_join (Zip-Slip-Schutz)
  auth/             OWNER Backend-Agent "Auth"     (Accounts, Microsoft-Login) – außerdem .github/, README
  minecraft/        OWNER Backend-Agent "Game"     (Versionen, Install, Loader, Java, Start, Logs, mclo.gs)
  content/          OWNER Backend-Agent "Content"  (Modrinth, CurseForge, Mods, Welten, Import/Export)
  commands/core.rs -> Integrator, commands/game.rs -> Game, commands/auth.rs -> Auth, commands/content.rs -> Content
src/
  main.tsx, app/*   Integrator (Shell/Titelleiste, Router, Guards, TextMenu, TaskDock, EventBridge, AccountChip)
  components/ui/*   Integrator (Design-System – bei Bedarf erweitern, nicht umbauen)
  lib/*             Integrator (api.ts, types.ts, events.ts, queries.ts, format.ts)
  i18n/<bereich>.ts je Bereich eigene Datei (common = Integrator)
  features/home, instances, logs, settings, components/Logo3D.tsx      -> Frontend-Agent A
  features/discover, content, import, export, accounts                 -> Frontend-Agent B
```

Datenordner (Standard `%APPDATA%\VibeLauncher`, überschreibbar mit `VIBE_LAUNCHER_HOME`):
siehe Kopfkommentar in `paths.rs`. Spielordner einer Instanz: `instances/<id>/minecraft`.

## Regeln Backend

- Jede lange Operation läuft als **Task** (`state.tasks.spawn(kind, title, instance_id, |task| async move {...})`)
  und gibt die Task-ID zurück. Fortschritt über `task.progress()/stage()/sub()`. Abbruch: `task.check()?`.
- Downloads immer über `state.net.download_all(items, Some(&sub_progress))` – nie eigene Schleifen.
- Dateioperationen, die blockieren (Hashing, Zip), in `tokio::task::spawn_blocking`.
- Instanzen nur über `state.instances` ändern (`modify`, `patch`, `insert_new`) – das sendet `instance://changed`.
- Nach Änderungen an Mods/Packs/Welten: `events::emit(&app, events::CONTENT_CHANGED, &json!({"instance_id": id}))`.
- Fehlertexte auf Deutsch, verständlich für Endnutzer. Keine `unwrap()` auf Daten von außen.
- Keine Secrets loggen (Tokens, API-Keys).
- API-Keys/IDs: CurseForge-Key `settings.curseforge_key()` (Build-Env `CURSEFORGE_API_KEY` oder Einstellung),
  Microsoft-Client-ID `settings.msa_client()` (Build-Env `VIBE_MSA_CLIENT_ID` oder Einstellung).

## Commands

Alle in `src/lib/api.ts` typisiert. JS-Argumente in camelCase (Tauri wandelt in snake_case).

| Bereich | Commands |
|---|---|
| Kern | instances_list, instance_get, instance_create, instance_update, instance_delete, instance_duplicate, instance_set_icon, instance_open_folder, settings_get, settings_set, tasks_list, task_cancel, tasks_clear, system_info, open_path, open_data_dir |
| Auth | accounts_list, account_remove, account_set_active, account_refresh, auth_msa_available, auth_msa_begin, auth_msa_wait, auth_msa_cancel |
| Skins | skins_profile, skin_upload_file, skin_apply_library, skin_set_variant, skin_reset, cape_set, skin_library_list, skin_library_add_file, skin_library_add_current, skin_library_import_player, skin_library_rename, skin_library_set_variant, skin_library_remove, skin_library_export, skin_library_reveal |
| Spiel | game_versions, loader_game_versions, loader_versions, instance_install, instance_launch, instance_kill, game_states, instance_log_session, instance_log_files, instance_log_read, mclogs_upload, java_list, java_test, java_install |
| Inhalte | curseforge_available, content_search, content_categories, content_project, content_versions, content_install, content_list, content_set_enabled, content_remove, content_add_files, content_check_updates, content_update, worlds_list, world_delete, modpack_install, import_preview, import_pack, export_entries, export_instance, content_missing, content_missing_dismiss, launchers_detect, launcher_scan_dir, import_external, content_set_pinned, content_update_counts, stores_list, store_add, store_remove, store_set_enabled, modpack_check, modpack_update_preview, modpack_update, content_check_deps, content_sides, modsets_list, modset_create, modset_apply, modset_save, modset_rename, modset_delete, sets_list, sets_create, sets_update, sets_delete, sets_duplicate, sets_add_entries, sets_remove_entries, sets_parse_list, sets_import_text, sets_import_file, sets_export_file, sets_export_code, sets_export_links, sets_instance_candidates, sets_from_profile, sets_preview, sets_apply, sets_install_new, sets_check, sets_compat, sets_news, sets_dismiss_news, perf_preview, perf_install, files_list, files_stat, files_find, files_search, files_read, files_write, files_restore, files_validate, files_image, files_create, files_rename, files_duplicate, files_delete, files_import, files_abs_path, files_reveal |
| Screenshots | screenshots_list, screenshot_thumb, screenshot_delete, screenshot_copy, screenshot_open_folder (`commands/screenshots.rs`, OWNER Frontend-Agent A) |
| Clips | clips_list, clip_update, clip_delete, clip_open_folder, clips_watch (`commands/clips.rs`, Videoclips des Vibey Clients) |
| Plattform | crash_analyze, instance_servers_list, instance_servers_save, server_ping, servers_recent, playtime_sessions, optsync_get, optsync_set_instance, optsync_capture, optsync_apply_all, shortcut_create, app_actions_take, discord_available (`commands/platform.rs`, Logik in `platform/`, OWNER Frontend-Agent A) |
| Backups | snapshots_list, snapshot_create, snapshot_restore, snapshot_delete, world_backups_list, world_backup_create, world_backup_restore, world_backup_delete, world_copy, world_import_zip, backups_open_folder (`commands/backups.rs`) |
| Vibe-Dienste | vibe_status, vibe_tokens_get, vibe_tokens_set, vibe_mojang_join, vibe_http, vibe_ws_open, vibe_ws_send, vibe_ws_close, vibe_pack_share, vibe_pack_link, vibe_pack_install (`commands/vibe.rs`, Logik in `vibe/`, Frontend `features/social`) |

### Wichtige Abläufe

- **Import/Modpack-Installation** (`import_pack`, `modpack_install`): legt die Instanz an (`instances.insert_new`),
  ruft `task.set_instance(id)` (damit das Frontend die neue Instanz-ID aus dem Task kennt), lädt alle Dateien.
  Das Spiel selbst (Vanilla/Loader/Java) wird **nicht** im Import installiert – das passiert über
  `instance_install` (Frontend ruft es nach erfolgreichem Import auf) bzw. automatisch beim ersten Start.
- **CurseForge-Dateien ohne Drittanbieter-Freigabe** landen in `content_missing` (Frontend zeigt Banner mit Links).
  Vorher wird geprüft, ob Modrinth dieselbe Datei (gleicher SHA-1) anbietet – dann wird sie von dort geladen.
  Liegt eine fehlende Datei mit gleichem Namen (und passendem SHA-1) im System-Download-Ordner, übernimmt
  `content_missing` sie automatisch in die Instanz.

### Inhalte (Content-Modul)

- `ContentKind` = `mod` (`mods/`), `resourcepack` (`resourcepacks/`), `shader` (`shaderpacks/`),
  `datapack` (`datapacks/` im Spielordner). Datapacks: Bietet ein Datapack-Projekt eine Mod-Variante für den
  Loader der Instanz (z. B. Terralith für Fabric), wird diese nach `mods/` installiert (gilt für alle Welten).
  Sonst landet die ZIP in `<spielordner>/datapacks/` – Vanilla lädt diesen Ordner **nicht** automatisch; der
  Nutzer kopiert sie beim Erstellen einer Welt in `saves/<welt>/datapacks/` (bzw. Mods wie Global Packs /
  Open Loader nutzen ihn). Für 1.0 bewusst so gelöst.
- Versionsfilter: Mods nach Instanz-Loader (Quilt akzeptiert Fabric-Mods, NeoForge 1.20.1 akzeptiert
  Forge-Mods), Shader/Resourcepacks unabhängig vom Loader (`iris`/`optifine`/`minecraft`).
- `content_install` installiert Pflicht-Abhängigkeiten rekursiv (bereits installierte Projekte werden
  übersprungen) und ersetzt ältere Dateien desselben Projekts; ein deaktivierter Mod bleibt nach Update deaktiviert.
- `content_update` mit leerer `file_names`-Liste = alle verfügbaren Updates.
- `content_list` liefert sofort; unbekannte Dateien werden im Hintergrund per Hash zugeordnet
  (Modrinth SHA-1, CurseForge Murmur2-Fingerprint) und danach `content://changed` gesendet.
- Metadaten je Instanz in `instances/<id>/content.json` (Herkunft, Metadaten-Cache nach Größe+mtime,
  unbekannte Hashes), fehlende Downloads in `instances/<id>/missing.json`, Icons unter `cache/icons/`.
- Eigenes Modpack-Format `.vlpack`: siehe `docs/VLPACK.md`.
- Export als Prism/MultiMC wird nicht angeboten (Import schon).

### Import aus anderen Launchern

- `launchers_detect()` -> `ExternalLauncher[]`: Modrinth App (`%APPDATA%\ModrinthApp` bzw. `com.modrinth.theseus`),
  Prism (`%APPDATA%\PrismLauncher`, `InstanceDir`/`IconsDir` aus `prismlauncher.cfg`), CurseForge
  (`%USERPROFILE%\curseforge\minecraft\Instances`), ATLauncher (`%APPDATA%\ATLauncher\instances`). Schnell: keine
  Hashes, Mod-Anzahl per Verzeichnis-Listing, `size` bleibt `null`.
- `launcher_scan_dir(path)` -> `ExternalLauncher` für einen gewählten Ordner: Launcher-Wurzel, Instanzen-Ordner,
  einzelne Instanz (Marker `app.db`, `prismlauncher.cfg`/`multimc.cfg`, `instance.cfg`, `minecraftinstance.json`,
  `instance.json`) oder beliebiger Spielordner (`id: "folder"`; Version/Loader aus den Mods geschätzt + `warning`).
- `import_external(source, sourcePath, name?, mcVersion?, loader?)` -> Task-ID (eine Aufgabe je Instanz): legt die
  Instanz an (`task.set_instance`), **kopiert** den Spielordner (Original wird nie verändert), übernimmt Icon,
  Spielzeit, zuletzt gespielt, Prism-Speicher/JVM-Argumente; `instance.source` = Herkunft (Modrinth-/CF-Modpack-ID,
  falls bekannt). Das Spiel wird nicht installiert (Frontend ruft danach `instanceInstall`). Fehler/Abbruch entfernt
  die halbe Instanz. `mcVersion`/`loader` überschreiben erkannte Werte (nötig, wenn `mc_version` leer ist).
- Modrinth App: `app.db` (SQLite, WAL) wird samt `-wal`/`-shm` nach `cache/tmp/modrinth-db-*` kopiert, gelesen wird
  nur die Kopie. Neues Schema (`instances` + `instance_content_sets` + `instance_links`), älteres (`profiles`) und
  sehr alte `profile.json` werden unterstützt; Profile ohne Metadaten -> Schätzung + `warning`. `settings.custom_dir`
  wird beachtet.
- Bereits importiert: `instances/<id>/external.json` merkt den Quellpfad -> `ExternalInstance.imported_as`.
- Frontend: `openImport(null, "launcher")` öffnet den Import-Dialog direkt im Launcher-Modus.

### Eigene Stores (Vibe Store v1)

- Format: `docs/STORE.md`. `Source` = `"modrinth" | "curseforge" | "store:<id>"` (Rust: `Source::Store(StoreKey)`,
  internierte ID, serialisiert als String). Suche, Kategorien, Projekt, Versionen, Installation (inkl.
  Abhängigkeiten aus anderen Quellen über `Dependency.source`), Updates, Modpack-Installation und Hash-Zuordnung
  (sha1/sha256) funktionieren wie bei Modrinth. Die Datei wird mit ETag/If-Modified-Since geladen, ~10 min im
  Speicher und unter `cache/stores/<id>.json` gehalten (Offline-Fallback); die Suche läuft clientseitig.
- `Settings.stores: StoreConfig[]`; der Standard-Store **Vibe Craft Studios**
  (`https://vibe.axolite.app/api/v1/store.json`, `domains::STORE_URL`; alte GitHub-Pages-Adresse wird beim Laden der
  Einstellungen umgestellt) ist immer enthalten und nur deaktivierbar.
- Commands: `stores_list() -> StoreInfo[]` (lädt aktivierte Stores, liefert Name/Icon/Projektanzahl/Fehler),
  `store_add(url)` (laden + prüfen; ID/Name/Icon aus der Datei), `store_remove(id)`, `store_set_enabled(id, enabled)`.

### Datei-Bereich (Instanz: Einstellungen → „Dateien“, Server: Tab „Dateien“)

- Ersetzt den früheren Config-Editor (`?tab=configs` leitet auf `?tab=files` weiter). Backend `files/`
  (`sandbox.rs`, `ops.rs`, `validate.rs`) + `commands/files.rs`, Frontend `features/files/` (CodeMirror 6 nur per
  dynamischem `import()`), Texte in `i18n/files.ts`.
- Bereich `scope`: `{ kind: "instance", id }` (Wurzel `instances/<id>/minecraft`) oder `{ kind: "server", id }`
  (Wurzel `servers/<id>`; `vibe-server.json`, `.vibe-pid`, `.vibe-backups` sind verborgen und gesperrt).
- Pfade sind **relativ zur Wurzel** mit `/` (leer = Wurzel, nur wo erlaubt). Die Sandbox lehnt ab: `..`, absolute
  Pfade, Laufwerksbuchstaben/UNC, `:` (auch NTFS-Datenströme), Steuerzeichen, unter Windows Namen mit Punkt/Leerzeichen
  am Ende und reservierte Gerätenamen; jeder Bestandteil darf kein Symlink/Junction (Reparse-Point) sein, und der
  kanonische Pfad (bzw. der des Elternordners) muss innerhalb der kanonischen Wurzel liegen.
- Lesen: `files_list(scope, dir) -> FileEntry[]` (direkte Einträge, Ordner zuerst; `kind` dir|text|image|binary nach
  Endung, unbekannte Endungen per Inhaltsprüfung), `files_stat`, `files_find(scope, query)` (Namenssuche, max. 500),
  `files_search(scope, query, dir?)` (Volltext in Textdateien ≤ 1 MB, max. 200 Treffer, max. 96 MB gelesen),
  `files_read(scope, path) -> FileContent` (`readonly_reason`: `too_large` (> 2 MB, Logs > 8 MB), `binary`, `image`,
  `encoding` (kein UTF-8), `log` (`*.log`, `logs/**`, `crash-reports/**` nur Ansicht)), `files_image` (data-URL ≤ 16 MB).
- Schreiben: `files_write` sichert die alte Fassung (Instanz: `instances/<id>/config-backups/<pfad>/<ms>-<nr>`, Server:
  `servers/<id>/.vibe-backups/files/…`; höchstens 10 je Datei, leere Ausgangsdatei ohne Sicherung) und schreibt atomar;
  BOM und CRLF bleiben erhalten. `files_restore` spielt die neueste Sicherung zurück (rückgängig machbar).
  `files_validate(path, content)`: JSON (Kommentare erlaubt), JSON5, TOML.
- Aktionen: `files_create(scope, dir, name, isDir)`, `files_rename(scope, path, newName)` (bleibt im Ordner, nimmt
  Sicherungen mit), `files_duplicate` („name (Kopie).ext“), `files_delete(scope, paths, permanent)` (Papierkorb über
  `trash`; klappt das nicht, wird nichts gelöscht und `trash_error` gesetzt – das Frontend fragt dann nach
  `permanent = true`), `files_import(scope, dir, sources)` (absolute Quellpfade, keine Überschreibung: „name (2).ext“),
  `files_abs_path`, `files_reveal` (Explorer, Datei markiert).

### Auto-Update von Inhalten und fixierte Versionen

- `Settings.auto_update_content` (Standard aus) und `Instance.auto_update_content: bool | null` (null = global;
  Modpack-Instanzen mit `source.project_id` dann aus). `InstancePatch`: `null` setzt auf „global“ zurück (gilt jetzt
  auch für `icon`/`accent`/`group`/`notes`: `null` leert, fehlendes Feld = unverändert).
- Wirkung: `minecraft::launch` ruft `content::autoupdate::before_launch` vor der Installation auf (Stufe „Mods werden
  aktualisiert …“, Zeitlimit 120 s). Fehler/Offline verhindern den Start nie, Ergebnis steht im Spiel-Log.
- `content_set_pinned(instanceId, kind, fileName, pinned) -> ContentItem`; `ContentItem.pinned`. Fixierte Dateien
  (`content.json` → `pinned`) erscheinen nicht in `content_check_updates` und werden weder automatisch noch bei
  „Alle aktualisieren“ geändert.
- `content_update_counts() -> Record<instanceId, number>`: startet bei Bedarf (höchstens alle 30 min) eine
  Hintergrundprüfung aller Instanzen und liefert die zuletzt bekannten Zahlen (Badge „N Updates“ in der Bibliothek).
  Ein verfügbares Modpack-Update zählt als +1.

### Modpack-Updates

- Beim Import/`modpack_install` wird der Installationsstand in `instances/<id>/pack.json` gespeichert (Quelle,
  Projekt/Version, Pack-Dateien mit SHA-1/Projekt, SHA-1 aller Overrides).
- `modpack_check(instanceId) -> ModpackUpdate | null` (Modrinth, CurseForge, Stores; ältere Instanzen ohne
  pack.json über `instance.source`). `modpack_update_preview(instanceId, versionId?) -> ModpackPreview`
  (hinzugefügt/aktualisiert/entfernt mit Seite, Overrides `new|update|conflict|remove`, MC-/Loader-Wechsel,
  eigene Inhalte, fehlende CF-Dateien). `modpack_update(instanceId, versionId?) -> taskId`: automatischer Snapshot,
  Pack-Dateien tauschen (Deaktiviert-Status bleibt), eigene Inhalte bleiben, Overrides nur überschreiben, wenn
  unverändert seit der Installation (sonst Nutzer-Version behalten), MC/Loader mitziehen (`install_state` wird
  zurückgesetzt – Frontend ruft danach `instanceInstall`).

### Abhängigkeits-Check, Seiten, Mod-Sets, Performance

- `content_check_deps(instanceId) -> DepIssue[]` (`missing_dependency | version_mismatch | incompatible |
  duplicate | wrong_loader | wrong_minecraft`) aus fabric.mod.json/quilt.mod.json (`depends/breaks`, Semver-Ausdrücke)
  und mods.toml/neoforge.mods.toml (`[[dependencies]]`, Maven-Bereiche); eingebettete JARs zählen als vorhanden.
  `fixes`: `install` (Modrinth-Projekt), `remove`, `disable`. Vor dem Start schreibt der Launch-Hook Probleme als
  Warnung ins Spiel-Log (Start geht weiter).
- `Side = "client" | "both" | "server" | "unknown"`; `ContentItem.side`, `ImportPreview.files[].side`,
  `content_sides(instanceId) -> SideInfo[]`. Quellen: Modrinth `client_side/server_side` (per Projekt/Hash),
  mrpack `env`, CurseForge-Tags „Client/Server“, Store `client_side/server_side`, `environment` aus fabric.mod.json.
  Resourcepacks/Shader = client, Datapacks = server.
  **Rust-API für andere Module:** `content::sides::classify(&AppState, instance_id) -> AppResult<Vec<SideInfo>>`
  mit `SideInfo { file_name, kind, side, enabled, rel_path }` (ordnet unbekannte Dateien vorher per Hash zu und lädt
  fehlende Modrinth-Angaben nach) – z. B. für „Server aus Profil erstellen“: `side == Client` weglassen.
- Profile einer Instanz (UI: „Profile“, früher „Mod-Sets“; Datei bleibt `instances/<id>/modsets.json`): `modsets_list`,
  `modset_create(name)` (aus aktuellem Zustand, wird aktiv), `modset_apply(setId)` (aktiviert/deaktiviert per
  `.disabled`; unbekannte neue Dateien bleiben), `modset_save`, `modset_rename`, `modset_delete`.
  `ModSets.active_modified` = aktuelle Auswahl weicht vom aktiven Profil ab.
- Mod-Sets = instanzübergreifende Wunschlisten von Projekten (`<data>/mod_sets.json`, `content/sets.rs`,
  `content/sets_apply.rs`, Commands in `commands/sets.rs`, Frontend `src/features/modsets/api.ts`):
  `sets_list/create/update/delete/duplicate/add_entries/remove_entries`, `sets_parse_list(text)` (Links/Slugs/Namen),
  `sets_import_text|file`, `sets_export_file|code|links` (Code `VIBESET1.` + base64url(deflate(JSON)), Datei
  `{ "vibe_mod_set": 1, name, entries: [{ source, id, slug, title, type, icon }] }`), `sets_instance_candidates`,
  `sets_from_profile(instanceId, profileId)`, `sets_preview(instanceId, setIds, only?)` (je Projekt: install /
  installed / unavailable mit Grund + Alternativen / conflict; inkl. Pflicht-Abhängigkeiten),
  `sets_apply(instanceId, setIds, picks) -> taskId` (vorher Snapshot, entfernt nie etwas),
  `sets_install_new(instanceId, setIds) -> taskId` (neue Instanz), `sets_check(setIds, mc, loader)`,
  `sets_compat(id)`, `sets_news(instanceId)` / `sets_dismiss_news` (angewendete Sets je Instanz in
  `instances/<id>/mod_sets_applied.json`).
- `perf_preview(instanceId) -> PerfCandidate[]` (Modrinth-Optimierungsmods je Loader, nur kompatible Versionen,
  ein Renderer-Ersatz) und `perf_install(instanceId, projectIds) -> taskId` (vorher Snapshot).
- **Start** (`instance_launch`): installiert bei Bedarf, holt Zugangsdaten über `state.auth.launch_account(...)`,
  startet den Prozess, sendet `game://state` + `game://log`.
  Optional `server` (host[:port]): direkt auf einen Server (`--quickPlayMultiplayer` ab 1.20, sonst `--server/--port`).
  Optional `world` (Ordnername unter `saves/`): startet per Quick Play (`--quickPlaySingleplayer`, ab MC 1.20)
  direkt in diese Welt – Frontend blendet die Option für ältere Versionen aus.
- **Screenshots**: `screenshots_list(instance_id?)` liefert `Screenshot[]` (alle Instanzen, neueste zuerst);
  `screenshot_thumb(path)` erzeugt/cached ein JPEG-Vorschaubild (max. 480×360, `cache/thumbs/<sha1>.jpg`) und gibt
  dessen Pfad zurück; `screenshot_copy` legt das Bild in die Zwischenablage, `screenshot_open_folder` markiert die
  Datei im Explorer. Alle Pfade müssen in `instances/<id>/minecraft/screenshots/` liegen.
- **Clips** (Videoclips des Vibey Clients; verbindlicher Datei-Vertrag: Vibey Client `docs/CLIPS.md` §10, schema 1):
  Ordner `instances/<id>/minecraft/vibeyclient/clips/`, ein Clip = `<id>.mp4` + `<id>.jpg` (optional) + `<id>.json`,
  id-Regex `^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_[a-z]+(_\d+)?$`. Ein Clip existiert genau dann, wenn `<id>.json`
  parst (schema 1, höhere werden übersprungen) und seine `video`-Datei existiert; Dotfiles, `.tmp/`, `.buffer/`
  werden ignoriert, nicht lesbare JSON einmal nach 200 ms erneut gelesen, dann übersprungen (nie gelöscht).
  - `clips_list(instance_id?) -> Clip[]` (alle Instanzen, neueste zuerst; `video_path`/`thumbnail_path` absolut,
    `thumbnail_path: null` -> Platzhalter, `created_at` in ms).
  - `clip_update(instance_id, id, kept?, title?, tags?) -> Clip`: ändert **nur** diese Felder (Titel ≤ 100, ≤ 16 Tags
    à ≤ 32 Zeichen; leerer Titel/leere Tags entfernen das Feld), alles andere inkl. unbekannter Felder bleibt;
    atomar über `.<id>.json.tmp` + Umbenennen. Die Schlüsselreihenfolge der JSON kann sich dabei ändern.
  - `clip_delete(instance_id, id)`: nur auf Wunsch des Nutzers; `<id>.json` zuerst, dann MP4/JPG (gesperrte Dateien
    räumt das Spiel später als Waisen auf). Der Launcher löscht nie automatisch.
  - `clip_open_folder(instance_id, id?)`: Clip-Ordner öffnen bzw. das Video im Explorer markieren.
  - `clips_watch(active)`: leichtes Ordner-Polling (1 s, ~500 ms entprellt) mit Lease von ~25 s, das die Seite
    alle 10 s verlängert; sendet `clips://changed`. Kein Dauer-Watcher, solange die Galerie zu ist.
  - Datenschutz (§10.4): nichts hochladen, fehlendes `server` nie aus `session.json` ergänzen.
  - Abspielen im WebView über das Asset-Protokoll (`convertFileSrc`; der Datenordner wird beim Start per
    `asset_protocol_scope().allow_directory` freigegeben, CSP `media-src` erlaubt `asset:`/`http://asset.localhost`).
- **Accounts**: nur Microsoft (`AccountKind = "microsoft"`, keine Offline-Accounts). Login: `auth_msa_begin` -> Code
  anzeigen -> `auth_msa_wait` (liefert den Account) bzw. `auth_msa_cancel`. Tokens liegen im Windows-Schlüsselbund,
  `accounts.json` enthält keine Geheimnisse. `launch_account` erneuert den Minecraft-Token automatisch (< 5 min Rest);
  schlägt das wegen der Anmeldung fehl, wird `needs_relogin = true` gesetzt.
  Nur Debug-Builds (automatisierte Tests): `VIBE_DEV_OFFLINE_ACCOUNT=<Name>` -> ohne aktiven Account startet das Spiel
  mit einem Offline-Profil (nicht in UI/accounts.json, im Release wegkompiliert).
- **Skins & Capes** (`auth/skins.rs`, `commands/skins.rs`): Profil über `api.minecraftservices.com/minecraft/profile`
  (Token aus dem Schlüsselbund, bei 401 einmal Refresh + Wiederholung). Texturen gehen als `data:`-URL ans Frontend
  (Cache unter `cache/textures/`). Skin-Änderungen aktualisieren `Account.skin_url` (-> `accounts://changed`,
  `PlayerHead` zeigt eigene Accounts direkt aus der Textur). Bibliothek: `skins/<id>.png` + `skins.json` im Datenordner
  (Duplikate per SHA-1 erkannt). Nur PNG 64×64 / 64×32. `accountId = null` -> aktiver Account.

### Backups (Snapshots + Welt-Backups)

- **Snapshots** (`content/snapshots.rs`): sichern `mods/ resourcepacks/ shaderpacks/ datapacks/ config/ defaultconfigs/
  kubejs/`, `options.txt`, `optionsof.txt`, `optionsshaders.txt` (Spielordner) und `content.json`, `pack.json`,
  `modsets.json` (Instanzordner) – keine Welten/Logs/Screenshots. Objekte nach SHA-1 unter
  `backups/objects/<ab>/<sha1>` (dedupliziert), Manifeste `backups/snapshots/<instanz>/<id>.json`
  (`files/meta: {rel_path, sha1, size}[]` + `dirs`). `.jar`/`.zip` (auch `.disabled`) per Hardlink (Fallback Kopie),
  alles andere kopiert. Löschen räumt nicht mehr referenzierte Objekte auf. Wiederherstellen legt vorher den
  automatischen Snapshot „Vor Wiederherstellung“ an, bringt die Ordner exakt auf den Snapshot-Stand (entfernt
  zusätzliche Dateien/Ordner) und sendet `content://changed`; verweigert, solange die Instanz läuft.
  Rust-API (Vertrag, z. B. für automatische Snapshots vor Updates):
  ```rust
  content::snapshots::create(state, instance_id, name, auto, progress: Option<&SubProgress>) -> AppResult<SnapshotInfo>
  content::snapshots::restore(state, instance_id, snapshot_id, progress) -> AppResult<()>
  content::snapshots::list(state, instance_id) -> AppResult<Vec<SnapshotInfo>>   // neueste zuerst
  content::snapshots::delete(state, instance_id, snapshot_id) -> AppResult<()>
  ```
  `SnapshotInfo { id, name, created, auto, file_count, size }`; leerer Name -> „Snapshot vom <Datum>“.
  `auto = true` zählt zur Grenze `Settings.snapshot_keep` (Standard 10 je Instanz, nur automatische).
- **Welt-Backups** (`content/worldbackup.rs`): ZIP `backups/worlds/<instanz>/<ordner>/<zeitstempel>.zip` (Wurzel
  `<ordner>/`, ohne `session.lock`) + Sidecar `.json` (Name, Zeit, Größe, `auto`, Fingerabdruck aus
  Pfad/Größe/mtime). `WorldBackup { id: "<ordner>/<zeitstempel>", folder, world_name, created, size, auto }`.
  `world_backup_restore` sichert eine vorhandene Welt vorher (auto) und ersetzt sie dann; `world_copy` und
  `world_import_zip` (level.dat in der Wurzel oder eine Ebene tiefer, Zip-Slip-sicher) wählen einen freien
  Ordnernamen („Welt (2)“). Alle langen Operationen sind Tasks (`kind: "backup"`), streamen in `spawn_blocking`,
  melden Fortschritt nach Bytes und sind abbrechbar. Danach `content://changed`.
- **Vor dem Start**: `content::worldbackup::before_launch(state, id, task)` (in `minecraft::launch` nach dem
  Auto-Update): bei `Settings.world_backup_on_launch` (Standard aus) werden alle seit dem letzten Backup geänderten
  Welten gesichert (Stufe „Welten werden gesichert …“), danach gilt `Settings.world_backups_keep` (Standard 5 je
  Welt, nur automatische). Scheitert nie – Probleme stehen im Spiel-Log.
- Frontend: Instanz-Tab „Backups“ (`features/backups/BackupsTab.tsx`), Welt-Aktionen im Welten-Tab
  (`features/backups/worldActions.tsx`), Karte „Backups“ in den Einstellungen. Query-Keys
  `["content", id, "snapshots"]` / `["worlds", id, "backups"]` werden über `content://changed` mit aktualisiert.

## Events (Backend -> Frontend)

| Event | Payload | Wann |
|---|---|---|
| `task://update` | TaskInfo | Start, Fortschritt (≤10/s), Ende |
| `instance://changed` | Instance | jede Änderung |
| `instance://removed` | {id} | gelöscht |
| `game://state` | GameState | preparing/running/stopped |
| `game://log` | {instance_id, lines: LogLine[]} | gebündelt ≤10/s |
| `content://changed` | {instance_id} | Mods/Packs/Shader/Welten geändert |
| `accounts://changed` | Account[] | Accounts geändert |
| `settings://changed` | Settings | Einstellungen gespeichert |
| `clips://changed` | {instance_ids: string[]} | Clips dazugekommen/geändert/gelöscht (nur während `clips_watch`) |
| `skins://changed` | {scope: "library"} \| {scope: "profile", account_id} | Skin-Bibliothek bzw. Skin/Cape eines Accounts geändert |
| `vibe://ws` | {type: "open" \| "message" \| "close", id, data?, code?, reason?} | WebSocket-Brücke des Vibe-Gateways |

`app/EventBridge.tsx` hält damit React-Query-Caches und Stores aktuell – Seiten brauchen kein Polling.

### Spiel – Details (Game-Agent)

- `LogLine.text` ist immer **einzeilig**: mehrzeilige Log4j-Events (Stacktraces) werden in mehrere LogLines mit
  gleichen `time/level/thread/logger` zerlegt. Klartext ohne Zeitstempel bekommt die Empfangszeit.
  Eigene Launcher-Zeilen haben `level: "launcher"` (Fehler beim Start: `"error"`), `logger: "Vibe Launcher"`.
  Das Zugangstoken wird in Sitzungslogs und im angezeigten Startbefehl maskiert.
- `game_states` liefert alle Sitzungen seit Launcher-Start (auch beendete, mit `exit_code`/`crashed`).
  `instance_kill` bricht auch eine laufende Vorbereitung ab. Vom Nutzer beendete Spiele gelten nicht als Absturz.
- `loader_versions`: stabile/empfohlene zuerst. Forge: `stable = true` nur für die empfohlene (sonst neueste)
  Version. Forge/NeoForge-`version` ohne MC-Präfix (z. B. `"47.3.0"`, `"21.1.77"`, NeoForge 1.20.1: `"47.1.106"`).
- Loader-Version `null` in der Instanz => bei der Installation wird die empfohlene Version bestimmt und gespeichert.
- Rust: `minecraft::install_instance(state, id, progress)` (Vertrag) und `install_instance_opts(..., force)`
  (liefert zusätzlich die aufgelösten Startdaten). Installationen laufen nacheinander (globale Sperre).

### Lokale Server (Game-Agent, `src-tauri/src/server/`, `commands/server.rs`, Frontend `features/servers`)

- Ordner `servers/<id>/` = Arbeitsordner des Servers (server.properties, world, mods …) + `vibe-server.json`
  (Modell `Server`), `backups/` (ZIP je Welt), `playit/` (Secret + Agent-Log), `.vibe-pid` (laufender Prozess).
  Gemeinsamer Cache der Vanilla-Server-JARs: `meta/server-jars/<mc>/server.jar`; playit-Agent: `tools/playit/<tag>/`.
- Commands: servers_list, server_get, server_create (-> `{server, task_id}`), server_mod_candidates, server_update,
  server_delete, server_set_icon, server_install, server_accept_eula, server_start, server_stop, server_restart,
  server_kill, server_command, server_statuses, server_log, server_addresses, server_properties_get/_set/_raw/_raw_set,
  server_players, server_player_action, server_set_whitelist, server_worlds, server_backups, server_backup_create,
  server_backup_delete, server_backup_restore, server_open_folder, server_tunnel_reset, servers_quit.
- Tasks der Server haben `TaskInfo.instance_id = "server:<id>"` (Installation, Backups, Java).
- Installation: Vanilla `downloads.server` (SHA-1), Fabric-Server-Launcher (Fabric-Meta), Quilt-Installer
  `install server`, Forge/NeoForge-Installer `--installServer` (Start über `run.bat`-Argumentdateien bzw. JAR).
  Java wie beim Spiel (`java::resolve_with`). Start: `java -Xms… -Xmx… [JVM-Args] <Startargumente> nogui`,
  stdin = Konsole. Stop = `stop`, nach 60 s Prozessbaum beenden. Auto-Neustart nach Absturz (max. 3× in 10 min).
- `server://status` (ServerStatus inkl. `tunnel`), `server://log` ({server_id, lines}), `servers://changed/removed`.
  Spielerliste aus „joined/left the game“ und der `list`-Antwort.
- Schließen des Fensters mit laufenden Servern: Backend verhindert das Schließen und sendet
  `servers://close-requested {running}`; Frontend fragt und ruft `servers_quit(stop)` (beendet den Launcher).
  Weiterlaufende Server werden beim nächsten Start über `.vibe-pid` erkannt (`detached`: keine Konsole, Stopp = Beenden).
- Verbindungen: `local` (localhost + LAN-IP), `relay` (nur wenn `settings.vibe.enabled && hosting`; Vibey-Relay-Protokoll
  mit `hello` + `slot` (≥ 1), `kind: "server"`, `client: "launcher"`; Account über `auth.launch_account`; Adresse
  fest `relay.axolite.cc:25565` (früher `vibey.henny.dev:25565`, docs/DOMAINS.md) – keine eigene Relay-Adresse je Server; nur Debug-Builds: Env `VIBE_RELAY`), `playit` (offizieller `playitd`-Agent,
  SHA-256 aus der GitHub-API geprüft; Claim-Link -> `TunnelStatus.claim_url`, danach Adresse aus `/v1/agents/rundata`).
- Mod-Einordnung (Client/Server) über `server::sides::classify` (Heuristik über fabric.mod.json/quilt.mod.json/mods.toml
  + Liste bekannter Client-Mods) – Einstiegspunkt für eine spätere Einordnung aus dem Content-Modul.

## Regeln Frontend (UX-Vorgaben des Auftraggebers)

- **Kein komisches Scrollen**: Fenster scrollt nie. Jede Seite ist `h-full` und hat eigene Scroll-Container
  mit Klasse `scroll`. Keine horizontalen Scrollbalken, kein Smooth-Scroll.
- **Rechtsklick**: Browser-Menü ist global aus (`app/guards.ts`). Wo Rechtsklick sinnvoll ist (Instanz-Karten,
  Mod-Zeilen, Welten, Log-Zeilen …) eigenes Menü über `ContextMenu`/`ContextItem` aus `components/ui`.
- **Kein Lag**: lange Listen mit `@tanstack/react-virtual`; teure Arbeit nur im Backend; Bilder `loading="lazy"`
  `decoding="async"`; keine Re-Renders ganzer Listen bei Fortschritts-Events (Selektoren nutzen).
- **Keine Whitescreens / immer aktuelle GUI**: Ladezustände als Skeletons im Layout der echten Inhalte,
  `placeholderData` behält alte Daten; Fehler als `ErrorState` mit „Erneut versuchen“; Daten kommen live per Events.
- **Animationen**: kurz (120–180 ms), nur `opacity`/`transform`. Keine Seitenübergänge, die Inhalt verzögern.
- **Look**: Website von Vibe Craft Studios – Schwarz, Silkscreen-Überschriften (`.display`), Mono-Labels
  (`.label`, `.eyebrow`), eckig, 1-px-Linien (`border-line`/`border-line2`), Akzent `var(--accent)` (je Instanz
  über `style={{"--accent": farbe}}` setzbar), Tooltips im Minecraft-Stil.
- Texte nur über i18n (`useT()`), Deutsch + Englisch, eigene Datei pro Bereich.
- Nur Komponenten aus `components/ui` (bei Bedarf dort ergänzen, bestehende APIs nicht brechen).
- Externe Links öffnen automatisch im Systembrowser (`<a href="https://…">`).
- Dateien aufs Fenster ziehen: Tauri `getCurrentWebview().onDragDropEvent` (liefert Pfade).

## Frontend ohne Backend entwickeln (Mock)

`VITE_MOCK=1 pnpm vite --port <PORT>` startet das Frontend im normalen Browser mit simuliertem Backend
(`src/dev/mock/*`, wird im Produktions-Build nie geladen). Handler je Bereich: `src/dev/mock/a.ts` (Frontend A),
`src/dev/mock/b.ts` (Frontend B). Screenshots z. B. mit playwright-core + `chromium.launch({ channel: "msedge" })`.
Clips: `src/dev/mock/clips.ts` mit einem kleinen Test-Video (`src/dev/mock/assets/clips/`, FFmpeg `testsrc2`, nur
im Mock-Build); Galerie unter `#/screenshots?tab=clips`, Leerzustand mit `localStorage vl.mock.clips = "empty"`.

## Prüfen

- `pnpm typecheck`, `pnpm build`, `cd src-tauri && cargo check` / `cargo test`
- **Echte App testen ohne Vite** (mehrere Testläufe parallel möglich – eigenen Port + eigene Ordner wählen):
  ```bash
  pnpm install && pnpm build                                   # Frontend nach dist/
  cd src-tauri && cargo build --features tauri/custom-protocol # Debug-Build mit eingebettetem Frontend
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<PORT>   WEBVIEW2_USER_DATA_FOLDER=<TMP>/wv VIBE_LAUNCHER_HOME=<TMP>/home     ./target/debug/vibe-launcher.exe &
  ```
  Dann per CDP (playwright-core `chromium.connectOverCDP("http://127.0.0.1:<PORT>")`) Screenshots machen,
  klicken oder Commands direkt aufrufen: `page.evaluate(() => window.__TAURI_INTERNALS__.invoke("game_versions", {}))`.
  Beenden: `taskkill //F //PID <pid>` (nicht alle vibe-launcher.exe – andere Testläufe laufen evtl. parallel).
- `VIBE_LAUNCHER_HOME` gesetzt => Single-Instance-Sperre ist aus (Testmodus).

## Plattform-Funktionen (Frontend-Agent A)

- **Crash-Analyse** `crash_analyze(instance_id, crash_report?, exit_code?) -> Diagnosis[]`: regelbasiert über Crash-Report,
  `logs/latest.log` und Sitzungslog (fehlende Abhängigkeit, falsche MC-/Java-Version, Mixin, OOM, doppelte Mods, Grafik,
  verdächtige Mods, Exit-Codes). Aktionen (`DiagnosisAction`) führt das Frontend mit den vorhandenen Commands aus.
- **Server-Liste** `servers.dat` (unkomprimiertes NBT, unbekannte Felder bleiben erhalten); `server_ping` per Server-List-Ping
  (MOTD mit §-Codes, `§#rrggbb` für Hex-Farben). Während das Spiel läuft, ist `instance_servers_save` gesperrt.
- **Spielzeit**: jede Sitzung landet in `<daten>/sessions.jsonl` (`{instance_id,start,end,world?,server?}`); Quelle ist das
  Event `game://state` (Backend-Listener). `servers_recent` leitet „zuletzt gespielte Server“ daraus ab.
- **Optionen-Sync**: `<daten>/options-sync.json` (Master-Profil + je Instanz an/aus und Kategorien `controls|sound|video|language|accessibility`).
  Vor jedem Start (`instance_launch`) in `options.txt` geschrieben, nach dem Beenden zurückgeholt. Nur bekannte Schlüssel.
- **Discord Rich Presence**: Build-Env `VIBE_DISCORD_CLIENT_ID` (Repo-Variable); ohne ID aus. Respektiert `settings.discord_rpc`.
- **Externe Aktionen**: Kommandozeile `--launch <id>` (Verknüpfungen, Single-Instance reicht argv weiter) und Deep-Links
  `vibelauncher://install/<source>/<id>[?version=]`, `pack/<code>`, `launch/<id>`, `join/<adresse>[?instance=]`, `invite/<id>`.
  Backend prüft und reiht `AppAction`s ein, Event `app://actions` (ohne Payload) -> Frontend holt mit `app_actions_take` ab
  und fragt **immer** nach, bevor etwas passiert.
- **Vibe-Dienste im Frontend**: `useVibe()` aus `src/lib/vibe.ts` – jedes Vibe-UI-Element blendet sich aus, wenn der
  passende Schalter aus ist.

## Vibe-Dienste (Freunde, Chats, Presence, Einladungen, geteilte Modpacks)

Backend: `https://vibe.axolite.app` (früher `https://vibe.henny.dev`, siehe docs/DOMAINS.md; Repo `vibe-backend`, Protokoll REST `/api/v1/*` + Gateway `/ws`). Der Client ist das
**vendored SDK** `src/lib/vibe-sdk/` (`@vibe-craft/sdk` 0.1.0, MIT: `client.ts`, `gateway.ts`, `emitter.ts` unverändert bis
auf Importe; `types.ts` = öffentliche API-Typen aus `@vibe-craft/shared` als reine TS-Typen, ohne Admin-/Relay-Interna).

- **Transport über Rust** (`src/lib/vibe-sdk/tauri.ts`): `tauriFetch` -> `vibe_http` (nur URLs unter `<api_url>/api/`,
  Header `authorization|content-type|accept`), `TauriWebSocket` -> `vibe_ws_open/send/close` + Event `vibe://ws` (nur
  `ws(s)://<host>/ws` der eingestellten Adresse). Grund: CSP der Webview, frei wählbare `api_url`, kein CORS – und
  **`settings.vibe.enabled = false` sperrt jede Verbindung in Rust** (Commands liefern `not_configured`, offene WebSockets
  werden beim Speichern der Einstellungen geschlossen).
- **Adresse**: fest `https://vibe.axolite.app` – Nutzer können keine eigene Backend-Adresse einstellen (eine alte
  `settings.vibe.api_url` wird ignoriert). Nur Debug-Builds (`cfg(debug_assertions)`) lesen für die lokale Entwicklung
  die Env `VIBE_API_URL` (z. B. `http://127.0.0.1:3917`).
- **Login** (Mojang-hasJoined): SDK `auth.challenge` -> `vibe_mojang_join(serverId)` (Rust ruft
  `sessionserver.mojang.com/session/minecraft/join` mit dem Minecraft-Token des aktiven Accounts; bei 401/403 einmal
  Refresh; das Token verlässt Rust nie) -> `auth.verify`. **Automatisch**: Sobald ein Minecraft-Account angemeldet ist
  (und `settings.vibe.enabled`, Standard an), meldet sich der Launcher ohne Klick an und zeigt beim allerersten Mal
  einen Hinweis mit Link zu Einstellungen → „Vibe & Konto“. „Verknüpfung lösen“ = Logout am Backend + Tokens löschen +
  kein automatisches Verbinden mehr für diesen Account (lokal `localStorage["vibe.unlinked"]`), bis der Nutzer wieder
  „Verbinden“ klickt. „Vibe-Konto löschen“ = `DELETE /api/v1/me` `{confirm:true}` (Eingabe des Accountnamens zur
  Bestätigung), danach wie „Verknüpfung lösen“.
- **Tokens**: `vibe_tokens_get/set` (`StoredTokens` des SDK, camelCase) im Schlüsselbund unter `vibe:<account-id>` (gechunkt
  wie die MS-Tokens) zusammen mit der `api_url` – Tokens einer anderen Backend-Adresse werden nie herausgegeben. Refresh
  macht ausschließlich das SDK (rotierende Refresh-Tokens, Single-Flight). Nur Debug: ohne Account mit
  `VIBE_DEV_OFFLINE_ACCOUNT` gilt `dev-<name>` als Identität (für ein Backend mit `AUTH_DEV_BYPASS`).
- **Frontend** (`features/social`): `service.ts` hält VibeClient + VibeGateway je Account/Adresse, Gateway-Events ->
  Zustand-Store `useSocial` (Freunde inkl. Presence, Anfragen, Chats mit `unreadCount`, Tippen, Einladungen, Hosts) bzw.
  Query-Cache `["vibe","messages",chatId]` (Infinite Query, Seiten à 50, neueste zuerst; optimistische Nachrichten per
  `nonce`). Nach `ready` wird der Zustand per REST neu geladen, nach `resumed` nicht. `VibeBridge` (Shell) verbindet
  Einstellungen/Account mit dem Service, `SocialDialogs` hostet alle Dialoge.
- **Schalter**: `enabled` aus -> keine Verbindung, keine Social-UI (Hinweis in den Einstellungen). `social` -> Freunde/
  Chats/Einladungen-UI, Toasts. `presence` aus -> Gateway meldet `invisible` ohne Aktivität. `hosting` -> Einladen aus dem
  Server-Verbindungs-Tab, Limits. `sharing` -> „Als Link teilen“, Pack-Import.
- **Presence automatisch** aus `game://state` (laufende Instanz -> `playing` mit Name/Version/Loader) bzw. laufendem
  Relay-Server (`hosting`), sonst `launcher`. Nur bei Änderung gesendet.
- **Einladungen**: aus dem Verbindungs-Tab eines laufenden lokalen Servers bzw. aus einem Chat. Relay -> `hostSessionId`
  (eigene Host-Session mit gleicher Adresse) oder `connection: relay`; playit -> `connection: playit`; Lokal/LAN ->
  `connection: direct` mit LAN-Adresse (Hinweis „nur im selben Netzwerk“). Annehmen (`AcceptDialog`): passende Instanz
  (gleicher Pack-Code `source.kind = "vibe"`, sonst gleiche MC-Version/Loader) oder neue Instanz (Pack installieren bzw.
  Instanz anlegen), dann `instance_launch(..., server)` (Quick Play).
- **Geteilte Modpacks**: `vibe_pack_share(instanceId, token, options)` exportiert als `.vlpack` (vorausgewählte Einträge
  des Export-Dialogs) und lädt multipart hoch (`manifest`, `overrides` = Inhalt von `overrides/` **ohne** Präfix, `icon`);
  mit `options.code` als neue Version. Der Code wird in `instances/<id>/vibe-share.json` gemerkt (`vibe_pack_link`).
  `vibe_pack_install(code, versionId?, token?)` (Task `import`): Manifest + Overrides laden, Overrides-ZIP **streng prüfen**
  (`vibe::packs::check_overrides`: keine `..`, keine absoluten Pfade/Laufwerke/`:`/Backslashes, keine Windows-
  Gerätenamen, keine Symlinks, max. 100 000 Einträge/8 GiB – das Backend prüft das nicht), daraus ein temporäres `.vlpack`
  bauen und mit dem normalen Import einlesen (`PackSource { kind: "vibe", project_id: code, version_id }`).
- **Deep Links** `vibelauncher://pack/<code>` -> Pack-Dialog, `vibelauncher://invite/<id>` -> Annehmen-Dialog (beide
  fragen vor jeder Aktion).
