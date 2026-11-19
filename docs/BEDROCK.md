# Minecraft Bedrock im Vibe Launcher

Bedrock ist ein eigener, schlanker Instanztyp neben den Java-Instanzen. Der Launcher **startet das installierte
Spiel**, verwaltet **Add-ons, Welten und Sicherungen** und gibt jeder Instanz auf Wunsch **eigene Spieldaten**.
Nicht enthalten (bewusst): Versionsauswahl/alte Versionen, Code-Mods/DLL-Injection, eigener Login (das Spiel meldet
sich selbst bei Xbox an).

Code: `src-tauri/src/bedrock/` (Backend), `src-tauri/src/commands/bedrock.rs` (Commands),
`src/features/bedrock/` (Oberfläche), `src/dev/mock/bedrock.ts` (Mock). Kein Code aus anderen Bedrock-Launchern
(MCLauncher, BedrockLauncher, LeviLauncher – GPL/AGPL) übernommen.

## Datenmodell

`instances/<id>/instance.json` bekommt ein optionales Feld:

```json
"bedrock": { "channel": "release" | "preview", "profile": "isolated" | "shared" }
```

- Fehlt das Feld (alle bisherigen Dateien), ist es eine Java-Instanz – keine Migration nötig.
- Bedrock-Instanzen haben `mc_version = "bedrock"`, `loader = vanilla`, `install_state = installed`;
  Java/Fenster/Hooks/Loader werden ignoriert und in der Oberfläche ausgeblendet.
- Java-spezifische Abläufe lehnen Bedrock-Instanzen ab bzw. überspringen sie (Installieren, Play-Links,
  Auswahllisten für Mods/Modpacks/Server/Teilen über `useJavaInstances()`).

## Pfade

| Was | GDK (ab 1.21.120) | Alte UWP-App |
| --- | --- | --- |
| Basis Release | `%AppData%\Minecraft Bedrock` | `%LocalAppData%\Packages\Microsoft.MinecraftUWP_8wekyb3d8bbwe\LocalState` |
| Basis Preview | `%AppData%\Minecraft Bedrock Preview` | `%LocalAppData%\Packages\Microsoft.MinecraftWindowsBeta_8wekyb3d8bbwe\LocalState` |
| Welten, Einstellungen | `Users\<id>\games\com.mojang` (`minecraftWorlds`, `minecraftpe`) | `games\com.mojang` |
| Packs | `Users\Shared\games\com.mojang` (`resource_packs`, `behavior_packs`, `skin_packs`, `world_templates`, `development_*`) | `games\com.mojang` |

Layout-Wahl je Kanal: GDK, sobald `%AppData%\Minecraft Bedrock[ Preview]` existiert oder es keine UWP-Daten gibt.
Jeder `…\games\com.mojang`-Ordner ist ein **Slot** (`Layout::slots`). Mehrere Xbox-Konten = mehrere `Users\<id>`-Slots.

Launcher-eigene Ordner (`<daten>` = `%AppData%\VibeLauncher` bzw. `VIBE_LAUNCHER_HOME`):

| Pfad | Inhalt |
| --- | --- |
| `instances/<id>/bedrock/…` | Eigenes Profil der Instanz (Slots im gleichen Aufbau wie im echten Ordner) |
| `bedrock/swap-<kanal>.json` | Journal eines laufenden/offenen Tauschs |
| `bedrock/park/<kanal>/…` | Geparkte Nutzerdaten, solange eine Instanz eingetauscht ist |
| `bedrock/backups/<kanal>/erste-sicherung-<zeit>/` + `bedrock/initial-backup-<kanal>.json` | Einmalige Vollsicherung vor dem ersten Tausch |
| `bedrock/rescue/<zeit>/…` | Auffangordner für Unerwartetes (wird nie automatisch gelöscht) |
| `backups/bedrock/<id>/<weltordner>/<zeit>.mcworld` + `.json` | Welt-Sicherungen |

### Entwicklung / Tests

