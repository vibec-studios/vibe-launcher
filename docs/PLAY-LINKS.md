# „Spiel mit mir“-Links, Discord-Status, Server-Regeln (Vertrag Backend · Launcher · Client)

Stand 2026-11-18. Gilt für Vibe-Backend, Vibe Launcher und Vibey Client. Änderungen nur gemeinsam, in dieser Datei.

## 1. Ablauf

1. Spieler A hostet seine Welt mit dem Vibey Client übers Relay (`<slot>.vibey.henny.dev`).
2. Der Client erstellt einen Spiel-Link beim Backend (§3) und zeigt „Einladungslink kopieren“ an. Dazu kommen die vorhandenen Einladungen an Freunde.
3. Spieler B öffnet `https://vibe.henny.dev/j/<code>`. Die Seite zeigt Host, Spiel und Modpack und hat den Knopf „Im Vibe Launcher öffnen“ (`vibelauncher://join/<code>`), mit Fallback „Vibe Launcher herunterladen“.
4. Der Launcher von B lädt die Details (§3) und fragt nach („Henny lädt dich ein: Cobblemon Abenteuer“). Dann:
   - Er nimmt eine passende vorhandene Instanz (gleiches Modpack, gleiche Version) oder legt eine an und installiert Modpack bzw. Mods.
   - Er startet direkt in die Welt (`--quickPlayMultiplayer <relay_host>`, bei alten Versionen `--server`).
5. Endet das Hosting, löscht der Client den Link. Spätestens nach 12 h läuft er ab.

## 2. Dateien in der Instanz (Launcher ↔ Client, lokal)

**`<instanz>/.vibe/instance.json`** schreibt der Launcher bei jedem Start. Der Client liest die Datei nur:

```json
{
  "schema": 1,
  "name": "Cobblemon Abenteuer",
  "mc_version": "1.21.1",
  "loader": { "kind": "fabric", "version": "0.16.9" },
  "pack": { "source": "modrinth", "project_id": "abc", "version_id": "def", "title": "Cobblemon Official" },
  "mods": [ { "source": "modrinth", "project_id": "AANobbMI", "version_id": "xyz" } ],
  "client_pack": "vibey"
}
```

- Regel: `pack` ist `null` bei Instanzen ohne Modpack. Dann listet `mods` alle Inhalte mit bekannter Quelle (Mods, Resourcepacks, Shader) und dem Feld `"kind"`.
- Inhalte ohne Quelle, also manuelle Dateien, stehen nicht drin. Der Client zählt sie und zeigt sie als Hinweis an.
- Ohne die Datei, etwa bei einem anderen Launcher, bekommt der Link nur MC-Version und Loader.
- **Dateinamen (ergänzt von vibey-client, optional):** Damit der Client manuelle Mods zählen kann, darf jeder
  `mods`-Eintrag `"file": "sodium-fabric-0.6.jar"` tragen (Dateiname in seinem Ordner), und `"known_files":
  ["mods/a.jar", …]` (Pfade relativ zur Instanz) listet zusätzlich Dateien mit bekannter Quelle, die nicht in `mods`
  stehen – vor allem die Dateien des Modpacks. Manuell = `.jar` in `mods/`, die in keinem der beiden vorkommt (Vergleich
  ohne Groß-/Kleinschreibung; `vibeyclient*.jar` zählt nie). Fehlen beide Felder, vergleicht der Client nur die Anzahl
  (`.jar` in `mods/` minus `mods`-Einträge mit `kind` `mod` oder ohne `kind`) und zeigt bei Modpacks keinen Hinweis.
  `file` und `known_files` gehen nicht an das Backend.

**`<instanz>/.vibe/session.json`** schreibt der Client, solange das Spiel läuft. Der Launcher liest sie für den Discord-Status:

```json
{ "schema": 1, "state": "menu|singleplayer|hosting|multiplayer", "server": "hypixel.net", "world": "Neue Welt",
  "play_link": "https://vibe.henny.dev/j/k3x9q2", "players": 3, "max_players": 8, "updated_at": 1795040000 }
```

