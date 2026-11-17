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
| Spiel | game_versions, loader_game_versions, loader_versions, instance_install, instance_launch, instance_kill, game_states, instance_log_session, instance_log_files, instance_log_read, mclogs_upload, java_list, java_test, java_install |
| Inhalte | curseforge_available, content_search, content_categories, content_project, content_versions, content_install, content_list, content_set_enabled, content_remove, content_add_files, content_check_updates, content_update, worlds_list, world_delete, modpack_install, import_preview, import_pack, export_entries, export_instance, content_missing, content_missing_dismiss |

### Wichtige Abläufe

- **Import/Modpack-Installation** (`import_pack`, `modpack_install`): legt die Instanz an (`instances.insert_new`),
  ruft `task.set_instance(id)` (damit das Frontend die neue Instanz-ID aus dem Task kennt), lädt alle Dateien.
  Das Spiel selbst (Vanilla/Loader/Java) wird **nicht** im Import installiert – das passiert über
  `instance_install` (Frontend ruft es nach erfolgreichem Import auf) bzw. automatisch beim ersten Start.
- **CurseForge-Dateien ohne Drittanbieter-Freigabe** landen in `content_missing` (Frontend zeigt Banner mit Links).
- **Start** (`instance_launch`): installiert bei Bedarf, holt Zugangsdaten über `state.auth.launch_account(...)`,
  startet den Prozess, sendet `game://state` + `game://log`.
- **Accounts**: nur Microsoft (`AccountKind = "microsoft"`, keine Offline-Accounts). Login: `auth_msa_begin` -> Code
  anzeigen -> `auth_msa_wait` (liefert den Account) bzw. `auth_msa_cancel`. Tokens liegen im Windows-Schlüsselbund,
  `accounts.json` enthält keine Geheimnisse. `launch_account` erneuert den Minecraft-Token automatisch (< 5 min Rest);
  schlägt das wegen der Anmeldung fehl, wird `needs_relogin = true` gesetzt.
  Nur Debug-Builds (automatisierte Tests): `VIBE_DEV_OFFLINE_ACCOUNT=<Name>` -> ohne aktiven Account startet das Spiel
  mit einem Offline-Profil (nicht in UI/accounts.json, im Release wegkompiliert).

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

`app/EventBridge.tsx` hält damit React-Query-Caches und Stores aktuell – Seiten brauchen kein Polling.

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
