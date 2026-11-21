# Mehrfachstart & Konsolenfenster

Eine Instanz kann mehrmals gleichzeitig laufen. Der Launcher führt dafür **Sitzungen** (Runs) statt
„Instanz läuft ja/nein“. Dazu gibt es ein optionales, schlankes **Konsolenfenster** (wie bei NoRiskClient).

## Sitzungsmodell (Backend)

- `src-tauri/src/minecraft/sessions.rs` – reine Registry (getestet): Sitzungen nach `run_id`
  (`run-<n>`), je Sitzung Zustand, PID, Account, Welt/Server, Start/Ende, Log-Puffer (max. 50 000 Zeilen),
  Token-Maskierung, Spielzeit-Uhr je Instanz.
- `src-tauri/src/minecraft/process.rs` – `GameManager` (Events, Prozess übernehmen, Crash-Erkennung).
  Methoden nehmen einen **Schlüssel**: eine `run_id` oder eine Instanz-ID. Eine Instanz-ID meint die
  neueste, bevorzugt laufende Sitzung der Instanz (so funktionieren alte Aufrufer wie
  `launcher_line(instance_id, …)` weiter).
- `GameState` (Event `game://state`, Command `game_states`) hat neu: `run_id`, `slot` (Nummer unter den
  gleichzeitigen Sitzungen der Instanz: 1, 2, …), `created_at`, `ended_at`, `account_name`, `account_uuid`,
  `world`, `server`.
- `game://log` trägt `run_id` + `instance_id`.

### Regeln

| Thema | Verhalten |
| --- | --- |
| „Instanz läuft“ | solange ≥ 1 Sitzung `preparing`/`running` ist (`is_running`). Alle Sperren (Backups, Snapshots, Server-Liste, Optionen-Sync, Reparatur, Inhalte) prüfen das weiter pro Instanz. |
| Stoppen | `instance_kill(id, run_id?)`: mit `run_id` nur diese Sitzung, sonst alle Sitzungen der Instanz. |
| Spielzeit | Uhr je Instanz läuft von der ersten bis zur letzten laufenden Sitzung – überlappende Sitzungen zählen nicht doppelt. `playtime_sessions` liefert je Instanz höchstens einen laufenden Eintrag. |
| Discord / Statistik / Optionen-Sync | `platform::on_game_state` schließt eine Sitzung erst ab, wenn kein Prozess der Instanz mehr läuft. Optionen-Sync und Server-Liste werden bei weiteren Sitzungen nicht vor dem Start angewendet. |
| Hosting / Play-Links | `play_sessions` liefert je Instanz einen Eintrag (`.vibe/session.json` gibt es nur einmal pro Spielordner). |
| Bedrock | nur eine Sitzung (`begin_exclusive`) – das Spiel lässt sich nicht mehrfach starten. |
| Abgelaufene Sitzungen | beim nächsten Start der Instanz verworfen; sonst höchstens 3 je Instanz / 8 insgesamt. |

### Konflikte beim Mehrfachstart derselben Instanz

- **Vorbereitung:** Auto-Update der Inhalte und Welt-Backups laufen nur, wenn die
  Instanz noch nicht läuft (sonst würden Dateien unter einem laufenden Spiel ersetzt). Installation/Natives
  sind bereits parallel-sicher (gesperrte Dateien bleiben stehen).
- **Welt-Lock:** Quick-Play in eine Welt, die in einer anderen Sitzung offen ist, wird abgelehnt.
  Minecraft selbst schützt Welten zusätzlich über `session.lock`.
- **Log-Dateien:** Ab Sitzung #2 bekommt das Spiel eine angepasste Log4j-Konfiguration
  (`assets/log_configs/vibe-session-<n>-*.xml`) und schreibt nach `logs/vibe-session-<n>/latest.log`, damit
  die erste Sitzung ihr `latest.log` behält (gilt, wenn die Version eine Logging-Konfiguration mitbringt –
  bei Forge-eigenen Konfigurationen nicht). Endet eine Sitzung, die parallel lief, speichert der Launcher
  ihr komplettes Konsolen-Log zusätzlich unter `logs/vibe-sessions/<zeit>-session-<n>.log`.
- **Crash-Reports:** ein Report wird genau einer Sitzung zugeordnet; liefen Sitzungen parallel, zählt ein
  Report nur bei Exit-Code ≠ 0.
- **Gleicher Account:** Läuft der Account schon in einer Sitzung, fragt die Oberfläche vor dem Start und
  bietet einen anderen Account an (`AccountConflict.tsx`). Das Backend schreibt zusätzlich eine Warnung
  ins Log der neuen Sitzung.
- `options.txt`/`servers.dat` schreibt das Spiel beim Beenden – es gewinnt die zuletzt beendete Sitzung.

## Oberfläche

- **Start-Knopf** (`PlayButton`): läuft die Instanz, zeigt er „Stoppen“ plus Menü (Split-Button) mit
  „Erneut starten (weitere Sitzung)“, „Konsole öffnen“ und – bei mehreren – „Sitzung #n stoppen“.
  Gilt für Kacheln, Liste, Instanzseite, Startseite v1/v2 und den Simple-Modus. Das Kontextmenü hat
  denselben Eintrag.
- **Topbar** (v1 `Shell.tsx`, v2 `TopbarV2.tsx`, gemeinsam `app/RunningSessions.tsx`): direkt neben dem
  Account eine Sitzung als Chip; ab zwei Sitzungen ein Dropdown mit Icon, Name, Account, Laufzeit und
  Aktionen Konsole / zur Instanz / Stoppen.
- **Logs-Tab:** bei mehreren Sitzungen eine Live-Quelle je Sitzung; Knopf „Konsole öffnen“.

## Konsolenfenster

- Einstellung **Spiel → Starten → „Konsolenfenster beim Spielstart öffnen“** (`console_on_launch`,
  Standard aus). Manuell jederzeit über „Konsole öffnen“ (Command `console_open(run_id?)`).
- Eigenes Webview-Label `console`, eigener Vite-Einstieg `console.html` → `src/console/main.tsx`. Lädt nur
  React, die Tauri-API, Icons, den Spiel-Store und die Sitzungs-Texte (kein Router, kein React Query, kein
  Radix, nicht das ganze i18n).
- Inhalt: Sitzungen als Tabs (Status, Name, #, Account), Live-Log (virtualisiert) mit Suche,
  Ebenen-Filter, Auto-Scroll, Umbruch, Kopieren, Log-Ordner, Stoppen; Fußzeile mit Status, Account, PID,
  Laufzeit.
- Schließen beendet das Spiel nicht. Wird das Hauptfenster geschlossen, schließt sich die Konsole mit.
- Rechte: `src-tauri/capabilities/console.json` – nur `core:event:allow-listen/unlisten` und
  `clipboard-manager:allow-write-text` (App-Commands sind ohne App-Manifest für alle Fenster erlaubt).

## Mock (`VITE_MOCK=1`)

- `src/dev/mock/sessions.ts` simuliert mehrere Sitzungen je Instanz (eigene Logs, Slots, Accounts).
- Vorbelegen: `localStorage["vl.mock.sessions"] = "survival,survival:1,hh-armors"` startet beim Laden
  sofort laufende Sitzungen (`:<n>` = Account-Index). Funktioniert auch in `console.html`, das im Mock
  einen eigenen simulierten Zustand hat.
- „Konsole öffnen“ öffnet im Browser `console.html` in einem neuen Fenster.
