# Vertrag: Vibe Server Agent – REST- und WebSocket-API (v1)

Owner: **R1 Agent-Core** (Branch `henny/remote-agent-core`). Nutzer: Panel (R2), Launcher (R3/R4), Backend-Gateway (R5), Distribution (R6).
Stand: 21.11.2026 (Rev. 3: Pfade laut R6, Gateway laut `agent-gateway.md` von R5, Relay-Ticket laut `relay-ticket.md`, Panel-Wünsche R2) · API-Version **1** · Änderungen innerhalb v1 nur additiv (neue Felder/Endpunkte). Clients ignorieren unbekannte Felder.

Kopie im Repo: `docs/remote/agent-api.md` (dieselbe Datei). Doku/Betrieb: `docs/REMOTE-AGENT.md`.

---

## 1. Überblick

| Was | Wert |
|---|---|
| Programm | `vibe-agent` (Linux x64/arm64, Windows x64; Dienst oder Docker) |
| Standard-Port | **25580** (TCP), `--port` / `agent.toml: port` |
| Protokoll | HTTPS mit selbstsigniertem Zertifikat (Standard). `tls = false` nur hinter eigenem Reverse-Proxy |
| Basis-Pfad | `/api/v1` |
| Panel | `GET /` liefert das eingebettete Web-Panel (`agent/panel-dist/`), SPA-Fallback auf `index.html` für alle Pfade außer `/api/*` |
| Format | JSON (UTF-8), Zeiten in **Millisekunden seit Epoch** (`i64`), IDs als Strings |
| Header | Jede Antwort trägt `X-Vibe-Agent-Api: 1` |

Datenordner (alles, was der Agent schreibt): `--data-dir` / `VIBE_AGENT_DATA_DIR`, sonst Docker `/data`, Windows `%ProgramData%\VibeAgent`, Linux `/var/lib/vibe-agent`. Konfiguration liegt **im Datenordner** unter `<data>/config/` (`agent.toml`, `users.json`, `pairing.json`, `gateway.json`, `tls/cert.pem|key.pem`), weil der systemd-Dienst mit `ProtectSystem=strict` nur dort schreiben darf; abweichend mit `--config-dir` / `VIBE_AGENT_CONFIG_DIR`. Port/Adresse: `--port` / `VIBE_AGENT_PORT` (Standard 25580), `--bind` / `VIBE_AGENT_BIND` (Standard `0.0.0.0`); Flag > Umgebung > `agent.toml`. `/etc/vibe-agent/agent.env` ist nur das EnvironmentFile des systemd-Dienstes (R6). Audit-Log: `<data>/audit.log`.

CLI: `vibe-agent --version` · `run` (Vordergrund; SIGTERM/Strg+C stoppt erst alle Minecraft-Server) · `run --service` (Windows-SCM, Dienstname `VibeAgent`) · `pair [--role R] [--json]` (neuer Code; funktioniert bei laufendem Dienst über `<config>/pairing.json`) · `status [--json]` (Exit 0 = Agent dieses Datenordners antwortet) · `link` (Vibe-Konto koppeln, §7) · `service install|uninstall`. Nach einem Selbst-Update beendet sich der Agent mit Exit-Code **75** – die Dienstverwaltung muss neu starten (systemd `Restart=always`, Windows-Wiederherstellungsaktion „Neu starten“).

Server liegen unter `<data>/servers/<server_id>/` – gleiches Format wie im Launcher (`vibe-server.json`).

---

## 2. Kopplung (Pairing)

