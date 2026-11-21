# Datenschutz und Transparenz

Im Launcher: **Einstellungen → Datenschutz** (`src/features/privacy/`), im Hilfe-Center die Anleitung
„Datenschutz & Transparenz“ mit Tour. Texte in `src/i18n/privacy.ts`, Liste der Dienste in `src/features/privacy/flows.ts`.
Wer einen Netzwerkaufruf hinzufügt, ergänzt beides.

## Versprechen

- Keine Werbung, keine Werbe-SDKs, keine Overlays von Dritten.
- Keine Telemetrie, keine Nutzungsstatistik, keine automatischen Absturzberichte. Die Absturz-Analyse
  (`src-tauri/src/platform/crash/`) läuft nur lokal.
- Feedback (`src-tauri/src/feedback/`) und mclo.gs-Upload (`src-tauri/src/minecraft/logs.rs`) nur nach Klick, Logs
  werden vorher bereinigt (`feedback/redact.rs`).
- Vibe-Dienste nur mit Zustimmung (siehe unten). Vibe wird nie ungefragt in Modpacks gepackt.
- Tokens nur im OS-Schlüsselbund (`auth/secrets.rs`), nie in Dateien oder Logs.

Geprüft am 21.11.2026 per Suche nach `telemetry|analytics|sentry|posthog|umami|plausible|beacon|mixpanel|amplitude|segment|bugsnag|rollbar|gtag`
in `src/`, `src-tauri/src`, `Cargo.toml` und `package.json`: keine Treffer außer CSS. Das Frontend ruft kein `fetch`/`WebSocket`
direkt auf, Vibe-Verkehr läuft über Rust (`vibe/mod.rs`, `vibe/ws.rs`).

## Was beim Audit ohne Zustimmung gesendet wurde – und was geändert ist

| Fund | Vorher | Jetzt |
|---|---|---|
| Vibe-Anmeldung | `vibe.enabled` stand standardmäßig an. Nach dem Microsoft-Login im Onboarding-Schritt „Konto“ meldete `social/service.ts` sich sofort bei Vibe an (Mojang-Join, Name, UUID, Online-Status), **bevor** der Schritt „Vibe“ kam | Neue Installationen: `vibe.enabled = false` (`Settings::default`). Erst die Wahl im Onboarding oder in den Einstellungen schaltet es ein. Bestehende `settings.json` ohne Feld behalten das alte Verhalten (`#[serde(default)]` → `VibeServices::default()` = an), ebenso bestehende Nutzer ohne `settings.json` (`load_for`) |
| Ankündigungen (`/api/v1/announcements`) beim Start | liefen mit, weil Vibe an war | folgen dem Vibe-Schalter, also bei Neuinstallationen erst nach Zustimmung |
| MinecraftCapes | `minecraftcapes = true`: beim Öffnen der Skins-Seite ging die eigene UUID an api.minecraftcapes.net (Dritte) | Neue Installationen: aus. Der Tab „MinecraftCapes“ zeigt dann eine Zustimmungskarte (`skins/McCapesOptIn.tsx`). Fehlt das Feld in einer alten Datei, bleibt es an (`legacy_enabled`) |
| Konto entfernen | Vibe-Tokens (`vibe:<konto-id>`) blieben im Schlüsselbund | werden mitgelöscht (`commands/auth.rs`) |

Test: `cargo test --lib privacy_tests`.

## Was wohin geht (Stand 21.11.2026)

Jeder Dienst sieht die IP-Adresse und den User-Agent `VibeLauncher/<version>` (`net.rs`). Der Updater nutzt `tauri-plugin-updater/<v>`.

**Nötig zum Spielen:** Microsoft/Xbox/Mojang (Login, Spieldateien, Skins), Loader-Maven/Meta (Fabric, Quilt, Forge, NeoForge),
Java (Mojang, Rückfall Adoptium mit OS/Arch), Modrinth/CurseForge (Suche, Installation; **im Hintergrund** Update-Prüfung mit
SHA-1-/Murmur2-Prüfsummen aller Inhaltsdateien, MC-Version, Loader), Status-Ping an Server der eigenen Liste, PaperMC/Purpur/Hangar.

**Automatisch, abschaltbar:**

| Dienst | Daten | Schalter | Standard |
|---|---|---|---|
| GitHub `latest.json` | nur IP (Endpoint ohne Platzhalter, Vergleich lokal) | `check_updates` | an |
| Vibe | Name, UUID, Presence, Activity, Chats; Ankündigungen mit Version + Sprache; Vibey-Client-Prüfung beim Start | `vibe.enabled`, `vibe.presence` usw. | **aus** (neu) |
| Discord RPC (lokale IPC) | Instanz, MC-Version, Loader, Server/Welt, Kopf-URL mc-heads.net | `discord_rpc`, `discord_details`, `discord_small` | an |
| MinecraftCapes | eigene UUID | `minecraftcapes` | **aus** (neu) |
| Relay / playit.gg | Name, UUID, Server-Einstellungen, Spielverkehr | je Server `connection`/`auto_start` | nur wenn eingerichtet |

**Nur auf Klick:** Feedback (`/api/v1/feedback`, auch bei Vibe aus), mclo.gs, Modpack teilen, Play-Links.

**Bilder von Dritten:** `mc-heads.net/avatar/<uuid>` für fremde Köpfe (`components/PlayerHead.tsx`), beliebige `https:`-Bilder und
YouTube-nocookie in Projektbeschreibungen (CSP `img-src https:`).

## Lokal gespeichert

Datenordner (`%APPDATA%\VibeLauncher`, im portablen Modus `VibeData` neben der exe), Windows-Anmeldeinformationsverwaltung
(Dienst `VibeLauncher`, portabel `VibeLauncher-portable-<id>`), WebView2-Daten (`%LOCALAPPDATA%\eu.vibecraft.launcher`, portabel im
Datenordner), Registrierung: `vibelauncher://` (nicht portabel), GPU-Präferenz nur mit `prefer_dgpu`.

## Offene Punkte (bewusst nicht geändert)

- **mc-heads.net** bekommt UUIDs fremder Spieler, ohne Schalter. Besser: Köpfe aus `textures.minecraft.net` (Mojang) rendern.
- **Modrinth-Abfragen ohne Schalter**: „Beliebte Modpacks“ auf der Startseite, schon während des Onboardings. Dazu die
  Hintergrund-Update-Prüfung mit Datei-Prüfsummen. Beides sind normale Inhalte-Abfragen ohne Personenbezug außer der IP.
  Denkbar wäre ein Schalter „Updates für Inhalte im Hintergrund prüfen“.
- **Discord**: `discord_details` (Server-Adresse im Profil) steht standardmäßig an. Das sollte das Produkt-Team entscheiden.
- **Feedback geht auch bei Vibe aus an vibe.axolite.app**, aber nur nach Vorschau und Klick. Das ist auf der Seite so beschrieben.
