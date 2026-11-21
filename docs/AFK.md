# AFK-Modus (Start im Hintergrund) – Experimentell

Eine Instanz läuft ganz normal mit allen Mods, aber ohne sichtbares Fenster, mit sehr niedriger Bildrate und ohne Ton.
Der Launcher zeigt Status, Chat (mit Eingabe), Ereignisse und Ressourcen und holt das Fenster jederzeit zurück.
Gilt für **jede** Java-Instanz (Vanilla, Fabric, Quilt, Forge, NeoForge, Modpacks), nicht für Bedrock.

Datei-Vertrag mit dem Spiel: [AFK-FILES.md](AFK-FILES.md). Der Helfer (Java-Agent) liegt in diesem Repo unter
`tools/afk-agent`, Doku [AFK-AGENT.md](AFK-AGENT.md), Recherche zu echtem Headless-Betrieb
[AFK-HEADLESS-RESEARCH.md](AFK-HEADLESS-RESEARCH.md). Der Launcher setzt Schema 1 um.

## Bedienung

| Ort | Was |
| --- | --- |
| Einstellungen → Spiel → **Experimentell** | „AFK-Modus“ (Feature-Flag, Standard **aus**). Darunter: „AFK jederzeit möglich“ (Standard an: Helfer bei jedem Start laden), Windows-Benachrichtigungen, Neu verbinden nach Abbruch (Standard aus), „Einstellungen senken, wenn der Helfer fehlt“, Hinweis zu Serverregeln. |
| Startknopf (Instanzseite, Startseite v1/v2) | Bei aktivem Flag ein Split-Knopf: Pfeil → „Im Hintergrund starten (AFK)“. Dialog: Ziel Hauptmenü / Server (Adresse oder gespeicherter Server) / Welt (Quick Play ab 1.20), Liste „Das geht bei dieser Instanz“, Serverregel-Hinweis. |
| Menü einer laufenden Sitzung (Split-Knopf „Stoppen“) | je Sitzung „In den Hintergrund“ / „Bildschirm wieder anzeigen“, „AFK-Ansicht öffnen“, weiterer AFK-Start. |
| Sitzungs-Chip oben rechts | Knopf „AFK“ (Mond = im Hintergrund). Klick: Kurzansicht mit Status, Gesundheit, letzten Chatzeilen, Knöpfen „Bildschirm wieder anzeigen“, „AFK-Ansicht öffnen“, „Beenden“. Ohne AFK-Daten: Mond-Knopf schickt die Sitzung in den Hintergrund. Im Dropdown (mehrere Sitzungen) je Zeile ein Umschalter. |
| Konsolenfenster (`console.html`) | Umschalter **Log / AFK**. Die AFK-Ansicht öffnet sich automatisch für Hintergrund-Sitzungen: Modus, Helfer-Zustand, Verbindung, Server/Welt, Gesundheit, Hunger, Laufzeit, CPU/RAM (`game_resources`), Fenster ausgeblendet/sichtbar, Chat mit Eingabe (Nachricht oder `/befehl`), Ereignisse (Tod, Trennung, Erwähnung/Flüstern als „vermutlich“, wenig Gesundheit/Hunger, Neu-verbinden-Versuche, Sende-Fehler). |

Der Launcher bewegt die Spielfigur nie und umgeht keine AFK-Kicks. Hinweise dazu stehen im Dialog, in den Einstellungen,
in der AFK-Ansicht und im Sitzungs-Log.

## Ablauf im Launcher (`src-tauri/src/afk/`)

