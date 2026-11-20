# Discord-Status (Rich Presence)

Der Launcher zeigt in Discord, was gerade läuft (Vertrag: [PLAY-LINKS.md](PLAY-LINKS.md) §4). Er spricht Discord über
die lokale IPC-Schnittstelle an (eigene kleine Umsetzung in `src-tauri/src/platform/discord.rs`, keine Fremd-Crate):
Windows `\\.\pipe\discord-ipc-N`, Linux/macOS `discord-ipc-N` im Laufzeitordner (auch Flatpak/Snap).
Ist Discord nicht installiert oder geschlossen, passiert nichts; der Launcher versucht es alle 15 s still erneut und
merkt spätestens nach 60 s, wenn Discord neu gestartet wurde.

## Anzeige

| Zustand | Zeile 1 | Zeile 2 | Knöpfe |
|---|---|---|---|
| Kein Spiel läuft | „Im Launcher“ | – | „Vibe Launcher“ |
| Spiel ohne Vibey Client | „Spielt <Instanz>“ | Server bzw. „Einzelspieler“ aus dem Start, sonst Loader + Version | „Vibe Launcher“ |
| `session.json`: `menu` | „Spielt <Instanz>“ | „Im Hauptmenü“ | „Vibe Launcher“ |
| `singleplayer` | „Spielt <Instanz>“ | „Einzelspieler“ | „Vibe Launcher“ |
| `multiplayer` | „Spielt <Instanz>“ | „Auf <Server>“ (ohne Details oder per Server-Regel versteckt: „Im Mehrspieler“) | „Vibe Launcher“ |
| `hosting` | „Spielt <Instanz>“ | „Hostet <Welt> (3/8)“ (ohne Details: „Hostet eine Welt (3/8)“) | „Beitreten“ → Spiel-Link, „Vibe Launcher“ |

