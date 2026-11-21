# Vibe Server Agent installieren

Mit dem **Vibe Server Agent** (`vibe-agent`) läuft dein Minecraft-Server nicht mehr auf deinem eigenen PC, sondern
auf einem anderen Rechner – meistens einem gemieteten Server im Internet (VPS) oder einem alten PC, der sowieso
durchläuft. Du steuerst ihn trotzdem bequem aus dem **Vibe Launcher** oder im Browser über das **Vibe Panel**:
Server anlegen, starten, Konsole, Mods/Plugins, Modpacks hochladen, Backups, Spieler.

Die Installation ist **ein einziger Befehl**. Diese Anleitung erklärt jeden Schritt – auch wenn du noch nie einen
Server gemietet oder ein Terminal benutzt hast.

- [1. Was brauche ich?](#1-was-brauche-ich)
- [2. Was ist ein VPS?](#2-was-ist-ein-vps)
- [3. Mit dem Server verbinden (SSH)](#3-mit-dem-server-verbinden-ssh)
- [4. Installieren unter Linux](#4-installieren-unter-linux)
- [5. Installieren unter Windows](#5-installieren-unter-windows)
- [6. Installieren mit Docker](#docker)
- [7. Mit dem Launcher koppeln](#7-mit-dem-launcher-koppeln)
- [8. Ports und Firewall](#8-ports-und-firewall)
- [9. Update, Deinstallation, Optionen](#9-update-deinstallation-optionen)
- [10. Wo liegt was?](#10-wo-liegt-was)
- [11. Sicherheit](#11-sicherheit)
- [12. Probleme lösen](#12-probleme-lösen)
- [13. Für Entwickler: Release und Tests](#13-für-entwickler-release-und-tests)

---

## 1. Was brauche ich?

| | Empfehlung |
|---|---|
| **Rechner** | VPS oder PC, der dauerhaft läuft |
| **System** | Linux 64-Bit (x64 oder ARM, z. B. Ubuntu 22.04/24.04, Debian 12/13) **oder** Windows 10/11/Server 2016+ 64-Bit **oder** irgendein System mit Docker |
| **Arbeitsspeicher** | 2 GB für einen kleinen Vanilla-/Paper-Server, 4–8 GB für Modpacks |
| **Speicher** | 10 GB frei, mehr für große Welten und Backups |
| **Java** | nicht nötig – der Agent lädt die passende Java-Version selbst herunter |

## 2. Was ist ein VPS?

Ein **VPS** („Virtual Private Server“) ist ein kleiner Computer in einem Rechenzentrum, den du monatlich mietest.
Er läuft rund um die Uhr, hat eine feste Internet-Adresse (IP-Adresse) und du bedienst ihn über die Kommandozeile.
Bekannte Anbieter sind z. B. Hetzner, netcup, IONOS, Contabo oder Oracle Cloud (hat ein kostenloses ARM-Angebot).
Vibe hat mit keinem Anbieter etwas zu tun – nimm, was dir gefällt.

Beim Bestellen:

1. **Betriebssystem:** „Ubuntu 24.04“ oder „Debian 12/13“ wählen.
2. **Zugang:** Du bekommst eine **IP-Adresse** (z. B. `203.0.113.10`) und entweder ein **root-Passwort** per Mail
   oder du hinterlegst einen **SSH-Schlüssel**. Beides funktioniert.
3. Bei manchen Anbietern gibt es eine **Firewall im Webinterface** – siehe [Ports und Firewall](#8-ports-und-firewall).

> Ein alter PC zu Hause geht auch. Dann verbindest du dich entweder direkt daran (Bildschirm + Tastatur) oder per
> SSH im Heimnetz. Damit Freunde von außen joinen können, brauchst du **keine Portfreigabe** am Router – der
> Vibe-Tunnel (`<name>.axolite.cc`) erledigt das.

## 3. Mit dem Server verbinden (SSH)

**SSH** ist eine sichere Fernsteuerung für die Kommandozeile. Du tippst Befehle auf deinem PC, sie laufen auf dem
Server.

### Windows 10/11

1. Startmenü öffnen, **„Terminal“** (oder „PowerShell“) eintippen und öffnen.
2. Verbinden (IP-Adresse durch deine ersetzen):
   ```powershell
   ssh root@203.0.113.10
   ```
3. Beim ersten Mal fragt SSH: `Are you sure you want to continue connecting (yes/no)?` → **`yes`** tippen, Enter.
4. Passwort eingeben. **Beim Tippen erscheint nichts** – auch keine Sternchen. Das ist normal. Enter drücken.
5. Du siehst jetzt etwas wie `root@mein-server:~#` – du bist auf dem Server.

### macOS / Linux

Programm **Terminal** öffnen und denselben Befehl `ssh root@203.0.113.10` eingeben.

### Befehle einfügen

| Programm | Einfügen |
|---|---|
| Windows Terminal / PowerShell | **Strg + V** oder **Rechtsklick** |
| macOS Terminal | **Cmd + V** |
| Linux-Terminal | **Strg + Umschalt + V** |
| PuTTY | **Rechtsklick** |

Tipp: Kopiere Befehle immer mit dem Kopier-Knopf hier oder im Launcher, nicht abtippen.

Hat dein Anbieter dir keinen `root`-Zugang, sondern einen normalen Benutzer (z. B. `ubuntu`), verbindest du dich mit
`ssh ubuntu@203.0.113.10`. Das Installationsskript fragt dann per `sudo` nach deinem Passwort.

## 4. Installieren unter Linux

Auf dem Server diesen Befehl einfügen und Enter drücken:

```sh
curl -fsSL https://vibe.axolite.app/agent/install.sh | sh
```

> Meldet der Server `curl: command not found`, zuerst `apt update && apt install -y curl` (Debian/Ubuntu)
> bzw. `dnf install -y curl` (Fedora/Rocky/Alma) ausführen.

Das Skript

1. erkennt die Architektur (x64 oder ARM64) und lädt die neueste Version aus den
   [GitHub-Releases](https://github.com/vibec-studios/vibe-launcher/releases) (Tags `agent-v…`),
2. prüft die **SHA256-Prüfsumme** – stimmt sie nicht, bricht es ab,
3. legt einen eigenen Systembenutzer **`vibe-agent`** an (der Agent läuft nie als root),
4. richtet den Dienst **`vibe-agent`** (systemd) ein, der beim Hochfahren automatisch startet und nach Abstürzen neu
   startet,
5. öffnet **keine** Ports in der Firewall, sondern zeigt dir, was du ggf. freigeben musst,
6. zeigt am Ende den **Kopplungscode** und die **Panel-Adresse**:

```text
────────────────────────────────────────────────────────────
  Vibe Agent installiert: vibe-agent 0.1.0

  Kopplungscode:
    Code: K7QX-4M2P (gültig 10 Minuten)
    Fingerprint: SHA256:AB:CD:…

  Panel:        https://203.0.113.10:25580
  Im Launcher:  Server → Remote-Server hinzufügen → Adresse 203.0.113.10:25580 + Code
────────────────────────────────────────────────────────────
```

Ohne systemd (z. B. Alpine mit OpenRC, manche Container) installiert das Skript nur das Programm und zeigt, wie du
es startest – dort ist [Docker](#docker) meist die bequemere Wahl.

## 5. Installieren unter Windows

1. Startmenü → **„PowerShell“** öffnen (normal reicht – das Skript fragt selbst nach Administratorrechten).
2. Einfügen und Enter:
   ```powershell
   irm https://vibe.axolite.app/agent/install.ps1 | iex
   ```
3. Windows fragt **„Möchten Sie zulassen, dass diese App Änderungen vornimmt?“** → **Ja**. Die Installation läuft in
   einem neuen Fenster weiter und zeigt am Ende Kopplungscode und Panel-Adresse. Fenster mit Enter schließen.

Das Skript installiert das Programm nach `C:\Program Files\Vibe Agent`, legt die Daten unter
`C:\ProgramData\VibeAgent` ab und richtet den Windows-Dienst **VibeAgent** ein. Der Dienst läuft unter einem eigenen,
eingeschränkten Dienstkonto (`NT SERVICE\VibeAgent`), das nur in seinen Datenordner schreiben darf.

Optionen übergibst du so:

```powershell
& ([scriptblock]::Create((irm https://vibe.axolite.app/agent/install.ps1))) -Port 26000
```

<a id="docker"></a>
## 6. Installieren mit Docker

Für Server, auf denen schon Docker läuft (auch NAS-Systeme wie Unraid, Synology oder TrueNAS):

```sh
mkdir -p ~/vibe-agent && cd ~/vibe-agent
curl -fsSLO https://github.com/vibec-studios/vibe-launcher/releases/download/agent-v0.1.0/docker-compose.yml
docker compose up -d
docker compose exec vibe-agent vibe-agent pair
```

(`agent-v0.1.0` durch die aktuelle Version aus den Releases ersetzen – oder die
[`docker-compose.yml`](../agent/dist/docker-compose.yml) aus dem Repo kopieren.)

Oder ohne Compose:

```sh
docker run -d --name vibe-agent --restart unless-stopped --stop-timeout 90 \
  -p 25580:25580 -p 25565:25565 -v vibe-agent-data:/data \
  ghcr.io/vibec-studios/vibe-agent:latest
docker exec vibe-agent vibe-agent pair
```

- Image: `ghcr.io/vibec-studios/vibe-agent` für `linux/amd64` und `linux/arm64`, Tags `latest` und die Version.
- Alle Daten (Server, Welten, Java, Backups, Kopplungen) liegen im Volume unter `/data`.
- Weitere Minecraft-Server brauchen weitere Ports, z. B. `- "25566:25566"`. Für Simple Voice Chat
  `- "24454:24454/udp"`, für Bedrock/Geyser `- "19132:19132/udp"`. Über den Vibe-Tunnel ist das nicht nötig.
- Statt eines Volumes geht auch ein Ordner (`./data:/data`) – er muss dann dem Benutzer 10001 gehören:
  `sudo chown -R 10001:10001 ./data`.
- Update: `docker compose pull && docker compose up -d`.
- Lokal aus dem Quellcode bauen: `docker build -f agent/dist/Dockerfile -t vibe-agent .` im Repo-Ordner.

## 7. Mit dem Launcher koppeln

Im Launcher: **Server → Remote-Server hinzufügen**. Der Assistent zeigt dieselben Installationsbefehle zum Kopieren.
Danach gibt es zwei Wege:

| Weg | Wann | Was du eingibst |
|---|---|---|
| **Direkt** | Server im Heimnetz oder mit öffentlicher IP und freigegebenem Port 25580 | Adresse (`203.0.113.10:25580`) + Kopplungscode |
| **Über Vibe** | keine Portfreigabe möglich/gewünscht; Steuerung auch unterwegs und über `vibe.axolite.app/panel` | nur den Kopplungscode (Vibe-Konto mit Beta-Zugang nötig) |

Der Kopplungscode ist nur kurz gültig und nur einmal verwendbar. **Neuen Code holen:** einfach den
Installationsbefehl noch einmal ausführen (das aktualisiert den Agent gleichzeitig) – oder direkt:

```sh
sudo -u vibe-agent env VIBE_AGENT_DATA_DIR=/var/lib/vibe-agent vibe-agent pair   # Linux
```
```powershell
& "C:\Program Files\Vibe Agent\vibe-agent.exe" pair --data-dir C:\ProgramData\VibeAgent   # Windows (Administrator)
```

Beim Koppeln merkt sich der Launcher den **Fingerprint** des Zertifikats. Der Agent nutzt ein selbst erzeugtes
HTTPS-Zertifikat, deshalb warnt der Browser beim ersten Öffnen des Panels („Verbindung nicht privat“). Vergleiche
den angezeigten Fingerprint mit dem aus der Installation und bestätige dann.

## 8. Ports und Firewall

Die Installationsskripte **öffnen keine Ports**. Über die **Vibe-Verbindung** und den **Vibe-Tunnel** brauchst du
gar keine Freigabe – der Agent baut die Verbindungen von sich aus nach außen auf.

| Port | Wofür | Nötig, wenn … |
|---|---|---|
| `25580/tcp` | Agent: Launcher-Direktverbindung + Panel | du **direkt** koppeln oder das Panel ohne Vibe öffnen willst |
| `25565/tcp` | Minecraft (erster Server, weitere 25566 …) | Spieler **ohne** Vibe-Tunnel joinen sollen |
| `24454/udp` | Simple Voice Chat | Voice-Mod ohne Tunnel |
| `19132/udp` | Bedrock (Geyser) | Bedrock-Spieler ohne Tunnel |

Freigeben:

```sh
sudo ufw allow 25580/tcp && sudo ufw allow 25565/tcp                                     # Ubuntu/Debian mit ufw
sudo firewall-cmd --permanent --add-port=25580/tcp --add-port=25565/tcp && sudo firewall-cmd --reload   # Fedora/RHEL
```
```powershell
New-NetFirewallRule -DisplayName 'Vibe Agent' -Direction Inbound -Protocol TCP -LocalPort 25580,25565 -Action Allow
```

**Cloud-Firewall nicht vergessen:** Hetzner, Oracle, AWS, Google Cloud usw. haben zusätzlich eine Firewall im
Webinterface („Security Group“, „Firewall“, „Ingress Rules“). Dort müssen dieselben Ports erlaubt sein.

Panel nur für dich, ganz ohne offenen Port – per SSH-Tunnel:

```sh
ssh -L 25580:localhost:25580 root@203.0.113.10
```

Dann im Browser `https://localhost:25580` öffnen.

## 9. Update, Deinstallation, Optionen

**Update:** denselben Installationsbefehl erneut ausführen. Server, Welten, Einstellungen und Kopplungen bleiben
erhalten. Laufende Minecraft-Server werden vor dem Austausch sauber gestoppt.

**Deinstallieren** (Server-Daten bleiben erhalten):

```sh
curl -fsSL https://vibe.axolite.app/agent/install.sh | sh -s -- --uninstall
```
```powershell
& ([scriptblock]::Create((irm https://vibe.axolite.app/agent/install.ps1))) -Uninstall
```

**Alles löschen** inklusive aller Welten und Backups: zusätzlich `--purge` (Linux) bzw. `-Purge` (Windows).
Vorher Backups sichern!

| Linux | Windows | Wirkung |
|---|---|---|
| `--version 0.1.0` | `-Version 0.1.0` | bestimmte Version statt der neuesten |
| `--port 26000` | `-Port 26000` | anderer Port für Launcher/Panel (bleibt bei Updates erhalten) |
| `--no-pair` | `-NoPair` | keinen Kopplungscode erzeugen |
| `--uninstall` | `-Uninstall` | Agent entfernen |
| `--purge` | `-Purge` | mit Deinstallation: alle Daten löschen |
| `--dry-run` | `-DryRun` | Probelauf: nichts am System ändern, alles in einen Temp-Ordner |
| `--help` | – | Hilfe |

Linux-Optionen hängst du so an: `curl -fsSL https://vibe.axolite.app/agent/install.sh | sh -s -- --port 26000`.

## 10. Wo liegt was?

| | Linux | Windows | Docker |
|---|---|---|---|
| Programm | `/usr/local/bin/vibe-agent` | `C:\Program Files\Vibe Agent\vibe-agent.exe` | `/usr/local/bin/vibe-agent` im Image |
| Daten (Server, Java, Backups) | `/var/lib/vibe-agent` | `C:\ProgramData\VibeAgent` | Volume `/data` |
| Einstellungen | `/etc/vibe-agent/agent.env` | Startparameter des Dienstes | Umgebungsvariablen |
| Dienst | `systemctl status vibe-agent` | `Get-Service VibeAgent` | `docker compose ps` |
| Log | `journalctl -u vibe-agent -f` | Ereignisanzeige + Datenordner | `docker compose logs -f` |

`/etc/vibe-agent/agent.env` darfst du bearbeiten (danach `sudo systemctl restart vibe-agent`); Updates
überschreiben die Datei nicht:

```sh
VIBE_AGENT_DATA_DIR=/var/lib/vibe-agent
VIBE_AGENT_PORT=25580
VIBE_AGENT_BIND=0.0.0.0
```

## 11. Sicherheit

- Download nur aus den offiziellen GitHub-Releases, jede Datei wird gegen `SHA256SUMS` geprüft.
- Der Agent läuft als eigener, eingeschränkter Benutzer (`vibe-agent` bzw. `NT SERVICE\VibeAgent`, im Container
  UID 10001) und darf nur in seinen Datenordner schreiben (systemd: `ProtectSystem=strict`, `NoNewPrivileges`).
- Zugriff nur mit Kopplung: Kopplungscodes sind kurzlebig, Zugangstoken lassen sich im Panel/Launcher widerrufen.
- HTTPS mit eigenem Zertifikat, der Launcher pinnt den Fingerprint.
- Wer den Port 25580 nicht öffnen möchte, nutzt die Vibe-Verbindung oder einen SSH-Tunnel.
- Skript lieber erst lesen? `curl -fsSL https://vibe.axolite.app/agent/install.sh -o install.sh`, ansehen, dann
  `sh install.sh`.

## 12. Probleme lösen

| Problem | Lösung |
|---|---|
| `Permission denied` / „Bitte als root ausführen“ | Als `root` anmelden oder ein Konto mit `sudo` nutzen |
| „Prüfsumme stimmt nicht“ | Download war beschädigt oder wurde verändert – erneut versuchen. Bleibt es so, bitte melden |
| „Noch kein Agent-Release gefunden“ / „Release-Liste nicht erreichbar“ | Internet/DNS des Servers prüfen; GitHub erlaubt ohne Anmeldung 60 Abfragen pro Stunde und IP – kurz warten oder `--version` angeben |
| „Der Agent antwortet noch nicht“ | `sudo journalctl -u vibe-agent -n 50 --no-pager` ansehen; läuft auf Port 25580 schon etwas anderes? Dann `--port` nutzen |
| Launcher erreicht den Agent nicht (direkt) | Port 25580 in Server- **und** Cloud-Firewall freigeben, oder über Vibe koppeln |
| Freunde können nicht joinen | Vibe-Tunnel im Server einschalten, oder Port 25565 freigeben |
| Windows: nichts passiert nach „Ja“ | Das neue Fenster kann hinter anderen Fenstern liegen – Taskleiste prüfen |
| Windows: komische Zeichen statt Umlauten | Nur Anzeige, kein Fehler. Tritt auf, wenn das Skript als Datei in Windows PowerShell 5.1 läuft |

## 13. Für Entwickler: Release und Tests

**Dateien**

| Datei | Zweck |
|---|---|
| `agent/dist/install.sh` | Linux-Installer (POSIX `sh`, Debian/Ubuntu/Fedora/Arch/Alpine) |
| `agent/dist/install.ps1` | Windows-Installer (Windows PowerShell 5.1 und PowerShell 7) |
| `agent/dist/Dockerfile` (+ `.dockerignore`) | Image; `BIN_SOURCE=build` baut aus dem Quellcode, `BIN_SOURCE=prebuilt` nimmt fertige Binaries aus `.docker-bin/<plattform>/` |
| `agent/dist/docker-compose.yml` | Compose-Vorlage für Nutzer |
| `.github/workflows/agent-release.yml` | Release-Workflow |
| `.github/actions/agent-prepare` | Rust, Cargo-Cache, optional `pnpm run build:panel` |
| `scripts/agent-workspace.mjs` | Version/Workspace/Target-Ordner von `vibe-agent` per `cargo metadata` |

Die Skripte werden unter `https://vibe.axolite.app/agent/install.sh|ps1` ausgeliefert (Backend). `install.ps1` muss
dort als `text/plain; charset=utf-8` kommen und **ohne BOM** gespeichert sein – ein BOM bricht `irm | iex`, ein
fehlendes `charset` verstümmelt nur die Umlaute.

**Release veröffentlichen**

```bash
# Version in agent/Cargo.toml (bzw. Workspace) setzen, z. B. 0.1.0, Cargo.lock aktualisieren, committen
git tag agent-v0.1.0
git push origin agent-v0.1.0
```

Der Workflow **Agent-Release**

1. prüft, dass der Tag zur Version von `vibe-agent` passt (Vorabversion, wenn die Version ein `-` enthält),
2. baut auf den Runnern aus `pick-runner.yml` (Blacksmith nur im Freikontingent, sonst kostenlose GitHub-Runner,
   siehe [RELEASE.md](RELEASE.md#runner-kostet-nie-etwas)):
   - Linux statisch mit `cargo zigbuild`: `x86_64-unknown-linux-musl`, `aarch64-unknown-linux-musl`
   - Windows `x86_64-pc-windows-msvc` mit statischer C-Laufzeit
3. veröffentlicht ein GitHub-Release mit `vibe-agent-<target>`, `SHA256SUMS`, `install.sh`, `install.ps1`,
   `docker-compose.yml` – ausdrücklich **nicht als „latest“** (`--latest=false`), damit der Launcher-Updater
   (`releases/latest/download/latest.json`) weiter das Launcher-Release `v*` findet,
4. baut das Docker-Image für `linux/amd64` + `linux/arm64` aus den fertigen Binaries und pusht es nach
   `ghcr.io/vibec-studios/vibe-agent:<version>` und `:latest` (kostenlos für öffentliche Repos).

`workflow_dispatch` (manuell starten) baut nur, ohne zu veröffentlichen.

**Einmalig nach dem ersten Image:** auf GitHub unter *Organisation → Packages → vibe-agent → Package settings* die
Sichtbarkeit auf **Public** stellen (neue Pakete sind zunächst privat).

**Installer testen ohne echtes Release** – beide Skripte lesen diese Variablen:

| Variable | Standard |
|---|---|
| `VIBE_AGENT_API_URL` | `https://api.github.com/repos/vibec-studios/vibe-launcher/releases?per_page=100` |
| `VIBE_AGENT_DOWNLOAD_URL` | `https://github.com/vibec-studios/vibe-launcher/releases/download` |
| `VIBE_AGENT_ROOT` | Ziel für den Probelauf (sonst ein neuer Temp-Ordner) |
| `VIBE_AGENT_DRY_RUN=1` | wie `--dry-run` / `-DryRun` (Windows auch `VIBE_AGENT_UNINSTALL`, `VIBE_AGENT_PURGE`, `VIBE_AGENT_NO_PAIR`, `VIBE_AGENT_PORT`) |

Ein Fake-Release ist ein Ordner mit `releases.json` (`[{"tag_name":"agent-v0.1.0"}]`) und
`agent-v0.1.0/{vibe-agent-<target>,SHA256SUMS}`, ausgeliefert z. B. mit `python3 -m http.server`. Im Probelauf
werden Systembefehle (`useradd`, `systemctl`, `sc.exe`, `icacls` …) nur angezeigt, Dateien landen unter
`VIBE_AGENT_ROOT`, und das heruntergeladene Programm wird für `--version`, `status` und `pair` wirklich ausgeführt.

Erwartete CLI des Agents: `vibe-agent --version`, `run` (Windows-Dienst: `run --service`), `status` (Exit 0 = läuft),
`pair` (Code + Fingerprint lesbar ausgeben), Konfiguration über `--data-dir`/`--port`/`--bind` bzw.
`VIBE_AGENT_DATA_DIR`/`VIBE_AGENT_PORT`/`VIBE_AGENT_BIND`.
