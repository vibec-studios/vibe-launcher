# Portabler Modus und winget

## Portabel

**Einschalten:** Liegt neben `vibe-launcher.exe` eine Datei `portable.txt`, läuft der Launcher portabel. Alle Daten liegen dann in
`<exe-ordner>\VibeData`. Im Launcher: *Einstellungen → Allgemein → Portabler Modus → „Portable Kopie erstellen …“*. Das kopiert die
laufende exe in einen gewählten Ordner und legt die Marker-Datei an. Auf denselben Ordner erneut angewendet, ersetzt es nur die exe.
Das ist der Update-Weg, `VibeData` bleibt dabei erhalten.

Reihenfolge des Datenordners (`paths/location.rs`): `VIBE_LAUNCHER_HOME` → `portable.txt` → `location.json` → `%APPDATA%\VibeLauncher`.

| Thema | Verhalten portabel | Code |
|---|---|---|
| Daten | `VibeData` neben der exe, „Speicherort ändern“ gesperrt, kein `location.json` | `paths/portable.rs`, `datadir/mod.rs` |
| WebView2 | `WEBVIEW2_USER_DATA_FOLDER = VibeData\webview` (gesetzt vor dem Start, außer schon von außen gesetzt) | `portable::prepare_process` |
| Tokens | siehe unten | `auth/secrets.rs`, `portable/mod.rs` |
| `vibelauncher://` | wird nicht in der Registrierung eingetragen | `lib.rs` |
| Verknüpfungs-Icons | installierte Verknüpfungen werden nicht angefasst | `platform/app_icon.rs` |
| Updates | Suche zeigt neue Versionen, „Installieren“ ist gesperrt, stattdessen Link zur Download-Seite | `updater.rs`, `portable/PortableUpdateAction.tsx` |

### Tresor-Tokens

Anmeldedaten kommen **nie auf den Stick**. Sie liegen weiter in der Windows-Anmeldeinformationsverwaltung des jeweiligen PCs, unter
einem eigenen Dienstnamen `VibeLauncher-portable-<id>`. Die zufällige `<id>` steht in `VibeData\portable.json`. Damit:

- überschreibt ein portabler Launcher nie die Anmeldung eines installierten Launchers auf demselben PC,
- funktioniert ein Stick auch mit wechselnden Laufwerksbuchstaben,
- kann jemand mit einem verlorenen Stick nichts anfangen, und an einem anderen PC meldet man sich einmal neu an.
  `accounts.json` mit Name und UUID reist mit, die Tokens nicht.

Für fremde PCs: „Beim Schließen von diesem PC abmelden“ (`portable.json` → `forget_on_exit`). Beim Schließen des Hauptfensters
werden alle Tokens dieses Dienstnamens gelöscht, für Microsoft und Vibe (`portable::on_exit`). Bei einem harten Abbruch (Prozess
beendet, Strom weg) bleibt der Eintrag stehen. Dafür gibt es den Knopf „Jetzt von diesem PC entfernen“.

Bewusst nicht gemacht: Tokens verschlüsselt auf dem Stick speichern. Das bräuchte ein eigenes Passwort, sonst wäre der Stick ein
Schlüssel zum Konto.

### Grenzen

- Die Einzel-Instanz-Sperre gilt für alle Vibe Launcher. Läuft schon ein installierter, öffnet ein Start vom Stick diesen (Tauri
  single-instance, gleiche App-ID).
- Nötig ist die WebView2-Runtime des PCs. Unter Windows 10/11 ist sie normalerweise da, sonst hilft der Installer bzw. Microsoft.
- Nicht getestet: ob die Release-exe ohne installierte VC++-Runtime startet.

### Release

`release.yml` baut zusätzlich `Vibe-Launcher_<version>_x64-portable.zip` mit `vibe-launcher.exe` und `portable.txt`. Den festen
Download-Namen `Vibe-Launcher-Portable.zip` setzt `scripts/prepare-release.mjs`. Ins Updater-`latest.json` kommt das Zip nicht.

## winget

Die Manifeste liegen vorbereitet in `packaging/winget/manifests/v/VibeCraftStudios/VibeLauncher/<version>/`, Paket-ID
`VibeCraftStudios.VibeLauncher`. **Nichts ist eingereicht.**

```bash
node scripts/winget-manifest.mjs --version 1.0.0-beta.5          # SHA-256 aus der öffentlichen GitHub-API (Asset-Digest)
node scripts/winget-manifest.mjs --version 1.1.0 --installer path/to/Vibe-Launcher_1.1.0_x64-setup.exe
winget validate --manifest packaging/winget/manifests/v/VibeCraftStudios/VibeLauncher/1.0.0-beta.5
```

Einreichen erst nach Entscheidung des Teams, per PR an `microsoft/winget-pkgs` (z. B. mit `wingetcreate submit`):

- Die Installer sind nicht Authenticode-signiert. SmartScreen bzw. die winget-Prüfung können das bemängeln.
- `UpgradeBehavior: install`: winget installiert über die vorhandene Version (NSIS, `currentUser`). Der eingebaute Updater läuft
  daneben weiter.
- Für Vorabversionen (`-beta`) zeigt winget `--version` an. Normale Nutzer bekommen sie wie jede andere Version.