- **Debug-Builds fassen echte Bedrock-Daten nie an**, außer `VIBE_BEDROCK_REAL=1` ist gesetzt.
- `VIBE_BEDROCK_ROOT=<ordner>` (nur Debug): alle Bedrock-Pfade liegen unter diesem Ordner (wie `%AppData%`/
  `%LocalAppData%`), „Spielen“ startet **nicht** das echte Spiel, sondern simuliert eine Sitzung
  (`VIBE_BEDROCK_SIM_SECS`, Standard 20 s; legt wie das Spiel `Users/<id>/games/com.mojang` an).
  `VIBE_BEDROCK_SIM_MISSING=1` simuliert „nicht installiert“. Screenshots aus `<ordner>\Captures`.
- Echte Läufe zusätzlich mit `VIBE_LAUNCHER_HOME` auf einen Temp-Ordner (gleiches Laufwerk!).
- Mock (`VITE_MOCK=1`): `localStorage` `vl.mock.bedrock = missing | unsupported`, `vl.mock.cf = 1`.

## Getrennte Profile: Tausch-Verfahren

**Gewählte Technik: Ordner-Tausch per atomarem `rename` mit Journal** (keine Junctions/Symlinks).

Begründung:
- Der echte Ordner bleibt immer ein ganz normaler Ordner. Keine Reparse-Points, die das Spiel, Cloud-Sync,
  Virenscanner oder ein „Ordner löschen“ des Nutzers anders behandeln könnten (Löschen durch eine Junction trifft
  das Ziel).
- `rename` eines Ordners auf demselben Laufwerk ist eine einzelne, atomare Metadaten-Operation – schnell (auch bei
  vielen GB) und nach einem Stromausfall entweder ganz oder gar nicht passiert.
- Windows verweigert das Umbenennen, solange das Spiel Dateien darin offen hat – ein zusätzliches Sicherheitsnetz.
- Wenn der Launcher nicht läuft, liegen im echten Ordner immer die normalen Daten des Nutzers; ein Start über das
  Startmenü zeigt also nie überraschend eine Instanz.

Ablauf beim Start einer Instanz mit eigenem Profil (`bedrock::game::run`, `bedrock::swap`):

1. Spiel läuft? → Abbruch (Prozess `Minecraft.Windows.exe`; unbekannter Kanal zählt immer als „läuft“).
2. Offenen Tausch (z. B. nach Absturz) zuerst abschließen (`swap_out`).
3. **Einmalig je Kanal: vollständige Kopie** aller Slots nach `bedrock/backups/<kanal>/erste-sicherung-…`
   (erst in `.partial`, dann umbenennen; Marker-Datei erst danach).
4. Gleiches Laufwerk prüfen (sonst Abbruch mit Hinweis auf „Gemeinsames Profil“).
5. Journal schreiben (Phase `swapping_in`, Liste der Nutzer-Slots), dann jeden Nutzer-Slot → `park/`, jeden
   Instanz-Slot → echter Ordner, Phase `active`. Bei einem Fehler wird sofort zurückgetauscht.
6. Spiel öffnen, auf den Prozess warten (max. 180 s, sonst zurücktauschen), Sitzung als „läuft“ melden.
7. Prozess zweimal hintereinander nicht mehr gefunden (Abfrage alle 2 s) → zurücktauschen (bis zu 12 Versuche,
   falls Dateien kurz gesperrt sind), Spielzeit addieren, Screenshots übernehmen.

Zurücktauschen (`swap_out`) ist **idempotent** und dient zugleich als Wiederaufnahme nach Absturz/Stromausfall:

1. Phase `swapping_out` ins Journal.
2. Jeder Slot im echten Ordner gehört der Instanz – außer er steht in der Nutzer-Liste **und** sein Gegenstück
   liegt nicht mehr im Parkplatz (dann ist er bereits zurückgetauscht). Instanz-Slots → Profil der Instanz. Ist
   dort unerwartet schon etwas, geht der Slot nach `rescue/` statt etwas zu überschreiben.
3. Geparkte Nutzer-Slots zurück. Ist der Zielort inzwischen belegt (Spiel neu gestartet?), Abbruch – das Journal
   bleibt, nichts wird überschrieben.