### 2.1 Kopplungscode
- Beim **ersten Start** (noch kein Benutzer) erzeugt der Agent einen Code und schreibt ihn ins Log/Terminal. `vibe-agent pair` erzeugt jederzeit einen neuen Code (alte unbenutzte Codes bleiben bis Ablauf gültig).
- Format: 8 Zeichen aus `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, angezeigt als `ABCD-EFGH`. Normalisieren: Großbuchstaben, ohne `-`/Leerzeichen.
- Gültigkeit **15 Minuten**, **einmalig**. Ein Code trägt eine Rolle (Standard: `owner`, wenn noch kein Besitzer existiert, sonst `admin`; `vibe-agent pair --role viewer` bzw. Einladung über die API).
- Ausgabe von `vibe-agent pair` (Distribution R6 zeigt das am Ende des Installers so an):
  ```
  Kopplungscode:  ABCD-EFGH   (15 Minuten gültig)
  Fingerabdruck:  3F:9A:…:C1  (SHA-256 des Zertifikats)
  Panel:          https://192.168.1.20:25580/
  ```
  Maschinenlesbar: `vibe-agent pair --json` → `{"code":"ABCD-EFGH","expires_at":…,"fingerprint":"3f9a…c1","urls":["https://…:25580/"]}`.

### 2.2 TLS-Fingerprint-Pinning
- Fingerprint = **SHA-256 über das DER-Zertifikat**, kleingeschrieben hex ohne Trenner (64 Zeichen). Anzeige mit `:` alle 2 Zeichen.
- Das Zertifikat wird beim ersten Start erzeugt (`<config>/tls/cert.pem`, `key.pem`; SANs: `localhost`, Hostname, alle lokalen IPs) und bleibt stabil. Eigene Zertifikate: `tls_cert`/`tls_key` in `agent.toml`.
- **Launcher (R3/R4):** erste Verbindung ohne CA-Prüfung, Fingerprint des präsentierten Zertifikats berechnen, damit die Kopplung durchführen (2.3), danach Fingerprint speichern und **jede** spätere Verbindung abweisen, deren Zertifikat nicht passt (Fehler „Zertifikat hat sich geändert“).
- **Panel im Browser:** Der Browser prüft TLS selbst (Nutzer akzeptiert das selbstsignierte Zertifikat einmal). Das Panel nutzt die Klartext-Variante (2.3 b).

### 2.3 `POST /api/v1/pair` (ohne Auth)
Zwei Varianten, Rate-Limit **5 Fehlversuche / Minute / IP** (danach `429 rate_limited`, `Retry-After`).

**a) Beweis-Variante (Launcher, empfohlen – Code verlässt den Rechner nie, schützt vor MITM):**
```json
{ "client_name": "Vibe Launcher (Hennys PC)", "client_kind": "launcher",
  "nonce": "<16–64 Zeichen zufällig, hex>",
  "fingerprint": "<vom Client gesehener Fingerprint>",
  "proof": "<hex HMAC-SHA256(key = normalisierter Code, msg = \"vibe-pair-v1|\" + fingerprint + \"|\" + nonce)>" }
```
Der Agent rechnet mit **seinem eigenen** Fingerprint nach (bei `tls=false`: leerer String). Passt kein aktiver Code → `401 pairing_failed`.

**b) Klartext-Variante (Panel im Browser):**
```json
{ "client_name": "Panel (Firefox)", "client_kind": "panel", "code": "ABCD-EFGH" }
```

**Antwort 200:**
```json
{ "token": "va_<43 Zeichen base64url>", "token_id": "tok_…",
  "user": { "id": "usr_…", "name": "…", "role": "owner" },
  "agent": { "id": "agt_…", "name": "…", "version": "0.1.0", "fingerprint": "3f9a…c1" },
  "server_proof": "<nur Variante a: hex HMAC-SHA256(code, \"vibe-pair-v1-ok|\" + fingerprint + \"|\" + nonce + \"|\" + token)>" }
