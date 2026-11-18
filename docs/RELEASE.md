# Releases & Update-Kanäle

Der Launcher aktualisiert sich selbst (Tauri-Updater, signierte NSIS-Installer). Es gibt zwei Kanäle,
umschaltbar unter *Einstellungen → Updates → Update-Kanal*:

| Kanal | Quelle | Workflow | Updater-Endpoint |
|---|---|---|---|
| **Release** | veröffentlichte GitHub-Releases (Tag `vX.Y.Z`) | `.github/workflows/release.yml` | `releases/latest/download/latest.json` |
| **Dev** | jeder Commit auf `main` | `.github/workflows/dev.yml` | `releases/download/dev/latest.json` |

- Ist ein Update da, zeigt der Launcher oben rechts **„Update verfügbar“** → Klick → *Jetzt aktualisieren* →
  Download mit Fortschritt → Installer läuft passiv → Launcher startet neu.
- Dev-Builds tragen die Version `<nächster Patch>-dev.<Laufnummer>` (z. B. `1.0.1-dev.42`) und suchen standardmäßig
  im Dev-Kanal. Wer von Dev auf Release zurückwechselt, bekommt das aktuelle Release angeboten (auch wenn die
  Versionsnummer kleiner ist).
- Der Dev-Kanal ist **ein** Vorab-Release mit Tag `dev`, das bei jedem Push ersetzt wird (immer nur der neueste Build).
  Ein neuer Push bricht einen noch laufenden Dev-Build ab.

## Einmalig (erledigt)

- Repository-Secrets: `TAURI_SIGNING_PRIVATE_KEY` (Inhalt der privaten Updater-Schlüsseldatei),
  `CURSEFORGE_API_KEY`, `VIBE_MSA_CLIENT_ID`. Optional `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- Public Key in `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`) gehört zum privaten Schlüssel.
- Privaten Schlüssel sicher aufbewahren (Passwortmanager). Ohne ihn nehmen installierte Launcher keine Updates mehr an.

## Release veröffentlichen

```bash
node scripts/set-version.mjs 1.1.0      # package.json + Cargo.toml
cd src-tauri && cargo check && cd ..    # Cargo.lock aktualisieren
git commit -am "Release v1.1.0"
git tag v1.1.0
git push origin main v1.1.0
```

Der Workflow „Release“ baut, signiert und veröffentlicht das GitHub-Release (mit `latest.json`). Ab dann bieten alle
Launcher im Release-Kanal das Update an.

## Runner (kostet nie etwas)

Jeder Workflow fragt zuerst `.github/workflows/pick-runner.yml` (läuft auf dem kostenlosen `ubuntu-latest`):

- `scripts/pick-runner.mjs` zählt den **Blacksmith-Verbrauch der Org im laufenden Monat** über die GitHub-API
  (so wie Blacksmith abrechnet: in 2-vCPU-x64-Minuten, Windows ×2, 4 vCPU ×2 → 1 Build-Minute = 4 Freiminuten).
- Unter **2.600 von 3.000** Freiminuten → `blacksmith-4vcpu-windows-2025`, sonst **`windows-latest`**
  (GitHub-Runner sind für öffentliche Repos kostenlos). Ist der Verbrauch nicht ermittelbar → ebenfalls `windows-latest`.
- Erzwingen: Repo-Variable **`WINDOWS_RUNNER`** setzen (z. B. `windows-latest`), löschen = wieder automatisch.
- Harte Garantie zusätzlich: **keine Zahlungsmethode im Blacksmith-Dashboard hinterlegen.**

## Caching in Actions

`.github/actions/setup` richtet ein (auf Blacksmith automatisch über deren schnellen Cache): pnpm-Store (setup-node), Cargo-Registry + `target/` (Swatinem/rust-cache, getrennte
Schlüssel für Debug/CI und Release; gespeichert nur auf `main`/Tags), Tauri-Bundler-Tools (NSIS) unter
`%LOCALAPPDATA%\tauri`.
