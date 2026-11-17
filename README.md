# Vibe Launcher

Minecraft-Launcher von **Vibe Craft Studios** für Windows – Instanzen, Modrinth & CurseForge, Modpacks,
Import/Export, Microsoft-Accounts, Logs mit mclo.gs-Upload. Gebaut mit Tauri 2 (Rust) und React.

*English below.*

## Features

- **Instanzen** mit Vanilla, Fabric, Quilt, Forge und NeoForge – eigene Ordner, RAM, Java, JVM-Argumente
- **Inhalte entdecken & installieren**: Mods, Resource-/Shader-Packs, Datapacks und Modpacks von Modrinth und CurseForge,
  Updates prüfen, Mods (de)aktivieren
- **Import/Export**: `.mrpack`, CurseForge-Zip, Ordner anderer Launcher; Export als Modrinth- oder CurseForge-Pack
- **Accounts**: Microsoft-Login (Device-Code – kein eingebettetes Browserfenster), mehrere Konten, automatische
  Token-Erneuerung; Tokens liegen verschlüsselt in der Windows-Anmeldeinformationsverwaltung, nie in Klartextdateien
- **Java automatisch**: passende Java-Runtime wird bei Bedarf heruntergeladen
- **Logs**: Live-Konsole, Crash-Reports, Upload zu mclo.gs
- **Automatische Updates** über signierte GitHub-Releases

## Download & Installation