```
Der Launcher prüft `server_proof` (beweist, dass der Agent den Code kennt) und speichert `token` + `fingerprint`.
`client_kind`: `launcher` | `panel` | `gateway` | `cli`. `user.name` = `client_name`, falls der Code einen neuen Benutzer anlegt; Einladungscodes (6.) binden an einen bestehenden Benutzer.

---

## 3. Authentifizierung

- `Authorization: Bearer va_…` an allen `/api/v1/*`-Endpunkten außer `GET /api/v1/info` und `POST /api/v1/pair`.
- WebSocket: Browser können keine Header setzen → `GET /api/v1/ws?token=va_…` **oder** erste Nachricht `{"t":"auth","token":"va_…"}` innerhalb von 10 s.
- Tokens werden im Agent nur als SHA-256-Hash gespeichert (`<config>/users.json`). Kein Passwort-Login.
- Token rotieren: `POST /api/v1/tokens/rotate` (altes Token sofort ungültig, Antwort `{token, token_id}`), widerrufen: `DELETE /api/v1/tokens/:token_id`.
- Rate-Limit pro Token: 600 Anfragen/Minute (`429 rate_limited`).
- Über das Gateway (7.) kommen Anfragen mit `X-Vibe-Gateway-User: <vibe user id>`; der Agent ordnet sie dem Benutzer zu, der beim Gateway-Link angelegt wurde (Rolle aus `users.json`).

---

## 4. Rollen und Rechte

| Recht | Bedeutung |
|---|---|
| `servers.read` | Liste, Status, Log, Properties/Spieler/Backups/Addons lesen, Ressourcen |
| `servers.control` | Start/Stopp/Neustart/Kill, Konsolenbefehle |
| `servers.manage` | Erstellen/Löschen/Einstellungen, Properties/Spieler/Whitelist/OPs ändern, Backups, Addons, Modpack-Upload, Tunnel |
| `files.read` / `files.write` | Dateibrowser im Server-Ordner |
| `agent.admin` | Benutzer/Einladungen/Tokens anderer, Agent-Einstellungen, Gateway-Link, Update, Audit-Log |

| Rolle | Rechte |
|---|---|
| `owner` | alle (genau ein Besitzer; kann nicht entfernt werden, nur übertragen) |
| `admin` | alle außer Besitzer ändern/entfernen |
| `operator` | `servers.read`, `servers.control`, `files.read` |
| `viewer` | `servers.read` |

Optional pro Benutzer `servers: ["id1","id2"]` (Standard `["*"]`) – Zugriff nur auf diese Server. Fehlendes Recht → `403 forbidden`.

---

## 5. Fehler

HTTP-Status + Body:
```json
{ "error": { "code": "server_running", "message": "Bitte den Server zuerst stoppen.", "kind": "invalid" } }
```
`message` ist deutsch und für Nutzer anzeigbar. `kind` = `AppError::kind()` des Launchers (gleiche Werte wie bei Tauri-Fehlern: `error`, `not_found`, `invalid`, `cancelled`, `not_configured`, `auth`, `network`, `io`, `json`, `zip`, `access`).

| `code` | HTTP | Wann |
|---|---|---|
| `unauthorized` | 401 | Token fehlt/ungültig |
| `pairing_failed` | 401 | Code/Beweis falsch oder abgelaufen |
| `forbidden` | 403 | Recht fehlt |
| `not_found` | 404 | Server/Datei/Backup/Task unbekannt |
| `invalid` | 400 | Eingabe ungültig |
| `path_denied` | 403 | Pfad außerhalb des Server-Ordners / geschützte Datei |
| `server_running` | 409 | Aktion nur bei gestopptem Server |
| `server_not_running` | 409 | Befehl an gestoppten Server |
| `conflict` | 409 | Port belegt, Name existiert … |
| `too_large` | 413 | Upload über dem Limit |
| `rate_limited` | 429 | Rate-Limit, `Retry-After` in s |
| `not_configured` | 424 | z. B. Relay-Identität fehlt, Gateway nicht gekoppelt |
| `upstream` | 502 | Mojang/Modrinth/Hangar/GitHub nicht erreichbar |
| `unsupported_api` | 426 | Client verlangt nicht unterstützte API-Version |
| `internal` | 500 | Sonstiges |

---

## 6. Endpunkte

Alle Pfade relativ zu `/api/v1`. „Task“ = lang laufende Aufgabe, Antwort `{"task_id":"…"}`; Fortschritt per WS-Event `task://update` oder `GET /tasks/:id`.

### 6.1 Agent
| Methode | Pfad | Recht | Antwort |
|---|---|---|---|
| GET | `/info` | – | `AgentInfo` |
| GET | `/me` | (auth) | `{ user, permissions: string[] }` |
| GET | `/agent/resources` | servers.read | `Resources` |
| GET | `/agent/settings` | agent.admin | `{ name, port, tls, gateway_enabled, relay: RelayIdentityInfo }` |
| PATCH | `/agent/settings` | agent.admin | Teilobjekt `{ name?, gateway_enabled? }` → neue Settings |
| GET | `/agent/audit?limit=200&before=<ms>` | agent.admin | `AuditEntry[]` (neueste zuerst) |
| GET | `/agent/update` | agent.admin | `{ current, latest, available: bool, notes_url? }` |
| POST | `/agent/update` | agent.admin | Task (lädt `agent-v<ver>` aus den GitHub-Releases, prüft SHA-256 aus `SHA256SUMS`, ersetzt Binary, Dienst startet neu) |

```ts
AgentInfo = { id, name, version, api_version: 1, min_api_version: 1, os: "linux"|"windows", arch: "x86_64"|"aarch64",
              tls: bool, fingerprint: string|null, paired: bool, gateway: { enabled: bool, connected: bool },
              started_at: ms }
Resources = { cpu_percent: number, cpu_cores: number, mem_total: bytes, mem_used: bytes,
              disk_total: bytes, disk_free: bytes, uptime_s: number,
              servers: [{ id, pid: number|null, cpu_percent: number, mem_bytes: number }] }
AuditEntry = { at: ms, user_id: string|null, user_name: string|null, ip: string|null, via: "direct"|"gateway"|"cli",
               action: string /* z. B. "server.start" */, target: string|null, ok: bool, detail: string|null }