| Datei | Aufgabe |
| --- | --- |
| `agent.rs` | Helfer-Jar: **gepinnte Version + SHA-256** (`AGENT_VERSION`, `AGENT_SHA256`), Download von `github.com/<GH_REPO>/releases/download/afk-agent-v<v>/vibe-afk-agent-<v>.jar` (0.1.0: `vibec-studios/vibey-client`, ab 0.1.1: `vibec-studios/vibe-launcher`) nach `<daten>/tools/afk-agent/<v>/vibe-afk-agent.jar`, Hash-Prüfung bei jedem Start. Debug-Builds: `VIBE_AFK_AGENT_JAR=<pfad>` ersetzt den Download. Mappings (`downloads.client_mappings` der Vanilla-Version, SHA-1 geprüft) nach `<daten>/afk/mappings/<version>.txt`. Unterstützungs-Matrix (Spielzustand/Senden: Vanilla/Fabric/Quilt ab 1.14.4, NeoForge ab 1.20.5, Forge ab 1.20.6; Fenster per Helfer ab LWJGL 3 = 1.13). |
| `launch.rs` | `prepare` (aus `minecraft/launch.rs`, vor „Startbefehl“): nur wenn Flag an und (AFK-Start oder „AFK jederzeit möglich“). Löscht `afk-events*.jsonl`, `afk-outbox.jsonl`, `afk-state.json`, schreibt `afk.json` (Modus, `background_fps: 2`, Ton aus, Fenster aus, Reconnect, Alarme, Mappings), setzt **ein** argv-Element `-javaagent:<jar>=<instanz>/.vibe` vor die Hauptklasse. |
| `overlay.rs` | Temporäre Änderung in `options.txt` mit Sicherung `.vibe/afk-options-backup.json`. Mit Helfer nur `pauseOnLostFocus:false` (Einzelspieler läuft weiter), ohne Helfer zusätzlich `maxFps:10`, `enableVsync:false`, `renderDistance:2`, `simulationDistance:5`, `soundCategory_master:0.0`, `particles:2`. Wiederherstellen setzt nur Werte zurück, die noch dem überlagerten Wert entsprechen (im Spiel geänderte Werte bleiben), entfernt neu hinzugefügte Schlüssel, erhält Reihenfolge und Zeilenenden. |
| `runtime.rs` | Abfrage jede Sekunde (nur wenn AFK-Sitzungen existieren): Ereignisse ab Byte-Offset mit `seq`-Prüfung und Rotation (`afk-events.1.jsonl`), `afk-state.json` (Fähigkeiten, Spielzustand, Herzschlag; > 15 s alt → Helfer gilt als fehlend), Fenster-Rückfall, Benachrichtigungen. Beim Prozessende (`process.rs`, vor dem Melden von „stopped“): `afk.json` löschen, Überlagerung zurücknehmen. Beim Launcher-Start: liegengebliebene Überlagerungen wiederherstellen (Absturz), außer ein Java-Prozess läuft noch in dem Spielordner. |
| `window.rs` | Windows-API (windows-sys): Fenster der Spiel-PID (inkl. Kindprozesse bei Wrappern) über `EnumWindows` finden (Klassen `GLFW30`, `LWJGL`), `ShowWindow(SW_HIDE)` (damit auch aus der Taskleiste), zurück mit `SW_SHOW`/`SW_RESTORE` + `SetForegroundWindow`. Vor `mode: foreground` ruft der Launcher `AllowSetForegroundWindow(pid)`, damit der Helfer das Fenster nach vorn holen darf; nach 2 s prüft er selbst und holt es notfalls nach vorn. Nur eigene Spielprozesse. |
| `logscan.rs` | Rückfall ohne Helfer: `[CHAT]`-Zeilen aus dem Spiel-Log → Chat, Erwähnung/Flüstern (Heuristik), Tod (eigener Name + Todesformulierung), Trennung. |
| `notify.rs` | Windows-Toast über PowerShell/WinRT (keine neue Crate; Texte als Umgebungsvariablen, XML-escaped). Nur im Hintergrund-Modus, je Art höchstens alle 15 s: Tod, Trennung (nicht „Welt verlassen“), Erwähnung/Flüstern, Neu-verbinden aufgegeben. |
| `registry.rs` | Sitzungs-Zustand je `run_id`, Ereignis-Puffer (500), Snapshot für das Frontend. |
| `commands.rs` | `afk_support(instanceId)`, `afk_sessions()`, `afk_events(runId)`, `afk_set_background(runId, background)`, `afk_send(runId, text)`. |

`instance_launch` hat den neuen optionalen Parameter `afk` (nur mit aktivem Flag, nicht für Bedrock).
Events: `afk://session` (Snapshot), `afk://event` (`{ run_id, instance_id, event }`).

### Wann wird was benutzt

