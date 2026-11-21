# Launcher-Vergleich (`bench/compare`)

Reproduzierbarer Benchmark, der den **Vibe Launcher** mit anderen Minecraft-Launchern vergleicht: Startzeit, Arbeitsspeicher, CPU im Leerlauf, Installationsgröße, Zeit und Plattenplatz für identische Instanzen sowie die Zeit vom Klick bis zum Hauptmenü des Spiels.

Ergebnisse landen als JSON pro Phase und als statischer HTML-Bericht (ohne externe CDNs) in [`results/`](results/). Der aktuelle Bericht ist [`results/report.html`](results/report.html).

## Kurz

```powershell
node bench/compare/run.mjs --phase setup                  # Launcher, Java, Modpack laden (einmalig)
node bench/compare/run.mjs --phase idle                   # Start, RAM, CPU (ca. 25 min für 2 Launcher)
node bench/compare/run.mjs --phase install                # Instanzen anlegen (ca. 5 min, braucht Internet)
node bench/compare/run.mjs --phase launch                 # Spielstarts, fragt einmal nach Anmeldung
node bench/compare/run.mjs --phase report                 # Bericht neu bauen
node bench/compare/run.mjs --phase cleanup                # Testprozesse beenden, Testordner löschen
```

Mehrere Phasen gehen in einem Aufruf: `--phase setup,idle,install`. Ohne `--launchers` werden `vibe,prism` gemessen. `--launchers vibe,prism,atlauncher` nimmt ATLauncher dazu (bisher nur Start/RAM/CPU). Alle Optionen zeigt `node bench/compare/run.mjs --help`.

Voraussetzungen: Windows 10/11, Node 22 oder neuer (getestet mit 24), PowerShell 5.1 (für den Mess-Helfer), Internet.

## Was gemessen wird

| Phase | Messgröße | Wie |
|---|---|---|
| `setup` | Installationsgröße | Größe des entpackten Programmordners (Hardlinks nur einmal gezählt) |
| `idle` | Start bis Fenster | Prozessstart bis zum ersten sichtbaren Hauptfenster (EnumWindows) |
| `idle` | Start bis bedienbar | Fenster sichtbar **und** der Prozessbaum ist ruhig (CPU < 10 % eines Kerns für 1 s) |
| `idle` | RAM nach 30 s / 5 min | Working Set und privater Speicher **aller** Prozesse des Launchers (inkl. WebView2- bzw. Java-Kindprozesse) |
| `idle` | CPU im Leerlauf | CPU-Zeit des Prozessbaums zwischen 30 s und 5 min, in % eines Kerns |
| `install` | Vanilla bis spielbereit | Instanz 1.21.11 anlegen, inklusive Client, Bibliotheken und Assets, leerer Datenordner |
| `install` | Modpack bis spielbereit | `.mrpack`-Import von *Fabulously Optimized 12.3.0* (48 Mods), danach spielbereit |
| `install` | Plattenplatz | Zuwachs des Datenordners und Größe des Instanzordners |
| `launch` | Klick bis Hauptmenü | Startbefehl bis `Sound engine started` in `logs/latest.log`, kalt (erster Start nach Launcher-Start) und warm (direkt danach) |
| `launch` | RAM des Spiels | Working Set des Java-Prozesses im Hauptmenü |

**Gleiche Bedingungen:** Alle Launcher bekommen dieselbe Java (Eclipse Temurin JRE 21.0.13.1+2 aus `setup`), denselben RAM (1024–4096 MiB), dieselbe Minecraft-Version und dieselbe `.mrpack`-Datei. Auto-Updates und Discord sind aus. Jeder Launcher läuft in einem eigenen, frischen Datenordner. Die Reihenfolge wechselt pro Durchlauf (A,B → B,A), damit Netz- und Cache-Schwankungen beide treffen.

**Statistik:** Mehrere Durchläufe (Standard: idle 5, install 3, launch 3). Der Bericht zeigt den Median als Balken und die Spanne (min–max) als Linie. Beim Darüberfahren erscheinen IQR und n, die Tabellen zeigen zusätzlich die Standardabweichung. Der erste `idle`-Lauf mit leerem Datenordner wird als „Erststart“ getrennt geführt.