```

### 6.2 Benutzer, Einladungen, Tokens
| Methode | Pfad | Recht | Body → Antwort |
|---|---|---|---|
| GET | `/users` | agent.admin | `User[]` |
| POST | `/users/invite` | agent.admin | `{ role, servers? }` → `{ code, expires_at }` (Kopplungscode, legt bei Einlösung neuen Benutzer an) |
| PATCH | `/users/:id` | agent.admin | `{ role?, servers?, name? }` → `User` |
| DELETE | `/users/:id` | agent.admin | 204 (widerruft alle Tokens) |
| POST | `/pair/codes` | agent.admin | `{ role? }` → `{ code, expires_at }` (wie `vibe-agent pair`) |
| GET | `/tokens` | (auth) | eigene Tokens `TokenInfo[]` (agent.admin: `?all=1`) |
| POST | `/tokens/rotate` | (auth) | → `{ token, token_id }` |
| DELETE | `/tokens/:id` | eigenes oder agent.admin | 204 |

```ts
User = { id, name, role: "owner"|"admin"|"operator"|"viewer", servers: string[], created_at, vibe_user_id: string|null }
TokenInfo = { id, user_id, client_name, client_kind, created_at, last_used_at: ms|null, last_ip: string|null }
```

### 6.3 Server (gleiche Typen wie Launcher `src-tauri/src/server`)
| Methode | Pfad | Recht | Body → Antwort |
|---|---|---|---|
| GET | `/servers` | servers.read | `ServerView[]` |
| POST | `/servers` | servers.manage | `ServerCreate` → `{ server, task_id }` (Installation startet sofort) |
| GET | `/servers/:id` | servers.read | `ServerView` |
| PATCH | `/servers/:id` | servers.manage | `ServerPatch` → `Server` |
| DELETE | `/servers/:id` | servers.manage | 204 (`409 server_running`) |
| POST | `/servers/:id/install` | servers.manage | `{ force?: bool }` → Task |
| POST | `/servers/:id/eula` | servers.manage | → `Server` (`eula=true`) |
| POST | `/servers/:id/start` | servers.control | 204 |
| POST | `/servers/:id/stop` | servers.control | 204 |
| POST | `/servers/:id/restart` | servers.control | 204 |
| POST | `/servers/:id/kill` | servers.control | 204 |
| POST | `/servers/:id/command` | servers.control | `{ command }` → 204 |
| GET | `/servers/:id/status` | servers.read | `ServerStatus` |
| GET | `/servers/statuses` | servers.read | `ServerStatus[]` |
| GET | `/servers/:id/log?after=<seq>` | servers.read | `LogLine[]` (Puffer, höchstens 2000 Zeilen; mit `after` nur neuere) |
| GET | `/servers/:id/addresses` | servers.read | `{ local, lan: string[], public: string|null, relay: string|null }` |

```ts
ServerView = Server & { status: ServerStatus|null }
Server = { id, name, icon, accent, mc_version, loader: { kind: "vanilla"|"fabric"|"quilt"|"forge"|"neoforge", version },
           platform: { kind: "paper"|"purpur"|"folia", build: string|null } | null, memory_mb, java_path, jvm_args, port,
           auto_start, auto_restart, connection: "local"|"relay"|"playit", eula, install_state:
           "not_installed"|"installing"|"installed"|"failed", created_at, last_started, source_instance, relay_slot,
           voice, bedrock }          // `launch` ist intern und kann fehlen