4. Unerwartete Reste im Parkplatz → `rescue/`. Leere Ordner aufräumen, Journal löschen.

Aus Journal + Dateisystem ist an jeder Stelle eindeutig, wem ein Ordner gehört. Die Tests
(`bedrock::swap::tests::crash_at_every_step_recovers`) simulieren einen Absturz **vor jedem einzelnen
Schritt** beim Ein- und Austauschen und prüfen, dass danach Nutzer- und Instanzdaten Byte für Byte vollständig sind.

Wiederaufnahme: beim Launcher-Start (`bedrock::game::on_startup`) – läuft das Spiel noch, wird die Sitzung
weiter beobachtet, sonst wird zurückgetauscht. Zusätzlich vor jedem Start und von Hand („Jetzt zurücktauschen“
auf der Instanzseite, `bedrock_recover`).

Sperren: Alle Abläufe, die Bedrock-Daten verschieben oder schreiben (Tausch, Packs, Welten), laufen unter
`DATA_LOCK`, damit nie in einen Ordner geschrieben wird, der gerade getauscht wird. Während bestehende Daten
übernommen werden, startet keine Instanz desselben Kanals.

**Gemeinsames Profil** (`profile = shared`): kein Tausch, direkt die echten Daten. Während eine andere Instanz mit
eigenem Profil eingetauscht ist, zeigt eine Shared-Instanz bewusst nichts an (Fehlermeldung statt fremder Daten).

**Bestehende Daten übernehmen**: beim Anlegen (Häkchen, standardmäßig an bei der ersten Bedrock-Instanz) werden
alle Slots in das Profil der neuen Instanz **kopiert** (Aufgabe mit Fortschritt). Das Original bleibt unverändert.

## Add-ons

- **CurseForge**: Spiel-ID über `GET /v1/games` (Slug `minecraft-bedrock`, Rückfall `78022`), Arten über
  `GET /v1/categories?gameId=…&classesOnly=true` (Add-ons, Texturen, Karten, Skins, Skripte …). Suche/Installation
  nutzen den vorhandenen Provider (`content/curseforge.rs`, gleicher API-Key aus der Build-Konfiguration bzw. den
  Einstellungen). Projekte mit gesperrtem Download → „Auf CurseForge“ (Datei dann per Drag & Drop).
- **Dateien**: `.mcpack`, `.mcaddon`, `.mcworld`, `.mctemplate`, `.zip` per Drag & Drop auf die Add-on-Liste oder
  Dateiauswahl. Archiv wird vollständig geprüft, bevor etwas geschrieben wird: unsichere Pfade (`..`, absolute
  Pfade, Laufwerksbuchstaben, Symlinks) lehnen das ganze Archiv ab (Zip-Slip), Größen-/Anzahlgrenzen gegen
  ZIP-Bomben. `manifest.json` wird tolerant gelesen (Kommentare, nachgestellte Kommas, Version als Liste oder Text,
  Namen aus `texts/en_US.lang`). Typ aus den Modulen: `resources` → Ressourcen, `data`/`script` → Verhalten,
  `skin_pack`, `world_template`. `.mcaddon` mit mehreren Packs und innere `.mcpack`-Dateien (eine Ebene) werden
  einzeln installiert; Packs innerhalb einer Welt gehören zur Welt.
- Gleiche UUID im Zielordner → Update im selben Ordner (alter Stand wird erst nach erfolgreichem Schreiben
  entfernt). Schreiben immer erst in einen Temp-Ordner daneben, dann umbenennen.
- Je Welt aktivieren/deaktivieren: `world_resource_packs.json` / `world_behavior_packs.json` (neue Einträge vorn,
  fremde Felder wie `subpack` bleiben erhalten).
- Entfernen → Papierkorb. Export als `.mcpack`/`.mctemplate`.
- Herkunft (CurseForge-Projekt/Datei) steht in `.vibe-source.json` im Pack-Ordner (wird beim Export weggelassen).

## Welten

