# Remote-Server im Launcher

Der Launcher steuert Minecraft-Server auf anderen Rechnern, auf denen der **Vibe Server Agent** läuft
(Vertrag: `docs/remote/agent-api.md`, Gateway: `agent-gateway.md` des Backends).

## Für Nutzer
- **Server → Remote-Server**: Assistent mit Installationsbefehl (Linux, Windows, Docker), danach verbinden.
  - **Direkt**: Adresse + Kopplungscode. Der Launcher zeigt den Zertifikat-Fingerabdruck zum Vergleichen an.
  - **Über Vibe**: Verbindungscode erzeugen und auf dem Rechner mit `vibe-agent link <code>` eintragen
    (nur mit Vibe-Konto und Beta-Zugang). Schon direkt gekoppelte Agents lassen sich mit einem Klick freischalten.
- Remote-Server stehen in der normalen Serverliste mit dem Hinweis **„Remote: <Rechner>“**. Konsole (live),
  Einstellungen/Properties, Spieler, Plugins/Mods, Welten & Backups und Verbindung/Relay funktionieren wie lokal.
  Dateien bearbeitet man im **Vibe Panel** („Panel öffnen“).
- **Neuer Server**: im letzten Schritt „Wo soll der Server laufen?“ einen verbundenen Rechner wählen
  (nicht bei „Aus Instanz“).
- **Verbundene Rechner** (Symbol neben „Remote-Server“): Status, Version, Umbenennen, Neu verbinden, Trennen, Panel.

## Technik
| Teil | Ort |
|---|---|
| Rust: Speicher, Pinning, HTTP-Proxy, WebSocket-Brücke | `src-tauri/src/remote/` (`remote_*`-Befehle) |
| Frontend-Abstraktion lokal/remote | `src/features/remote/dispatch.ts` (in `src/lib/api.ts` → `call()` und `addonsApi.ts` eingehängt) |
| Abbildung Tauri-Befehl → Agent-Pfad | `src/features/remote/routes.ts` |
| Events (Status, Log, Tasks) | Rust sendet `remote://ws` / `remote://state`, `RemoteBridge.tsx` übersetzt in die normalen `server://…`-Events |
| Mock (`VITE_MOCK=1`) | `src/dev/mock/remote.ts` (Raspberry Pi direkt, Mietserver über Vibe; `localStorage vl.mock.remote_offline=1` = Vibe-Agent offline) |

- Remote-Server-IDs: `rem~<agent-key>~<server-id>`, Agent-Key `d-<agent-id>` (direkt) bzw. `v-<agent-id>` (über Vibe).
  Ist ein Agent auf beiden Wegen verbunden, gilt der direkte Weg.
- Kopplung direkt: Beweis-Variante aus dem Vertrag (HMAC-SHA256 über Fingerprint + Nonce, Code verlässt den PC nicht),
  `server_proof` wird geprüft. Danach jede Verbindung nur mit genau diesem Zertifikat (SHA-256 des DER).
- Tokens liegen im OS-Schlüsselbund (`remote-agent:<key>`), die Agent-Liste in `<Datenordner>/remote-agents.json`.
- Über Vibe: `/api/v1/agents…` am Backend mit dem Vibe-Token (Wunsch-Vertrag `launcher-wunsch.md`).