| Lage | Fenster | Bildrate/Ton | Chat lesen | Senden/Spielzustand |
| --- | --- | --- | --- | --- |
| Helfer geladen, LWJGL 3 (ab 1.13) | Helfer | Helfer | Helfer (aus dem Log) | Helfer, wenn Mappings/Loader passen |
| Helfer geladen, LWJGL 2 (≤ 1.12.2) | Windows-API | Helfer | Helfer | – |
| Helfer fehlt (kein Netz, Hash falsch, Herzschlag weg) | Windows-API | `options.txt`-Überlagerung (nur bei AFK-Start, vor Spielstart) | Launcher-Log-Scan | – |
| Normal gestartet, „AFK jederzeit möglich“ aus | Windows-API | – (Hinweis in der Ansicht) | Launcher-Log-Scan | – |

Mehrfachstart: AFK-Dateien gibt es einmal pro Spielordner. Eine zweite Sitzung derselben Instanz bekommt keinen
Helfer und nur das Ausblenden per Windows-API.

## Mock (`VITE_MOCK=1`)

`src/dev/mock/afk.ts`: `localStorage["vl.mock.afk"] = "survival"` schaltet das Flag ein und startet für die laufende
Sitzung (zusammen mit `vl.mock.sessions = "survival"`) eine Hintergrund-Sitzung mit Verlauf. Ein AFK-Start aus dem Dialog
simuliert Helfer-Start, Chat, Status, Erwähnung und wenig Gesundheit; Senden erzeugt `outbox_ack` und eine Chat-Zeile.
`vl.mock.afk.ready = 1` zeigt den Helfer als bereits geladen.

## Helfer bauen und veröffentlichen

Eigenständiger Gradle-Build mit eigenem Wrapper (`tools/afk-agent`, keine Abhängigkeit zum Launcher-Code):

```
cd tools/afk-agent
./gradlew --max-workers=2 test shadowJar sha256
```

Ergebnis: `tools/afk-agent/build/libs/vibe-afk-agent-<v>.jar` + `.sha256`. Der Build ist reproduzierbar: aus dem
übernommenen Stand entsteht genau das veröffentlichte 0.1.0 (`67bf7fa4…fedca45`, 229 407 Bytes).

Neue Version:
1. `agent_version` in `tools/afk-agent/gradle.properties` erhöhen, nach `main` mergen.
2. `git tag afk-agent-v<v> && git push origin afk-agent-v<v>` → `.github/workflows/afk-agent.yml` testet, baut und
   legt das Release „Vibe AFK Agent <v>“ mit Jar + `.sha256` an (nie „Latest“, kostenloser `ubuntu-latest`-Runner).
   `release.yml` (`v*`), `agent-release.yml` (`agent-v*`) und `dev.yml` reagieren nicht; das Download-Center im
   Backend ignoriert `afk-agent-v*`.
3. In `src-tauri/src/afk/agent.rs` `AGENT_VERSION` und `AGENT_SHA256` (aus der `.sha256`-Datei) setzen, beim ersten
   Release aus diesem Repo (0.1.1) außerdem `GH_REPO = "vibec-studios/vibe-launcher"`.

## Tests

- Rust: `cargo test --lib afk::` – Datei-Vertrag (afk.json-Form, afk-state.json, Offset/`seq`/Rotation, Outbox),
  Optionen-Überlagerung (exakt zurück, im Spiel geänderte Werte bleiben, CRLF, fehlende Datei, Absturz/Backup),
  Fensterzuordnung (PID-Baum, Klassenwahl), Log-Heuristik, Benachrichtigungs-Regeln, Herzschlag, Agent-Argument,
  gepinnter Hash, Unterstützungs-Matrix.
- UI: Playwright-Durchklick gegen den Mock (v1/v2, hell/dunkel, Vibe Pixel, DE/EN).

## Bekannte Grenzen

- Der Helfer 0.1.0 kommt noch aus dem eingestellten Repo `vibec-studios/vibey-client` (Release bleibt nach dem
  Archivieren erreichbar). `AGENT_SHA256` stimmt mit dessen `.sha256`-Datei überein.
- „In den Hintergrund“ bei einer normal gestarteten Sitzung ohne Helfer kann Bildrate/Ton nicht senken und
  `pauseOnLostFocus` nicht mehr ändern (das Spiel liest `options.txt` nur beim Start).
- Die Outbox wird nicht gekürzt (Agent-Grenze 256 KiB ≈ 2000 Nachrichten pro Sitzung).
- Windows-Toasts in Debug-Builds erscheinen als „Windows PowerShell“, im installierten Launcher unter dessen App-ID.
