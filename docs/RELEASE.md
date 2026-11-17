# Release-Checkliste

Releases entstehen ausschließlich über GitHub Actions (`.github/workflows/release.yml`, Windows/NSIS).

## Einmalig

- [ ] Repository-Secrets (*Settings → Secrets and variables → Actions*):
  - `TAURI_SIGNING_PRIVATE_KEY` – **Inhalt** der privaten Updater-Schlüsseldatei (minisign, von `pnpm tauri signer generate`)
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` – Passwort des Schlüssels (weglassen, wenn keins gesetzt ist)
  - `CURSEFORGE_API_KEY` – von console.curseforge.com
  - `VIBE_MSA_CLIENT_ID` – Azure-App (siehe README, „Microsoft-Login: Azure-App registrieren“)
- [ ] Azure-App ist von Mojang für die Minecraft-API freigegeben (<https://aka.ms/mce-reviewappid>).
      Sonst scheitert der Login nach der Xbox-Anmeldung.
- [ ] Public Key in `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`) gehört zum privaten Schlüssel.
- [ ] Privater Schlüssel sicher gesichert (Passwortmanager). Ohne ihn können installierte Launcher keine Updates mehr annehmen.

## Pro Release

- [ ] `main` ist grün (CI: Typecheck, Build, `cargo check`, `cargo test`).
- [ ] Manuell getestet (Debug- oder lokaler Release-Build): Microsoft-Login, Instanz anlegen/installieren/starten,
      Modrinth- und CurseForge-Suche, Modpack-Import, Export, Logs/mclo.gs, Einstellungen.
- [ ] Version erhöht in **`package.json`** und **`src-tauri/Cargo.toml`** (gleiche Version; `tauri.conf.json` liest
      `package.json`). Danach `cargo check`, damit `Cargo.lock` passt. Commit „Release vX.Y.Z“.
- [ ] Tag pushen:
      ```bash
      git tag vX.Y.Z
      git push origin vX.Y.Z
      ```
      (Alternativ: Workflow „Release“ manuell starten – Tag wird aus der Version erzeugt.)
- [ ] Workflow erfolgreich; der Schritt „Secrets vorhanden?“ zeigt keine Warnungen.
- [ ] Draft-Release enthält:
  - `Vibe.Launcher_X.Y.Z_x64-setup.exe` (NSIS-Installer)
  - `Vibe.Launcher_X.Y.Z_x64-setup.exe.sig` (Updater-Signatur)
  - `latest.json` (Version, Notes, `platforms.windows-x86_64` mit `signature` und `url` auf den Installer)
- [ ] Installer auf einem sauberen Windows (oder VM) testen: Installation ohne Admin-Rechte, Start, Login.
- [ ] Release-Notes ergänzen → **Publish release**.
- [ ] Auto-Update prüfen: ältere Version starten → Update wird angeboten und installiert
      (Endpoint `https://github.com/vibec-studios/vibe-launcher/releases/latest/download/latest.json` –
      Drafts und Pre-Releases sind dort **nicht** sichtbar).

## Lokaler Release-Build (zum Testen)

```powershell
pnpm install
$env:TAURI_SIGNING_PRIVATE_KEY = "C:\Pfad\zu\vibe-launcher.key"   # Pfad oder Inhalt
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""                        # leer, wenn ohne Passwort
$env:CURSEFORGE_API_KEY = "..."; $env:VIBE_MSA_CLIENT_ID = "..."    # optional
pnpm tauri build
```

Ergebnis unter `src-tauri/target/release/bundle/nsis/` (`…_x64-setup.exe` + `.sig`).

## Wenn etwas schiefgeht

- **„A public key has been found, but no private key“** – `TAURI_SIGNING_PRIVATE_KEY` fehlt/leer.
- **Signatur-/Passwortfehler** – falsches Passwort-Secret; bei Schlüssel ohne Passwort das Secret leer lassen.
- **Updater findet kein Update** – Release noch Draft/Pre-Release, oder Version in `latest.json` nicht höher als installiert.
- **Tag passt nicht zur Version** – Versionen in `package.json`/`Cargo.toml` angleichen, Tag löschen und neu setzen.