- Bilder: siehe [Bilder](#bilder).
- Startzeit: Start des Spiels bzw. des Launchers.
- Den Spiel-Link zeigt der Launcher nur, wenn er auf das Vibe-Backend zeigt (`https://axolite.cc/j/<code>`; alte Links `https://vibe.henny.dev/j/<code>` älterer Clients gelten weiter).
- `session.json` liest der Launcher alle 10 s, solange ein Spiel läuft. Älter als 60 s = veraltet (wird ignoriert).
- Texte auf Deutsch oder Englisch, je nach Launcher-Sprache.
- Einstellungen → Vibe & Konto → Discord: „Discord-Status“ (an/aus, Standard an), im Expert-Modus „Server und Welt
  anzeigen“ (Standard an), dazu die Bildauswahl mit Vorschau.

## Bilder

Discord zeigt ein großes Bild und unten rechts ein kleines, rundes Bild. Beides ist entweder ein Asset-Key aus dem
Developer Portal oder eine öffentliche `https://`-URL (Discord lädt sie über seinen Media-Proxy). Lokale Dateien oder
`data:`-URLs gehen nicht. Auswahl und Rückfälle stehen in `src-tauri/src/platform/presence_art.rs`.

Einstellungen (`settings.json`, fehlende Felder = Standard):

| Feld | Werte | Standard |
|---|---|---|
| `discord_large` | `logo` \| `app_icon` \| `head` \| `custom` | `logo` |
| `discord_pack_icon` | `true` \| `false` („Modpack-Icon bevorzugen“ = Automatisch) | `true` |
| `discord_small` | `head` \| `loader` \| `none` | `head` |
| `discord_image` | Pfad in `<daten>/app-icon/discord-*.png\|jpg` | `null` |

Großes Bild:

1. Ist `discord_pack_icon` an und spielt man ein Modrinth-Modpack: dessen Icon (öffentliche URL).
2. Sonst `discord_large`:
   - `logo`: Asset `logo`.
   - `app_icon`: Robbe bzw. Pinguin aus den App-Icon-Einstellungen. In Standardfarbe (`#8b6cff`) sind das die Assets
     `seal` bzw. `penguin`. Eigene Farbe oder eigenes App-Icon-Bild: ohne Upload zeigt Discord das Motiv in
     Standardfarbe (eigenes App-Icon-Bild → `seal`).
   - `head`: Spielerkopf des aktiven Microsoft-Kontos, `https://mc-heads.net/avatar/<uuid ohne Bindestriche>/256`.
     Kein Konto angemeldet → `logo`.
   - `custom`: eigenes Bild. Ohne Upload zeigt Discord `logo`.

Kleines Bild:

- `head` (Standard): Spielerkopf des aktiven Microsoft-Kontos, `https://mc-heads.net/avatar/<uuid>/128`, Text =
  Spielername. Auch im Launcher ohne laufendes Spiel. Kein Konto angemeldet (oder nur das Offline-Profil aus
  `VIBE_DEV_OFFLINE_ACCOUNT` in Debug-Builds) → Loader, im Launcher nichts. Ist der Kopf schon das große Bild, zeigt
  das kleine den Loader.
- `loader`: Loader-Asset (`fabric` …), Text = Loader und Version. Im Launcher nichts.
- `none`: kein kleines Bild.

Eigene Farben und Bilder kann Discord nur über eine öffentliche URL zeigen. Ein Upload ins Vibe-Backend (mit Moderation)
ist noch nicht gebaut; der Erweiterungspunkt ist `presence_art::hosted_url` (liefert heute immer `None`). Bis dahin
steht in den Einstellungen der Hinweis, dass das Standard-Icon genutzt wird.

## Einrichten (einmalig, Vibe-Org)

1. <https://discord.com/developers/applications> öffnen und mit dem Konto der Vibe-Org anmelden.
2. **New Application** → Name `Vibe Launcher` (dieser Name steht in Discord als „Spielt Vibe Launcher“).
   Den Nutzungsbedingungen zustimmen, **Create**.
3. Unter **General Information** die **Application ID** kopieren (nur Ziffern, nicht geheim).
   Optional: App-Icon = `docs/discord-assets/logo.png`, Beschreibung, Website `https://vibe.axolite.app/`.
4. Links **Rich Presence → Art Assets** öffnen und mit **Add Image(s)** diese Dateien aus `docs/discord-assets/`
   hochladen. Der Dateiname ohne `.png` ist der Key. Die Keys müssen genau so heißen:

   | Key | Datei | Größe | Verwendung |
   |---|---|---|---|
   | `logo` | `logo.png` | 1024×1024 | großes Bild (Standard) |
   | `seal` | `seal.png` | 1024×1024 | großes Bild: App-Icon Robbe |
   | `penguin` | `penguin.png` | 1024×1024 | großes Bild: App-Icon Pinguin |
   | `vanilla` | `vanilla.png` | 512×512 | kleines Bild: Vanilla |
   | `fabric` | `fabric.png` | 512×512 | kleines Bild: Fabric |
   | `quilt` | `quilt.png` | 512×512 | kleines Bild: Quilt |
   | `forge` | `forge.png` | 512×512 | kleines Bild: Forge |
   | `neoforge` | `neoforge.png` | 512×512 | kleines Bild: NeoForge |

   `seal.png` und `penguin.png` kommen aus demselben Renderer wie das App-Icon (Standardfarbe). Neu erzeugen:
   `cargo test --lib export_discord_assets -- --ignored` in `src-tauri/`.

   **Save Changes**. Neue Assets brauchen bei Discord manchmal einige Minuten, bis sie angezeigt werden.
5. Die ID in `src-tauri/src/platform/discord.rs` eintragen: `pub const DISCORD_APP_ID: &str = "<Application ID>";`
   (Alternative ohne Code-Änderung: beim Build die Umgebungsvariable `VIBE_DISCORD_CLIENT_ID` setzen.)
6. Bauen und testen: Discord-App öffnen, Launcher starten → im eigenen Profil steht „Im Launcher“. Unter
   Discord-Einstellungen → **Aktivitätsprivatsphäre** muss „Aktuelle Aktivität als Statusmeldung teilen“ an sein.

Die Knöpfe („Beitreten“, „Vibe Launcher“) brauchen keine Einstellung im Developer Portal. Hinweis von Discord:
Die eigenen Knöpfe sieht man im eigenen Client nicht anklickbar, nur andere Nutzer können sie anklicken.

Leer gelassene ID = Rich Presence aus; in den Einstellungen steht dann „In diesem Build nicht verfügbar“.