**Hintergrundlast:** Vor jedem Lauf misst die Suite 2 s lang die CPU-Last des Systems und die größten Verbraucher. Bei mehr als 10 % Gesamtlast, aktivem fremdem Java (z. B. Gradle oder ein anderes Minecraft) oder wenig freiem RAM steht eine Warnung im Lauf und im Bericht. Für belastbare Zahlen: andere Programme schließen, Netzteil anstecken, Energiesparplan „Höchstleistung“ oder „Ausbalanciert“, dann messen.

## Kandidaten

| Launcher | Version | Quelle | Automatisiert |
|---|---|---|---|
| Vibe Launcher | 1.0.0-beta.7, portable ZIP | GitHub-Release `vibec-studios/vibe-launcher` | idle, install, launch |
| Prism Launcher | 11.1.1, MSVC-Portable-ZIP | GitHub-Release `PrismLauncher/PrismLauncher` (SHA-256 fest) | idle, install, launch |
| ATLauncher | 3.4.42.0, JAR | GitHub-Release `ATLauncher/ATLauncher` | idle |
| Modrinth App, CurseForge, GDLauncher, XMCL | – | – | manuell (siehe unten) |

Versionen, Download-URLs und Prüfsummen stehen in `adapters/*.mjs` und `lib/config.mjs` und landen zusätzlich in jedem Ergebnis-JSON.

### Wie die Test-Kopien isoliert sind

- **Testordner:** Standard ist `%LOCALAPPDATA%\vibe-launcher-bench` (änderbar mit `--work`). Er liegt bewusst **nicht** unter `%TEMP%`, weil Prism bei Datenordnern in `%TEMP%` bei jedem Start eine Warnung zeigt, die die Messung verfälscht. `--phase cleanup` löscht ihn komplett.
- **Vibe:** Die EXE aus dem Release-ZIP läuft mit `VIBE_LAUNCHER_HOME=<Testordner>` und eigenem `WEBVIEW2_USER_DATA_FOLDER`. In diesem Modus registriert sie kein Deep-Link-Schema, hat keine Einzelinstanz-Sperre (stört also einen laufenden echten Vibe nicht) und nutzt im Schlüsselbund einen eigenen Eintrag `VibeLauncher-test-…`. Für `install` und `launch` bekommt nur die Test-Kopie zusätzlich `--remote-debugging-port`, damit die Suite Tauri-Befehle (`instance_create`, `instance_install`, `import_pack`, `instance_launch`) aufrufen kann. In `idle` ist das aus.
- **Prism:** Portable ZIP, Datenordner per `-d <Testordner>`. Die Suite legt eine `prismlauncher.cfg` an (Sprache, Java-Pfad, RAM, Theme, keine Auto-Updates), damit der Einrichtungsassistent nur noch den Konto-Schritt zeigt. Prism 11 zeigt diesen Schritt ohne Konto **bei jedem Start** (`Application::createSetupWizard`). Die Suite schließt ihn automatisch und misst bis zum Hauptfenster. Die Zeit für das Schließen ist in Prisms Startzeit enthalten (ca. 0,1–0,3 s). Importe laufen über `prismlauncher -d … -I <datei.mrpack>` und einen automatischen Klick auf „OK“ (UI Automation).
- **ATLauncher:** `javaw -jar ATLauncher.jar --working-dir <Testordner> --no-launcher-update --skip-setup-dialog …` mit derselben Temurin-JRE.
- Die Suite beendet nur Prozesse, die sie selbst gestartet hat oder deren EXE im Testordner liegt. Echte Launcher-Installationen und deren Daten werden nicht gelesen oder verändert. Zugangsdaten und Tokens werden nie gelesen.

## Spielstarts mit Anmeldung (`--phase launch`)

Für Spielstarts braucht jeder Test-Launcher ein Microsoft-Konto. Offline- oder Cracked-Konten werden bewusst nicht genutzt.

