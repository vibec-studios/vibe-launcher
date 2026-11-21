# Beim Spielen schlank

Während Minecraft läuft, zerstört der Launcher sein Hauptfenster samt WebView und läuft nur mit dem Rust-Kern und einem Tray-Symbol weiter. Einstellung: **Einstellungen → Spiel → Spielstart → „Beim Spielen schlank“** (Standard an, auch im Simple-Modus) und **„Nach dem Spielen wieder öffnen“** (Standard an). Gespeichert als `settings.lean.{enabled, reopen}`.

## Ablauf

1. Eine Sitzung wechselt auf `running` → Wächter-Thread `lean-watch` startet (2-s-Takt, endet, sobald kein Spiel mehr läuft).
2. Fenster nicht im Vordergrund (nicht fokussiert, versteckt oder minimiert) seit 8 s und mindestens 10 s nach Spielstart → `lean://prepare` an das Frontend.
3. Frontend (`features/lean/LeanBridge.tsx`) meldet die aktuelle Route per `lean_handoff`. Antwortet es nicht innerhalb von 3 s, schließt Rust trotzdem.
4. Rust merkt sich Fensterposition/-größe, schließt die Gateway-WebSockets des Frontends (`vibe::ws::close_all`), zeigt das Tray-Symbol und ruft `destroy()` auf das Hauptfenster auf. `RunEvent::ExitRequested` wird solange verhindert.
5. Wiederöffnen: Linksklick aufs Tray-Symbol, Tray-Menü „Vibe Launcher öffnen“, Deep-Link/`--launch` (`platform::push_actions`), zweiter Start (Einzelinstanz), Spielende (wenn „wieder öffnen“ an) oder **immer** nach einem Absturz. Das Fenster wird aus der `tauri.conf.json`-Konfiguration neu erzeugt, Position/Größe/Maximiert wiederhergestellt; das Frontend holt per `lean_restore_take` die Route (bei Absturz `/instances/<id>` mit Absturz-Banner und Diagnose).
6. Nach einem Wiederöffnen gilt eine Schonfrist von 60 s, bevor das Fenster erneut geschlossen werden kann.

Schließt der Nutzer das Hauptfenster (X) während ein Spiel läuft, geht der Launcher ebenfalls in den Infobereich statt sich zu beenden (laufende lokale Server haben Vorrang mit ihrer Rückfrage).

## Tray

- Tooltip „Vibe Launcher – Minecraft läuft“.
- Menü: „Vibe Launcher öffnen“, „Konsole öffnen“, je laufende Sitzung ein Eintrag (öffnet die Konsole gezielt für diese Sitzung), „Beenden“.
- „Beenden“ während ein Spiel läuft: native Rückfrage. Das Spiel läuft weiter, die Sitzung wird aber nicht mehr erfasst.

## Was ohne Hauptfenster weiterläuft

| Bereich | Wo es läuft | Verhalten im Schlank-Modus |
| --- | --- | --- |
| Sitzungen, Logs, Crash-Erkennung | Rust (`minecraft::process`) | läuft weiter, Logs werden gepuffert, das Frontend lädt beim Öffnen nach (`game_states`, `instance_log_session`) |
| Konsolenfenster | eigenes kleines Fenster | darf offen bleiben, über das Tray gezielt öffnen |
| AFK (Events, Windows-Benachrichtigungen) | Rust (`afk`) | läuft weiter |
| Discord-Status | Rust (`platform::discord`) | läuft weiter |
| Spielzeit, Optionen-Sync nach Spielende | Rust (`platform`) | läuft weiter |
| Mehrfachstart | Rust | läuft weiter, Tray-Menü zeigt alle Sitzungen |
| Update-Hinweise | Frontend (`UpdateNotice`) | pausiert, Prüfung beim Wiederöffnen |
| Freunde, Chats, Einladungen, Presence | Frontend (Vibe-SDK, WebSocket in Rust nur als Transport) | pausiert, siehe unten |
| Remote-Server-Verbindungen | Frontend/Rust | pausieren, verbinden beim Öffnen neu |

## Abwägung Social-Gateway

Das Gateway-Protokoll (hello/identify/heartbeat/resume) und alle Benachrichtigungen leben im TypeScript-SDK; Rust hält nur die WebSocket-Verbindung als Transport.

| Option | RAM | Aufwand/Risiko |
| --- | --- | --- |
| A: Pausieren, beim Öffnen nachholen (umgesetzt) | 0 MB | gering. Das SDK baut beim Öffnen eine neue Sitzung auf und lädt Chats/ungelesene Nachrichten/Einladungen per REST (`reloadState`). Nachteil: während des Spielens keine Live-Benachrichtigung, Freunde sehen „offline“ statt „spielt“. |
| B: Verstecktes Hintergrundfenster nur fürs Gateway | +80–150 MB (eigener WebView2-Browser-, GPU- und Renderer-Prozess) | gering, macht aber den Zweck des Modus zunichte |
| C: Schlanke Gateway-Wache in Rust (identify, Heartbeat, Presence, `message.created`/`friend.request`/`invite.received` → Windows-Benachrichtigung über `afk::notify::toast`) | ≈ 0 MB | mittel: Token-Erneuerung (`/api/v1/auth/refresh`, Refresh-Token-Rotation) und Protokoll doppelt pflegen |

Gewählt ist A, weil es keinen Speicher kostet und keine zweite Protokoll-Implementierung braucht. C ist der empfohlene nächste Schritt, wenn Live-Benachrichtigungen und „spielt gerade“ während des Spielens gewünscht sind; die Bausteine (WebSocket in Rust, Tokens im Schlüsselbund, Windows-Toasts) sind vorhanden.

## Test-Hook

Nur Debug-Builds: `lean_dev_session { instanceId, running, stopAfterMs?, crash? }` legt eine Sitzung ohne echten Prozess an (wie Bedrock: `begin` + `mark_running`) und beendet sie optional nach `stopAfterMs` (mit `crash: true` als Absturz). Damit lässt sich der Schlank-Modus ohne Minecraft-Konto prüfen.

## Messung (21.11.2026, Debug-Build, Temp-Datenordner)

Simulierte Sitzung über `lean_dev_session` (kein echtes Minecraft, also ohne Java-Prozess), Prozessbaum des Launchers (`vibe-launcher` + `msedgewebview2` + `conhost`), Werte aus `Get-Process`.

| Zustand | Prozesse | WebView2-Prozesse | Privat | Working Set |
| --- | --- | --- | --- | --- |
| Fenster offen, Sitzung läuft | 8 | 6 | 177,1 MB | 398,3 MB |
| Schlank, Sitzung läuft (Lauf 1) | 2 | 0 | 12,9 MB | 104,1 MB |
| Schlank, Sitzung läuft (Lauf 2) | 2 | 0 | 11,6 MB | 54,7 MB |
| Nach Spielende wieder geöffnet | 8 | 6 | 218,5 MB | 492,3 MB |

Hinweis: In dieser Testumgebung lud die WebView das Frontend vom lokalen Dev-Server nur teilweise (Modul-Anfragen mit `ERR_CONNECTION_TIMED_OUT`). Rust-Seite (Zerstören, alle WebView2-Prozesse beendet, Neuaufbau nach Spielende und nach Absturz, Umschalten der Einstellung zur Laufzeit) ist damit geprüft, die Frontend-Übergabe (Route, Absturz-Seite) im echten Lauf noch nicht.
