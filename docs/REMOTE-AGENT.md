# Vibe Server Agent (`vibe-agent`)

Der Vibe Server Agent verwaltet Minecraft-Server auf einem anderen PC oder Server – mit **derselben** Server-Logik wie
der Launcher. Gesteuert wird er aus dem Vibe Launcher, über das eingebettete Vibe Panel im Browser oder über Vibe
(„Remote Control“ ohne Portfreigabe).

API-Vertrag: [`docs/remote/agent-api.md`](remote/agent-api.md) (Owner: Agent-Core). Gateway-Vertrag: `agent-gateway.md` (Backend).

## Aufbau im Repo

```
crates/vibe-server-core/   gemeinsames Crate (ohne Tauri): Server installieren/betreiben, Java, Downloads,
                           Loader-Installer (Fabric/Quilt/Forge/NeoForge), Paper/Purpur/Folia, Log4Shell-Schutz,
                           Relay/UDP/playit, Plugins/Mods, Backups, Modpack-Import (mrpack/zip/vlpack)
src-tauri/                 Launcher – nutzt das Crate (Re-Exporte unter crate::server, crate::net, crate::paths …)
agent/                     Programm vibe-agent (HTTP/WS-API, TLS, Kopplung, Panel, Gateway-Client, Dienst)
agent/panel-dist/          eingebettetes Web-Panel (Build von R2; Platzhalter-Seite, solange es fehlt)
```

Der Cargo-Workspace liegt in `src-tauri/Cargo.toml` (Mitglieder `.`, `../crates/vibe-server-core`, `../agent`),
damit Target-Ordner und `src-tauri/Cargo.lock` für die Launcher-Workflows gleich bleiben.

### Wie das Crate entkoppelt ist
- `vibe_server_core::Core` ersetzt `AppState` in der Server-Logik: Pfade, Netz, Aufgaben, `ServerStore`,
  `ServerManager`, API-Cache, Installations-Sperre, `Host`. Der Launcher-`AppState` enthält ein `Core` und
  dereferenziert darauf (`state.paths`, `state.servers` … funktionieren unverändert).
- Ereignisse gehen über den Trait `events::EventSink` (Launcher: `TauriSink` → Tauri-Events, Agent: Broadcast-Kanal →
  WebSocket). Ereignisnamen und Payloads sind identisch (`server://status`, `server://log`, `servers://changed`,
  `servers://removed`, `task://update`).
- Einstellungen und Konto kommen über den Trait `host::Host` (Java-Overrides/Auto-Java, Hosting an/aus,
  Relay-Identität). Launcher: `server::host::LauncherHost`, Agent: `agent/src/host.rs`.
- Gemeinsame Befehls-Logik (Installation starten, EULA, Properties, Backups, Tunnel, Plattform-Build) liegt in
  `vibe_server_core::server::ops` und wird von den Tauri-Befehlen und der Agent-API genutzt.

## Installation und Start

Einzeiler (Skripte von Distribution/R6): `curl -fsSL https://vibe.axolite.app/agent/install.sh | sh` bzw.
`irm https://vibe.axolite.app/agent/install.ps1 | iex`. Von Hand:

```sh
vibe-agent run --data-dir /srv/vibe-agent        # Vordergrund (Strg+C stoppt erst alle MC-Server)
vibe-agent pair                                   # neuer Kopplungscode + Zertifikat-Fingerabdruck + Panel-URL
vibe-agent status                                 # Exit 0 = läuft
vibe-agent link [<code>]                          # mit dem Vibe-Konto verbinden
sudo vibe-agent service install                   # systemd-Dienst (Linux) bzw. Windows-Dienst „VibeAgent“
```

| Option | Umgebung | Standard |
|---|---|---|
| `--data-dir` | `VIBE_AGENT_DATA_DIR` | Linux `/var/lib/vibe-agent`, Windows `%ProgramData%\VibeAgent`, Docker `/data` |
| `--config-dir` | `VIBE_AGENT_CONFIG_DIR` | `<data>/config` |
| `--port` | `VIBE_AGENT_PORT` | `25580` |
| `--bind` | `VIBE_AGENT_BIND` | `0.0.0.0` |
| – | `VIBE_AGENT_LOG` | `info` (z. B. `debug`, `vibe_agent=debug`) |

`<data>/config/agent.toml` (wird beim ersten Start angelegt): `name`, `port`, `bind`, `tls` (Standard `true`),
`tls_cert`/`tls_key` (eigenes Zertifikat), `gateway_enabled`, `api_url`/`gateway_url` (nur für Tests gegen ein
lokales Backend), `curseforge_api_key`, `allowed_java` (zusätzliche erlaubte Java-Ordner), `auto_java`, `hosting`,
`concurrent_downloads`.

