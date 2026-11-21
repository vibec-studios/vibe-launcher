# Sprachchat und Bedrock-Freunde für gehostete Welten (Nr. 4 und 28, Launcher-Seite)

Vertrag: `contracts/04-28-relay-udp.md` (Relay 1.5, `relay/UDP.md`).

## Server aus dem Launcher (dedizierte Server)

Hier ist der **Launcher der Host**, also baut er auch den UDP-Tunnel (Vertrag §4.1 nennt `server/relay.rs` ausdrücklich).

- **Verbindung → „Sprachchat & Bedrock“:** zwei Schalter (nur bei gestopptem Server).
  - Sprachchat installiert **Simple Voice Chat** (Modrinth `simple-voice-chat`) über die vorhandene Plugin/Mod-Schicht
    (Paper/Purpur als Plugin, Fabric/Quilt/NeoForge/Forge als Mod).
  - Bedrock-Freunde installiert **Geyser + Floodgate** (Modrinth `geyser`, `floodgate`; Paper/Purpur, Fabric, NeoForge).
  - Ausschalten deaktiviert die Dateien (`.disabled`), löscht nichts.
- **Vor jedem Start** (`server::extras::before_start`):
  - Relay: SVC `voice_host=24454`, `bind_address=127.0.0.1`, `port=<freier lokaler UDP-Port>` (Standard 24454);
    Geyser `bedrock.address 127.0.0.1`, `bedrock.port <frei>` (Standard 19132), `clone-remote-port false`, `motd1`,
    `remote` (bzw. `java` bei neuen Geyser-Configs) `address 127.0.0.1`, `port <Serverport>`, `auth-type floodgate`.
  - Lokal/playit: Standardwerte (alle Adressen, 24454 bzw. 19132, kein `voice_host`).
  - Pfade: `config/voicechat/voicechat-server.properties` bzw. `plugins/voicechat/…`; `config/Geyser-Fabric|Geyser-NeoForge/config.yml`
    bzw. `plugins/Geyser-Spigot/config.yml`. Fehlt die Datei, wird eine minimale angelegt (die Erweiterungen ergänzen den Rest).
- **Relay-Steuerung:** nach `ready` mit `features:["udp"]` sendet der Launcher `{"t":"udp","channels":[…]}`. `udp_ready`
  startet bzw. aktualisiert den Tunnel (`server/udp.rs`: HELLO sofort, alle 2 s bis ACK/30 s, dann alle 15 s; je
  Gegenstelle ein lokaler Socket nur zu `127.0.0.1:<Kanal-Port>`, 60 s Leerlauf → CLOSE, Nutzlast ≤ 2048 Byte).
  `udp_ok` = Tunnel steht. Ohne `udp_ready` nach 5 s bzw. ohne `features` → „nicht verfügbar“; ohne `udp_ok` 5 s nach
  `udp_ready` → „UDP blockiert“. `denied.<kanal>.code` wird übersetzt angezeigt.
- **Anzeige:** Status je Kanal und für Bedrock **Adresse und Port getrennt und kopierbar** (Port fest pro Konto und Slot).
  Ebenfalls im Server-Log.

## Welten aus dem Spiel (Vibey Client)

Der Vibey Client hostet integrierte Welten selbst über den Relay und setzt den Voice-Host per SVC-API. Der Launcher
bietet im Instanz-Tab „Welten“ nur „Sprachchat installieren“ (SVC in die Instanz über die Content-Schicht). Bedrock auf
integrierten Welten ist laut Vertrag nicht vorgesehen.

## Offen (nicht Launcher bzw. später)

- Host-Sessions/Einladungen/Play-Links tragen `voice`/`bedrock` noch nicht (Wunsch in Vertrag §5 an Backend). Erst damit
  kann der Launcher beim Beitreten SVC automatisch installieren. Die Werte stehen im Launcher bereit (`TunnelStatus.udp`).
- Kein TCP-Fallback bei blockiertem UDP (Relay-Grenze).
- Geyser-Konfigurationsformat: unterstützt `remote:` und das neuere `java:`; nicht gegen echte Geyser-Versionen getestet.

## Tests

`cargo test --lib server::udp server::extras server::relay`: Paketformat, echter UDP-Rundlauf (Relay-Attrappe ↔
Tunnel ↔ Echo-Server), YAML/Properties-Änderungen, `udp_ready`-Auswertung.