ServerCreate = { name, mc_version, loader, platform?, port?, memory_mb? }   // from_instance/mods/world werden ignoriert → Modpack-Upload (6.9)
ServerPatch = { name?, accent?, memory_mb?, java_path?, jvm_args?, port?, auto_start?, auto_restart?, connection? }
ServerStatus = { server_id, state: "starting"|"running"|"stopping"|"stopped"|"crashed", pid, started_at, players: string[],
                 max_players, exit_code, detached, tunnel: TunnelStatus|null }
TunnelStatus = { kind, state: "connecting"|"online"|"claim"|"error"|"stopped", address, claim_url, message, udp }
LogLine = Launcher-`LogLine` (u. a. `seq`, `time`, `level`, `text`)
```
`java_path` darf remote nur auf Javas im Agent-Datenordner oder in `agent.toml: allowed_java` zeigen (sonst `400 invalid`). `auto_start` = beim Start des Agents mitstarten.

### 6.4 Properties
| GET | `/servers/:id/properties` | servers.read | `[key, value][]` |
|---|---|---|---|
| PUT | `/servers/:id/properties` | servers.manage | `{ values: { key: value } }` → `[key, value][]` |
| GET | `/servers/:id/properties/raw` | servers.read | `text/plain` |
| PUT | `/servers/:id/properties/raw` | servers.manage | Body `text/plain` → 204 |

### 6.5 Spieler, Whitelist, OPs, Bans
| GET | `/servers/:id/players` | servers.read | `ServerPlayers` |
|---|---|---|---|
| POST | `/servers/:id/kick` | servers.control | `{ name, reason? }` → 204 (Name `[A-Za-z0-9_]{1,16}`, `409 server_not_running`) |
| POST | `/servers/:id/players/:list` | servers.manage | `{ action: "add"|"remove", name, reason? }` → `ServerPlayers` |
| PUT | `/servers/:id/whitelist` | servers.manage | `{ enabled: bool }` → `ServerPlayers` |

`:list` = `whitelist` | `ops` | `banned` | `banned_ips`. `ServerPlayers = { online, whitelist_enabled, whitelist, ops, banned, banned_ips }`.

### 6.6 Welten und Backups
| GET | `/servers/:id/worlds` | servers.read | `ServerWorld[]` |
|---|---|---|---|
| GET | `/servers/:id/backups` | servers.read | `ServerBackup[]` |
| POST | `/servers/:id/backups` | servers.manage | `{ world? }` → Task |
| DELETE | `/servers/:id/backups/:name` | servers.manage | 204 |
| POST | `/servers/:id/backups/:name/restore` | servers.manage | → Task (`409 server_running`) |
| GET | `/servers/:id/backups/:name/download` | files.read | `application/zip` |

### 6.7 Dateien (nur im Server-Ordner)
`path` ist relativ zum Server-Ordner, `/` als Trenner, leer oder führendes `/` = Wurzel des Server-Ordners.
| GET | `/servers/:id/files?path=` | files.read | `{ path, entries: [{ name, dir: bool, size, modified: ms }] }` |
|---|---|---|---|
| GET | `/servers/:id/files/content?path=` | files.read | Rohdaten (`application/octet-stream`, `Content-Disposition`) |
| PUT | `/servers/:id/files/content?path=` | files.write | Rohdaten (max. **512 MiB**) → 204; legt Elternordner an |
| POST | `/servers/:id/files/mkdir` | files.write | `{ path }` → 204 |
| POST | `/servers/:id/files/rename` | files.write | `{ from, to }` → 204 |
| DELETE | `/servers/:id/files?path=` | files.write | 204 (Ordner rekursiv) |

Pfadschutz: verboten sind Laufwerksbuchstaben/`:`, `..`, `\`-Pfade, NUL, und Ziele, die nach dem Auflösen von Symlinks außerhalb des Server-Ordners liegen → `403 path_denied`. `vibe-server.json` ist schreibgeschützt (`403 path_denied`). Schreibzugriffe auf laufende Server sind erlaubt (Nutzer-Verantwortung), außer `server.properties` (→ 6.4 benutzen).

### 6.8 Plugins und Mods
| GET | `/servers/:id/addons` | servers.read | `AddonList` |
|---|---|---|---|
| GET | `/servers/:id/addons/search?source=modrinth|hangar&query=&sort=relevance&offset=0` (`q` = Alias für `query`) | servers.read | `AddonSearch`; jeder Treffer mit `compat: { ok, reason: string|null, version: string|null }` (Loader/Plattform, MC-Version, `server_side`) |
| GET | `/addons/hangar/:project` | servers.read | `AddonProject` |
| POST | `/servers/:id/addons` | servers.manage | `{ source, project, version? }` → `string[]` (neue Dateien; Modrinth inkl. Pflicht-Abhängigkeiten). `version` = Modrinth-Version-ID (Entdecken-Seite wählt konkrete Version) |
| POST | `/servers/:id/addons/upload?filename=x.jar` | servers.manage | Rohdaten `.jar` (max. 256 MiB) → `string` (Dateiname) |
| GET | `/servers/:id/addons/updates` | servers.read | `AddonUpdate[]` |
| POST | `/servers/:id/addons/update` | servers.manage | `{ files?: string[] }` → `number` |
| PATCH | `/servers/:id/addons/:file` | servers.manage | `{ enabled }` → `string` (neuer Dateiname) |
| DELETE | `/servers/:id/addons/:file` | servers.manage | 204 |
| GET | `/servers/:id/extras` | servers.read | `ExtrasInfo` (Sprachchat/Bedrock) |
| PUT | `/servers/:id/extras` | servers.manage | `{ voice?, bedrock? }` → `ExtrasInfo` |

Kompatibilität (Loader/Version/`server_side`) prüft der Agent beim Installieren wie der Launcher (`server::plugins`). CurseForge: nur wenn `agent.toml: curseforge_api_key` gesetzt ist (sonst `424 not_configured`; Quelle `curseforge` ist für v1 reserviert).

### 6.9 Modpack-Upload (nur Server-Seite)
| POST | `/servers/import?format=mrpack|zip|vlpack&name=<Name>&server=<id?>` | servers.manage | Rohdaten (max. **2 GiB**) → `{ server, task_id }` |
|---|---|---|---|

- `mrpack`: `modrinth.index.json` lesen, MC-Version/Loader übernehmen, nur Dateien mit `env.server != "unsupported"` laden (Hash prüfen), `overrides/` und `server-overrides/` übernehmen (ohne `client-overrides/`).
- `zip`: ein Ordner-Archiv (`mods/`, `config/`, `world/` …, optional `vibe-server.json`-Ausschnitt mit `mc_version`/`loader`). Fehlen Version/Loader → `name`, `mc_version`, `loader`, `loader_version` als Query-Parameter Pflicht.
- `vlpack`: Vibe-Launcher-Pack-Export (`manifest.json` + Dateien). Client-only-Mods (`sides`-Prüfung des Launchers) werden ausgelassen.
- Mit `server=<id>`: bestehenden Server aktualisieren (Mods-Ordner ersetzen, Configs überschreiben, Welt bleibt), `409 server_running`, wenn er läuft.
- Der Launcher (R3/R4) packt eine Instanz dafür selbst als `mrpack` und lädt sie hoch.

### 6.10 Plattform- und Versionslisten (für den Erstellen-Assistenten)
| GET | `/catalog/minecraft` | servers.read | `[{ id, type: "release"|"snapshot"|…, release_time }]` |
|---|---|---|---|
| GET | `/catalog/loaders/:kind?mc=1.21.1` | servers.read | `[{ version, stable }]` (Loader-Versionen wie im Launcher, neueste zuerst) |
| GET | `/catalog/platforms/:kind` | servers.read | `PlatformVersion[]` |
| GET | `/catalog/platforms/:kind/builds?mc=` | servers.read | `PlatformBuild[]` |
| POST | `/servers/:id/platform/build` | servers.manage | `{ build: string|null }` → Task |

### 6.11 Tunnel / Relay
| GET | `/servers/:id/tunnel` | servers.read | `TunnelStatus|null` |
|---|---|---|---|
| POST | `/servers/:id/tunnel/reset` | servers.manage | 204 (neue Relay-Adresse bzw. playit neu verbinden) |
| GET | `/agent/relay` | servers.read | `RelayIdentityInfo = { configured: bool, source: "gateway"|"account"|null, name: string|null }` |

Verbindungsart über `PATCH /servers/:id { connection: "relay" }`. Der Vibey-Relay (≥ 1.7) braucht beim Agent **keine** Mojang-Sitzung: der Agent holt je Kontrollverbindung über die Gateway-WebSocket ein Relay-Ticket (`relay.ticket`, `agent-gateway.md` §3.5a), meldet sich mit `client:"agent"` an und beantwortet `challenge` mit `{"t":"auth","ticket":…}` (`relay-ticket.md`). Voraussetzung: Agent ist über Vibe gekoppelt und verbunden, sonst Tunnelstatus `error` mit `message` und `424 not_configured` bei `tunnel/reset`. Relay-Slots vergibt der Agent ab **32** (Launcher-Server ab 1). `playit` funktioniert ohne Konto (Claim-Link in `claim_url`).

### 6.12 Tasks
| GET | `/tasks` | servers.read | `TaskInfo[]` (laufende + letzte 50) |
|---|---|---|---|
| GET | `/tasks/:id` | servers.read | `TaskInfo` |
| POST | `/tasks/:id/cancel` | servers.manage | 204 |

`TaskInfo = { id, kind, title, instance_id /* = "server:<id>" */, progress: 0..1|null, message, status: "running"|"done"|"failed"|"cancelled", error, started_at, step? }`

---

## 7. Gateway („Über Vibe“, Owner Backend R5)
Details im Vertrag `agent-gateway.md` (R5). Agent-Seite:
| GET | `/agent/gateway` | agent.admin | `{ enabled, connected, linked: bool, vibe_user: { id, name }|null, last_error }` |
|---|---|---|---|
| POST | `/agent/gateway/link` | agent.admin | `{ code }` (Code aus dem Vibe-Konto, `agent-gateway.md` §2.5 → `POST $VIBE/api/v1/agent/link`) → Gateway-Status. **Ohne** Body: startet `POST $VIBE/api/v1/agent/pair/start` → Gateway-Status + `code` (Anzeige `K7Q2-M9XD`) + `expires_at`. Der Nutzer bestätigt den Code im Launcher/Panel (`POST $VIBE/api/v1/agents/claim`), der Agent pollt und verbindet sich danach selbst. CLI: `vibe-agent link [<code>]` |
| DELETE | `/agent/gateway/link` | agent.admin | 204 |

Das Gateway tunnelt **dieselben** REST-Aufrufe und WS-Nachrichten dieses Vertrags (Agent verarbeitet sie intern über denselben Router, inkl. Chunks/Uploads nach `agent-gateway.md` §3) – Panel/Launcher müssen nur die Basis-URL tauschen (`$VIBE/api/v1/agents/{id}/proxy/<pfad ohne /api/v1>`). Gateway-Anfragen authentifiziert der Agent über `user` im `req`-Rahmen: unbekannte Vibe-Nutzer legt er mit der Gateway-Rolle an (`owner` → Besitzer, falls es noch keinen gibt, sonst `admin`; `admin`; `viewer`), die eigene Rechteprüfung gilt zusätzlich. Ein WS über das Gateway braucht kein `{"t":"auth"}`.

---

## 8. WebSocket `GET /api/v1/ws`

Ein JSON-Objekt pro Textnachricht, Feld `t` = Typ.

**Server → Client**
```jsonc
{ "t": "hello", "agent": AgentInfo, "user": User, "api_version": 1 }
{ "t": "event", "event": "server://status", "data": ServerStatus }
{ "t": "event", "event": "server://log", "data": { "server_id": "…", "lines": LogLine[] } }   // gebündelt
{ "t": "event", "event": "servers://changed", "data": Server }
{ "t": "event", "event": "servers://removed", "data": { "id": "…" } }
{ "t": "event", "event": "task://update", "data": TaskInfo }
{ "t": "event", "event": "agent://resources", "data": Resources }      // alle 5 s, nur wenn abonniert
{ "t": "reply", "id": "<req id>", "ok": true, "data": … } | { "t": "reply", "id": "…", "ok": false, "error": { code, message, kind } }
{ "t": "pong" }
```
Ereignisnamen und Payloads sind **identisch** mit den Tauri-Events des Launchers, damit die Frontend-Abstraktion (lokal/remote) dieselben Handler nutzt.

**Client → Server**
```jsonc
{ "t": "auth", "token": "va_…" }                                       // nur wenn kein ?token=
{ "t": "subscribe", "topics": ["servers", "tasks", "log:<server_id>", "resources"] }
{ "t": "unsubscribe", "topics": ["log:<server_id>"] }
{ "t": "command", "id": "<req id>", "server_id": "…", "command": "say hi" }   // servers.control, 20/s
{ "t": "ping" }
```
`servers` = `server://status`, `servers://changed`, `servers://removed`. Logzeilen gehen nur an Clients, die `log:<id>` abonniert haben (beim Abonnieren werden die letzten 200 Zeilen als ein `server://log` nachgeschickt). Keepalive: Server sendet WS-Ping alle 30 s; ohne Antwort 90 s → Trennung.

---

## 9. Versionierung
- Pfad `/api/v1`; `GET /info` liefert `api_version` und `min_api_version`. Clients senden optional `X-Vibe-Api: 1`; ist das kleiner als `min_api_version` → `426 unsupported_api`.
- Agent-Versionen (SemVer, Tag `agent-v<version>`) sind unabhängig von der Launcher-Version. Breaking Changes nur mit `/api/v2` (v1 bleibt mindestens 6 Monate parallel).

## 10. Sicherheit (Zusammenfassung)
Selbstsigniertes TLS + Pinning, Kopplungscodes einmalig/15 min/Rate-Limit, Tokens nur gehasht, Rollen pro Benutzer, Dateizugriff nur im Server-Ordner (Symlink-sicher), Audit-Log (`<data>/audit.log`, JSON-Lines) für alle schreibenden Aufrufe, Agent läuft als eigener Benutzer `vibe-agent` (Linux) bzw. Dienstkonto, keine Shell-Befehle außer Java/Server-Start, Konsolenbefehle gehen nur an stdin des Minecraft-Servers.