Beim allerersten Start (noch kein Besitzer) schreibt der Agent einen Kopplungscode ins Log. Der erste eingelöste
Code macht den Client zum **Besitzer**; weitere Codes (`vibe-agent pair`, `POST /users/invite`) legen Admins bzw. die
gewählte Rolle an.

## Verbinden

**Direkt (LAN/öffentliche IP):** Launcher → „Remote-Server hinzufügen“ → Adresse + Kopplungscode. Der Launcher
koppelt mit der Beweis-Variante (HMAC über Code, Zertifikat-Fingerabdruck und Nonce – der Code verlässt den PC nicht),
speichert Token + Fingerabdruck und verbindet sich danach nur noch mit genau diesem Zertifikat.

**Panel im Browser:** `https://<adresse>:25580/` öffnen, Warnung zum selbstsignierten Zertifikat einmal bestätigen,
Kopplungscode eingeben.

**Über Vibe (ohne Portfreigabe):** entweder `vibe-agent link <code>` mit einem Code aus dem Launcher/Vibe-Konto, oder `vibe-agent link` (bzw. Panel → Einstellungen) zeigt einen Vibe-Code; im
Launcher/Panel mit dem freigeschalteten Vibe-Konto bestätigen. Der Agent hält dann eine ausgehende WSS-Verbindung zu
`wss://vibe.axolite.app/agent/ws` und beantwortet darüber dieselben API-Aufrufe (inkl. Live-Konsole, Downloads in
Blöcken, große Uploads).

## Sicherheit
- Selbstsigniertes TLS (rustls, kein OpenSSL), Fingerabdruck-Pinning im Launcher.
- Kopplungscodes: 8 Zeichen, 15 Minuten, einmalig; höchstens 5 Fehlversuche pro Minute und IP.
- Tokens (`va_…`) nur als SHA-256 gespeichert, rotierbar (`POST /tokens/rotate`), 600 Anfragen/Minute.
- Rollen `owner`/`admin`/`operator`/`viewer`, optional auf einzelne Server beschränkt.
- Dateizugriff nur im Ordner des jeweiligen Servers (keine `..`, keine Laufwerke, Symlinks werden aufgelöst),
  `vibe-server.json` ist schreibgeschützt; Java-Pfade nur aus dem Agent-Datenordner oder `allowed_java`.
- Audit-Log aller schreibenden Aktionen in `<data>/audit.log` (`GET /agent/audit`).
- Der Linux-Dienst läuft als Benutzer `vibe-agent` mit `ProtectSystem=strict` (schreibt nur im Datenordner).

## Selbst-Update
`POST /agent/update` lädt das neueste Release `agent-v<version>` aus `vibec-studios/vibe-launcher`, prüft SHA-256
gegen `SHA256SUMS`, ersetzt das Binary, stoppt alle MC-Server und beendet sich mit Exit-Code 75 – systemd
(`Restart=always`) bzw. die Windows-Dienst-Wiederherstellung startet den Agent neu.

## Tests

```sh
CARGO_TARGET_DIR=… cargo test -j 2 -p vibe-server-core          # Logik des Crates
CARGO_TARGET_DIR=… cargo test -j 2 -p vibe-launcher             # Launcher unverändert grün
CARGO_TARGET_DIR=… cargo test -j 2 -p vibe-agent                # Unit-Tests + API-Test (startet den echten Agent)
CARGO_TARGET_DIR=… cargo test -j 2 -p vibe-agent --test vanilla_server -- --ignored   # Vanilla-Server echt
```

Der Vanilla-Test lädt Java und den Server (~150 MB) in einen Temp-Ordner, startet den Server per API, prüft Konsole
(WebSocket) und Befehl und stoppt ihn wieder. Bitte nur laufen lassen, wenn sonst kein Minecraft läuft.

## Relay (Spieler-Tunnel `<name>.axolite.cc`)
Ist der Agent über Vibe gekoppelt, hostet er über den Vibey-Relay wie der Launcher – statt der Mojang-Sitzung holt er
pro Verbindung ein kurzlebiges Relay-Ticket über das Gateway (`relay.ticket`) und meldet sich mit `client:"agent"`
an. Relay-Slots der Agent-Server beginnen bei 32, damit sie nicht mit Launcher-Servern desselben Kontos kollidieren.
Ohne Vibe-Kopplung: playit.gg oder direkter Port.

## Panel einbetten
`pnpm run build:panel` baut das Panel (R2) nach `agent/panel-dist/` (nicht eingecheckt). Fehlt der Ordner, bettet
der Agent die Platzhalterseite aus `agent/panel-placeholder/` ein – der Build schlägt nie deswegen fehl.

## Offene Punkte
- CurseForge-Suche im Agent ist vorbereitet (`curseforge_api_key`), aber noch nicht angebunden.
- Relay mit Ticket ist gegen den Vertrag gebaut, aber nicht gegen einen echten Relay 1.7 getestet.