1. Neueste Version unter [Releases](https://github.com/vibec-studios/vibe-launcher/releases/latest) öffnen.
2. `…_x64-setup.exe` herunterladen und ausführen (Installation für den aktuellen Benutzer, keine Admin-Rechte nötig).
3. Updates installiert der Launcher danach selbst.

Voraussetzung: Windows 10/11 (64 Bit). WebView2 wird bei Bedarf automatisch nachinstalliert.

Daten liegen unter `%APPDATA%\VibeLauncher` (Instanzen, Einstellungen, `accounts.json` ohne Tokens).

## Entwicklung

Benötigt: [Node.js](https://nodejs.org) 22+, [pnpm](https://pnpm.io) 11, [Rust](https://rustup.rs) (stable, MSVC),
Visual Studio Build Tools („Desktopentwicklung mit C++“).

```bash
pnpm install
pnpm tauri dev                   # App mit Hot-Reload
pnpm typecheck && pnpm build     # Frontend prüfen/bauen
cd src-tauri && cargo test       # Backend-Tests
```

**Testmodus mit eigenem Datenordner:** Ist `VIBE_LAUNCHER_HOME` gesetzt, nutzt der Launcher diesen Ordner statt
`%APPDATA%\VibeLauncher`, die Single-Instance-Sperre ist aus und Tokens landen unter einem eigenen
Schlüsselbund-Namen (`VibeLauncher-test-…`). So laufen mehrere Testinstanzen parallel, ohne echte Daten zu berühren:

```powershell
$env:VIBE_LAUNCHER_HOME = "$env:TEMP\vibe-test"; pnpm tauri dev
```

**Spielstart ohne Microsoft-Konto (nur Debug-Builds, für automatisierte Tests):** `VIBE_DEV_OFFLINE_ACCOUNT=<Name>`
setzen – ist kein Account aktiv, startet das Spiel dann mit einem Offline-Profil dieses Namens. Das taucht weder in
der Oberfläche noch in `accounts.json` auf und ist im Release-Build nicht enthalten.

Frontend ohne Backend (Mock): `VITE_MOCK=1 pnpm vite`. Architektur, Commands und Events: [docs/CONTRACT.md](docs/CONTRACT.md).

## Konfiguration

Zwei Schlüssel werden **beim Kompilieren** aus Umgebungsvariablen eingebettet (siehe [.env.example](.env.example)).
Nutzer können beide auch in den Einstellungen des Launchers überschreiben.

| Variable | Wofür | Ohne Wert |
|---|---|---|
| `CURSEFORGE_API_KEY` | CurseForge-Suche/Downloads | CurseForge ist ausgeblendet, Modrinth funktioniert |
| `VIBE_MSA_CLIENT_ID` | Microsoft-Login | keine Anmeldung möglich (Spielstart gesperrt) |

### CurseForge-API-Key

1. Auf [console.curseforge.com](https://console.curseforge.com) mit einem CurseForge-/Overwolf-Konto anmelden.
2. Unter **API keys** einen Key anlegen (für veröffentlichte Apps ggf. das Formular „Apply for API key“ ausfüllen).
3. Key als `CURSEFORGE_API_KEY` setzen.

### Microsoft-Login: Azure-App registrieren

Der Launcher nutzt den **Device-Code-Flow** (Code auf microsoft.com/link eingeben). Dafür braucht es eine eigene
Azure-App-Registrierung:

1. [portal.azure.com](https://portal.azure.com) → **Microsoft Entra ID** → **App registrations** → **New registration**.
2. Name z. B. „Vibe Launcher“. Bei **Supported account types**:
   **„Personal Microsoft accounts only“** wählen (Minecraft-Konten sind private Microsoft-Konten).
3. **Redirect URI**: leer lassen – für den Device-Code-Flow nicht nötig. → **Register**.
4. In der App: **Authentication** → *Advanced settings* → **Allow public client flows** = **Yes** → *Save*.
5. Kein Client-Secret anlegen (Desktop-Apps sind öffentliche Clients). API-Berechtigungen müssen nicht ergänzt werden –
   der Scope `XboxLive.signin offline_access` wird beim Login angefragt.
6. Die **Application (client) ID** (GUID auf der Übersichtsseite) als `VIBE_MSA_CLIENT_ID` setzen.
7. **Freigabe durch Mojang beantragen:** Neue Client-IDs dürfen die Minecraft-API erst nach Prüfung nutzen.
   Formular: <https://aka.ms/mce-reviewappid> (Client-ID, Tenant-ID und Projektbeschreibung angeben).
   Bis zur Freigabe endet der Login nach erfolgreicher Microsoft-/Xbox-Anmeldung mit der Meldung
   „Die Azure-App ist (noch) nicht für die Minecraft-API freigeschaltet“. Die Freigabe kann einige Tage dauern.

## Release-Prozess & Update-Kanäle

- **Release-Kanal:** Tag `vX.Y.Z` pushen → GitHub Actions baut und veröffentlicht das Release.
- **Dev-Kanal:** jeder Commit auf `main` → neuer Dev-Build im Vorab-Release `dev`.
- Im Launcher unter *Einstellungen → Über & Updates* umschaltbar; Updates erscheinen oben rechts als „Update verfügbar“.

Details: [docs/RELEASE.md](docs/RELEASE.md). Der private Updater-Schlüssel gehört **nie** ins Repository.

## English

**Vibe Launcher** is a Minecraft launcher for Windows by Vibe Craft Studios: instances with Fabric/Quilt/Forge/NeoForge,
Modrinth & CurseForge browsing, modpack import/export, Microsoft accounts (device code), log upload to
mclo.gs and signed auto-updates. Download the `…_x64-setup.exe` from the
[latest release](https://github.com/vibec-studios/vibe-launcher/releases/latest).

**Development:** `pnpm install`, `pnpm tauri dev`, `cd src-tauri && cargo test`. Set `VIBE_LAUNCHER_HOME` to use a
separate data folder (test mode, no single-instance lock, separate keyring namespace).

**Configuration (build time):** `CURSEFORGE_API_KEY` (from console.curseforge.com) and `VIBE_MSA_CLIENT_ID`
(Azure app registration: *Personal Microsoft accounts only*, *Allow public client flows* = Yes, no redirect URI needed;
new client IDs must be approved by Mojang via <https://aka.ms/mce-reviewappid> before they can access the Minecraft API).

**Releases:** set the secrets `TAURI_SIGNING_PRIVATE_KEY` (+ optional `_PASSWORD`), `CURSEFORGE_API_KEY`,
`VIBE_MSA_CLIENT_ID`, bump the version in `package.json` and `src-tauri/Cargo.toml`, push a `vX.Y.Z` tag, then publish the
draft release created by GitHub Actions. See [docs/RELEASE.md](docs/RELEASE.md).