1. `node bench/compare/run.mjs --phase launch` in einem **interaktiven** Terminal starten (nicht im Hintergrund).
2. Die Suite öffnet nacheinander jede Test-Kopie mit ihrem dauerhaften Datenordner `data/<launcher>/login` und prüft, ob dort schon ein Konto existiert.
3. Wenn nicht, erscheint eine Anleitung, z. B.:
   - **Vibe:** links „Accounts“ → „Mit Microsoft anmelden“, im Login-Fenster anmelden.
   - **Prism:** oben rechts „Accounts“ → „Manage Accounts…“ → „Add Microsoft“.

   Danach im Terminal Enter drücken. Das passiert pro Launcher genau **einmal**. Der Login bleibt im Testordner, bis `cleanup` ihn löscht.
4. Die Suite legt in jedem Launcher dieselben Instanzen an („Bench Vanilla“, Modpack) und misst dann automatisch: Launcher starten, warten, bis er bedienbar ist, Spiel starten (kalt), auf das Hauptmenü warten, Spiel beenden, noch einmal starten (warm). Das läuft für jede Instanz und jeden Durchlauf, die Launcher abwechselnd.
5. Es läuft höchstens ein Minecraft gleichzeitig. Läuft schon ein fremdes Minecraft (erkannt am Fenstertitel, ohne Kommandozeilen zu lesen), wartet die Suite.

Der allererste Start einer Instanz enthält eventuell noch Downloads und steht deshalb getrennt im Bericht.

## Manuelle Kandidaten

Modrinth App, CurseForge und GDLauncher speichern ihre Konfiguration fest im Benutzerprofil (`%APPDATA%`). Eine Test-Kopie würde die echte Installation des Nutzers berühren. Die Suite fasst sie deshalb nicht an. So misst man sie trotzdem:

- In einer **Windows-Sandbox** oder VM ohne echte Installation installieren und dort `node bench/compare/run.mjs --phase attach --name "Modrinth App" --exe "C:\…\Modrinth App.exe"` ausführen. Das misst Start bis Fenster, Start bis bedienbar und RAM nach 30 s.
- XMCL läuft als ZIP portabel, legt seine Einstellungen aber unter `%APPDATA%\xmcl` ab. Mit `attach` messbar, wenn XMCL sonst nicht genutzt wird.

## Aufbau

```
run.mjs              Einstieg, Phasen, Ergebnis-JSON, Bericht
adapters/            je Launcher: Download, Seed-Konfiguration, Start, Instanzen, Spielstart
phases/              setup, idle, install, launch, attach, cleanup
lib/probe.cs|ps1|mjs Mess-Helfer (Prozessbaum, Working Set, CPU-Zeit, Fenster, UI Automation)
lib/…                Statistik, Downloads mit Prüfsumme, Systeminfo, Hintergrundlast, CDP
report/              statischer HTML-Bericht mit SVG-Balken (hell/dunkel)
results/             Ergebnisse (*.json) und report.html
```

Einen weiteren Launcher fügt man als Adapter in `adapters/` hinzu (`prepare`, `seed`, `start`, optional `onWindow`, `createVanilla`, `importPack`, `prepareLaunch`, `ensureInstances`, `launch`) und trägt ihn in `adapters/index.mjs` ein.

## Grenzen

- „Bedienbar“ wird für alle Launcher gleich über das Fenster plus CPU-Ruhe bestimmt. Bei Vibe misst `install` zusätzlich, wann die Navigationsleiste im DOM steht (`domReadyMs` im JSON).
- Prism wird über UI Automation bedient (gezielter Klick auf „Finish“ bzw. „OK“). Qt aktiviert dadurch seine Barrierefreiheits-Schicht, was minimal Zeit kosten kann. Ein einfacher Enter-Tastendruck ist keine Alternative: Im Assistenten hat „Add Microsoft account“ den Fokus.
- Beide Launcher laufen mit ihren **Standardeinstellungen**. Ein großer Unterschied ist die Download-Parallelität: Vibe nutzt 16 gleichzeitige Downloads, Prism 6 (`NumberOfConcurrentDownloads`). Mit `--prism-downloads 16` lässt sich der Vergleich bei gleicher Parallelität wiederholen.
- Die Installationszeiten hängen am Netz (Mojang-, Modrinth- und Fabric-CDN). Für Vergleiche mehrere Durchläufe nehmen und auf die Spanne schauen.
- Der Log-Marker für das Hauptmenü (`Sound engine started`) erscheint kurz bevor das Menü gezeichnet ist. Der Fehler ist für alle Launcher gleich.