Liste aus `minecraftWorlds` aller Spieler-Slots: Name (`levelname.txt`), Icon (`world_icon.jpeg`), Größe,
„zuletzt gespielt“ (= Änderungszeit von `level.dat`), aktive Packs. Import `.mcworld` in den zuletzt benutzten
Spieler-Slot (gibt es noch keinen, muss die Instanz einmal gestartet werden). Export `.mcworld`. Löschen legt
vorher automatisch eine Sicherung an und verschiebt die Welt in den Papierkorb. Sicherungen sind `.mcworld`-Dateien;
Zurückspielen sichert den aktuellen Stand automatisch und ersetzt die Welt erst nach erfolgreichem Entpacken.

## Spielen

- Start über das Protokoll des installierten Pakets: `minecraft:` bzw. `minecraft-preview:`.
- Installiert? Registry `HKCU\Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppModel\Repository\Packages`
  (Pakete `Microsoft.MinecraftUWP_*` bzw. `Microsoft.MinecraftWindowsBeta_*`, Version aus dem Paketnamen) oder
  `X:\XboxGames\Minecraft [Preview ]for Windows\Content` auf lokalen Festplatten. Nur lesend.
- Nicht installiert → Hinweis mit „Microsoft Store öffnen“ (Release: Produkt `9NBLGGH2JHXJ`, Preview: Store-Suche).
- „Läuft“-Status, Spielzeit, Statistik und Discord-Status über die normale Sitzungsverwaltung (`GameManager`).
- Screenshots: Xbox-Game-Bar-Aufnahmen (`Videos\Captures`, Dateiname beginnt mit „Minecraft“, Zeitpunkt in der
  Sitzung) werden in `instances/<id>/minecraft/screenshots/` **kopiert** und erscheinen so in der Galerie.

## Grenzen / offen

- **Nicht gegen das echte Spiel getestet** (auf dem Entwicklungsrechner ist Bedrock nicht installiert, und echte
  Daten werden während der Entwicklung bewusst nicht angefasst): Protokoll-Start (`minecraft:`,
  `minecraft-preview:`), Paket-/Ordner-Erkennung, Prozessname/-pfad der GDK-Version (`Minecraft.Windows.exe`,
  Preview-Erkennung über den Pfad), Store-Links, Game-Bar-Dateinamen, Verhalten des Spiels gegenüber getauschten
  Ordnern (z. B. Cloud-Sync/Realms-Caches im Spieler-Ordner).
- Getauscht wird nur `games\com.mojang`. Alles andere unter `Users\<id>\` und im Basisordner (z. B. `logs`) ist
  zwischen den Instanzen gemeinsam.
- Eigene Profile brauchen den Launcher-Datenordner auf **demselben Laufwerk** wie die Bedrock-Daten.
- Profile sind an das Layout gebunden: Wechselt eine alte UWP-Installation zu GDK, passen deren Profile nicht mehr
  (Daten bleiben erhalten, müssen ggf. von Hand verschoben werden). Laut Jayly (Bedrock-GDK-Artikel) kann das
  automatische Update auf GDK Daten verschieben – vorher sichern.
- Mehrere Xbox-Konten: Welten werden aus allen Spieler-Slots gelistet; Importe landen im zuletzt benutzten.
- Keine Updates für CurseForge-Add-ons, keine Abhängigkeitsauflösung (Bedrock-Add-ons bringen RP+BP meist im
  selben `.mcaddon`).
- Unter macOS/Linux ist der Tab sichtbar, aber ausgegraut mit Erklärung.

## Notfall: Daten von Hand prüfen

1. Spiel schließen, Launcher schließen.
2. Liegt `bedrock/swap-<kanal>.json` vor, sind die normalen Daten in `bedrock/park/<kanal>/` und die Daten der im
   Journal genannten Instanz im echten Ordner. Launcher starten genügt normalerweise (automatische Wiederaufnahme).
3. Die erste Vollsicherung liegt unter `bedrock/backups/<kanal>/erste-sicherung-…`, Unerwartetes unter
   `bedrock/rescue/`.