- `server` nur bei `multiplayer`. Ein Server darf das über die Server-Regeln (§5) verbergen.
- `world` nur bei `singleplayer` bzw. `hosting`.
- Der Client löscht die Datei beim Beenden. Ist `updated_at` älter als 60 s, gilt sie als veraltet.
- **Ergänzt von vibey-client:** Der Client schreibt nur, wenn `<instanz>/.vibe/` existiert (der Launcher legt den Ordner
  mit `instance.json` an). Er schreibt bei jeder Änderung und sonst alle 15 s (Temp-Datei + Move). `play_link` gibt es
  nur bei `hosting`; `players` bei `hosting` (inkl. Host) und `multiplayer` (Tab-Liste), `max_players` nur bei
  `hosting`. Fehlende Felder sind weggelassen, nicht `null`. `server` fehlt auch, wenn der Spieler in Vibey
  „Serveradresse verbergen“ an hat. Mit der Client-Einstellung „Dem Launcher zeigen, was ich spiele“ aus gibt es
  keine Datei.

## 3. Backend

Auth: die Vibe-Session (wie in VIBE-API-2.md), für Client und Launcher.

| Methode | Pfad | Zweck |
|---|---|---|
| `POST` | `/api/v1/play-links` | Link anlegen. Body: `relay_host`, `mc_version`, `loader`, `pack`, `mods`, `client_pack`, `world_name`, `max_players` (Felder wie in `instance.json`). Antwort `{ code, url, expires_at }`. Pro Host gibt es nur einen aktiven Link, ein neuer ersetzt den alten. |
| `GET` | `/api/v1/play-links/<code>` | **Öffentlich**, ohne Login. Liefert Details plus `host: { uuid, name }`, `active` (Relay-Slot noch belegt) und `expires_at`. Unbekannte oder abgelaufene Codes geben `404`. |
| `DELETE` | `/api/v1/play-links/<code>` | Nur der Host. |
| `GET` | `/j/<code>` | HTML-Landingpage (Stil wie `/terms`): Skin-Kopf, Welt, Modpack, Knopf `vibelauncher://join/<code>`, Download-Fallback. Mit Open-Graph-Tags, damit die Vorschau in Discord gut aussieht. |

- Codes haben 6–8 Zeichen aus `[a-z0-9]`, ohne verwechselbare Zeichen.
- Rate-Limit: 10 neue Links pro Stunde und Nutzer. Ablauf nach höchstens 12 h.
- Die Mod-Liste wird beim Anlegen geprüft: Es sind nur `modrinth` und `curseforge` mit IDs erlaubt, höchstens 500 Einträge.
- Ob der Link noch aktiv ist, prüft das Backend beim Relay (vorhandene Admin-/Status-Schnittstelle), sonst über das Ablaufdatum.
  *(Backend, umgesetzt:)* Das Relay hat keine Status-Abfrage je Adresse (`/status` ist nur eine öffentliche Übersicht).
  `active` kommt deshalb aus den Relay-Ereignissen (`host_online`/`host_offline` → `host_sessions`): laufende Session des
  Hosts mit dieser Adresse → `true`, nur beendete → `false`, Adresse nie gemeldet → `true` bis zum Ablauf.
  Zusätzlich in der Antwort: `url`, `created_at`. `relay_host` muss unter `vibey.henny.dev` liegen
  (`PLAY_LINK_RELAY_DOMAINS`). Codes: 6 Zeichen aus `23456789abcdefghjkmnpqrstuvwxyz` (bei Kollision 8).
- **Ergänzt von vibey-client:** `relay_host` ist die volle Relay-Adresse, mit `:port`, wenn das Relay nicht auf 25565
  läuft (so wie sie `--quickPlayMultiplayer` braucht). `expires_at` ist ISO-8601 (der Client nimmt auch Unix-Sekunden).
  Antwort auf `POST` mit `201`. Der Client legt den Link neu an, wenn sich die Relay-Adresse ändert und 2 min vor
  Ablauf; er löscht ihn beim Ende des Hostens und beim Beenden (max. 2 s Wartezeit). Ohne die Route (`404`) oder bei
  `feature_disabled` blendet er den Knopf aus.

## 4. Discord-Status (Launcher)

- Der Launcher setzt Discord Rich Presence über IPC. Discord-Application-ID: Konstante `DISCORD_APP_ID` (nicht geheim, gehört der Vibe-Org).
- **Anzeige:**
  - Details: „Spielt <Instanz>“ bzw. „Im Launcher“.
  - Zeile 2 je nach `session.json`: „Hostet <Welt> (3/8)“, „Auf <Server>“ oder „Einzelspieler“.
  - Großes Bild: Instanz-Icon, wenn es öffentlich erreichbar ist (Modrinth-Icon-URL), sonst das Vibe-Logo.
  - Startzeit.
- **Knöpfe:** höchstens zwei URL-Knöpfe.
  - Beim Hosten mit `play_link`: „Beitreten“ → `play_link`.
  - Immer: „Vibe Launcher“ → Website.
- **Einstellung „Discord-Status“:** an/aus, Standard an. Dazu „Server und Welt anzeigen“, Standard an. Im Simple-Modus nur der Schalter.

## 5. Server-Regeln (Client ↔ Server)

- Ein Server schickt beim Join über den Plugin-Kanal `vibey:rules` ein JSON:

```json
{ "schema": 1, "disable": ["zoom", "freelook", "minimap", "hud.cps", "hud.coords", "hud.*", "emotes", "cosmetics.pets", "discord.server"],
  "message": "Auf diesem Server sind Zoom und Koordinaten aus." }
```

- Der Client schaltet die genannten Features ab, solange er auf dem Server ist. Er zeigt einmal einen Toast mit `message` und markiert die Features im HUD-Editor bzw. in den Modulen als „vom Server deaktiviert“.
- `discord.server` versteckt den Servernamen in `session.json`.
- Wildcards gibt es nur am Ende (`hud.*`). Unbekannte Schlüssel werden ignoriert.
- Der Client meldet sich mit `vibey:hello` (Version und unterstützte Schlüssel), damit Server-Plugins wissen, was geht.
- **Wire-Format (ergänzt von vibey-client, Details in `vibey-client/docs/SERVER-RULES.md`):** Der Body jeder Plugin-Message
  ist genau ein UTF-8-JSON-Objekt, ohne Längenpräfix (`player.sendPluginMessage(plugin, "vibey:rules", json)` reicht).
  `vibey:rules` max. 16 KiB, max. 256 Schlüssel à 64 Zeichen (`[a-z0-9_-]`-Segmente mit Punkt, optional `.*` am Ende,
  oder `*`), `message` reiner Text, max. 256 Zeichen; `schema` ≠ 1 wird ignoriert. Jedes Paket **ersetzt** die
  vorherigen Regeln, `{"schema":1,"disable":[]}` hebt sie auf. Hello:
  `{"schema":1,"client":"vibey-client","version":"…","supports":[…],"minecraft":"1.21.11","loader":"fabric"}` –
  zusätzliche Felder sind erlaubt, Empfänger ignorieren Unbekanntes.
- **Timing:** Der Client registriert `vibey:rules` direkt nach dem Join (`minecraft:register`); Server senden die Regeln,
  sobald sie diese Registrierung sehen (Bukkit: `PlayerRegisterChannelEvent`) und erneut nach dem Hello. Der Client
  schickt sein Hello, sobald der Server `vibey:hello` registriert hat (er prüft 30 s lang nach dem Join).
- **Kosmetik-Schlüssel:** `cosmetics.capes`, `cosmetics.wings`, `cosmetics.auras`, `cosmetics.pets`,
  `cosmetics.shields`, `cosmetics.hats`, `cosmetics.backs` (`cosmetics.*` = alle); `emotes` blockiert eigene Emotes
  und blendet die anderer Spieler aus.
- **Für Server:**
  - ein kleines Paper/Spigot-Plugin `VibeyRules` mit `config.yml`, im Repo vibey-client unter `server-plugins/`,
  - auf Fabric/NeoForge-Servern dieselbe Konfiguration im Server-Teil des Vibey-Jars,
  - Doku für Serverbetreiber in `docs/SERVER-RULES.md` (vibey-client).
