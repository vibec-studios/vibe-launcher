# Schnellere Instanz-Starts – Messung & Umsetzungsplan

> **Umsetzung (21.11.2026, Branch `henny/launch-speed-appcds`):** Hebel 1 und 2 sind umgesetzt, Hebel 3 (Defender) wurde gestrichen. Details und Nachher-Messung im Abschnitt [Umsetzung und Nachher-Messung](#umsetzung-und-nachher-messung) am Ende.

Stand: 21.11.2026, Code-Stand `195a33f` (vor dem Rust-Umbau R-A/R-B/R-C). Nur gemessen, kein Produktcode geändert.
Alle Skripte liegen in `bench/` (siehe Anhang), Rohdaten im Scratchpad des Agenten (nicht eingecheckt).

## Kurzfassung

| Hebel | Ersparnis (gemessen/geschätzt) | Aufwand | Empfehlung |
|---|---|---|---|
| 1. Vorbereitung im Launcher | **0,25–0,45 s** pro Start (von 0,3–0,7 s auf < 0,1 s), beim ersten Start pro Launcher-Sitzung zusätzlich **~0,19 s** (Java-Probe); bei kaltem Datei-Cache/HDD/Fremd-Virenscanner deutlich mehr (geschätzt 1–3 s) | klein | sofort umsetzen |
| 2a. Basis-CDS-Archiv für Mojangs Java-Runtimes (`-Xshare:dump`) | JVM-Grundstart ~60 ms (173 → 110 ms, Hello-World); im Minecraft-Start im Rauschen (±5 s Last) | sehr klein | umsetzen (Voraussetzung für 2b) |
| 2b. Dynamisches AppCDS-Archiv je Instanz (mit entsignierter Client-JAR-Kopie) | **Vanilla −25–36 %** (9,8 → 7,2 s / 18,9 → 12,0 s), **NeoForge −10–20 %** (≈ 2–4 s, unter Last bis −40 %), **Fabric ±0**; einmaliger Erstell-Lauf +18 s (Vanilla) / +48 s (NeoForge) | mittel | für Vanilla/Forge/NeoForge umsetzen, für Fabric/Quilt nicht. **Nur mit entsignierter Client-JAR-Kopie** – mit dem Original kostet der Erstell-Lauf 3,5–6,5 Min. |
| 3. Defender-Ausnahme (opt-in) | nicht gemessen (kein Admin, Manipulationsschutz an); Schätzung: warm 0–5 % (MsMpEng nur 1–9 CPU-s), beim ersten Start nach neuen Dateien höchstens 15–25 s (35–100 CPU-s Scan) | mittel | als opt-in mit UAC anbieten, nicht automatisch |

Wichtigste Funde:

1. **Asset-Prüfung läuft doppelt:** Bei jedem Start werden die ~4.600 Asset-Dateien zweimal einzeln per `metadata()` geprüft (`missing_files` für `vanilla` und `resolved`, auch bei Vanilla, wo beide gleich sind). Das macht 80–90 % der Launcher-Vorbereitung aus. Ein Verzeichnis-Scan der 256 `objects/xx`-Ordner ist ~6× schneller als Einzel-Stats.
2. **Mojangs Java-Runtimes (8/17/21/25) haben kein `classes.jsa`:** Damit fehlt selbst das Standard-CDS des JDK, und `-XX:+AutoCreateSharedArchive` wird mit „ArchiveClassesAtExit is unsupported when base CDS archive is not loaded“ ignoriert. `java -Xshare:dump` behebt das in < 1 s.
3. **Das Minecraft-Client-JAR ist signiert und hat ein 3,8-MB-Manifest** (115.000 Zeilen SHA-384-Digests). Daraus folgen zwei Dinge:
   - CDS archiviert keine Klassen aus signierten JARs.
   - Die JVM verarbeitet dieses Manifest im Dump-Modus extrem langsam: Der Start mit Archiv-Erstellung dauert 94 s (Java 25) bis 260 s (Java 21) länger. Das ist kein Defender-Effekt, MsMpEng lag dabei bei nur 5–9 CPU-s.
   - Eine entsignierte Kopie mit Mini-Manifest löst beides (siehe 2b).
4. **Mojangs Java 21.0.7 archiviert keine Klassen aus Pfaden mit Leerzeichen** („Skipping …: Unsupported location“), z. B. `C:\Users\Max Muster\…`. Temurin 21.0.11 und Java 25 sind nicht betroffen.
5. **`AutoCreateSharedArchive` erneuert das Archiv nicht, wenn sich der Klassenpfad ändert** (Loader-Update, geänderte JAR), nur bei einem JDK-Wechsel. Der Launcher muss den Archivnamen deshalb an einen Fingerabdruck binden.

---

## Messumgebung und Methode

- **PC:** i5-12600K (16 Threads), 32 GB RAM, Windows 11 Pro 26200, SSD, Defender aktiv mit Manipulationsschutz, kein Fremd-Virenscanner. Das Konto hat **keine** Adminrechte.
- **Last:** Während aller Messungen lief der PC durch Builds anderer Agenten (rustc, find) und Defender zu **75–90 %** voll. Die Zahlen sind deshalb verrauscht (±5 s bei den JVM-Zeiten). Ich nenne Mediane; die zweite Reihe lief abwechselnd (A/B/C/A/B/C), um Drift auszugleichen.
- **Launcher:** Debug-Build von `195a33f` (`cargo build -j 2 --features tauri/custom-protocol`, eingebettete Minimal-Seite statt Vite). Eigener Datenordner (`VIBE_LAUNCHER_HOME`), Steuerung per CDP mit `window.__TAURI_INTERNALS__.invoke`, Offline-Testprofil über `VIBE_DEV_OFFLINE_ACCOUNT`.
  - Für die Phasen gab es einen zweiten Build mit **temporärer** Zeitmessung (`bench/instrumentation.patch`, danach per `git checkout` verworfen).
  - Als Wrapper (`settings.wrapper_command`) diente `bench/wrap.py`: Es schreibt die exakte Java-Befehlszeile weg und beendet sich sofort. So wird die Vorbereitung ohne Minecraft gemessen, und die Befehlszeile lässt sich für die JVM-Messung 1:1 nachspielen.
- **Instanzen:**
  - `bench-vanilla`: 1.21.11
  - `bench-fabric`: 1.21.11, Fabric 0.20.1, 48 Top-Mods von Modrinth plus Abhängigkeiten = 51 JARs, u. a. Sodium, Iris, Lithium, Fabric API, JEI, Jade, Xaero, EMF/ETF, Voice Chat, C2ME
  - `bench-neoforge`: 1.21.1, NeoForge 21.1.267, 27 Top-Mods = 30 JARs
  - Java: Mojang `java-runtime-delta` 21.0.7 (wie beim Nutzer), 4096 MB Heap.
- **JVM-Messung** (`bench/jvmbench.py`): Die vom Launcher erzeugte Befehlszeile wird nachgespielt, die stdout-Zeilen bekommen Zeitstempel ab Prozessstart.
  - „Hauptmenü“ = letzte `Created: … -atlas`-Zeile (danach 6 s Ruhe). Weitere Marker: `Setting user` (Spiel-Init fertig), `Backend library: LWJGL` (Fenster), `Sound engine started`.
  - Danach wird das Fenster per `WM_CLOSE` sauber geschlossen, damit die JVM das CDS-Archiv beim Beenden schreiben kann.
  - Parallel misst `typeperf` die CPU-Zeit von MsMpEng (Defender).
- **Kalt / warm:**
  - **Kalt (Launcher):** erster Start nach Launcher-Neustart; leere In-Memory-Caches, Dateisystem-Cache des OS warm.
  - **Kalt (JVM):** allererster Start der Instanz, also frisch geladene JARs und erster Defender-Scan.
  - Einen echten OS-Kaltstart (Standby-Liste leeren) gab es nicht, dafür fehlen die Adminrechte.
  - **Warm:** alle weiteren Starts.
- Es lief immer höchstens ein Minecraft. Die Messreihe hat gewartet, solange das Minecraft des Nutzers lief (18:54–19:37 Uhr).

---

## Hebel 1 – Vorbereitung im Launcher (Klick → JVM-Start)

### Ablauf heute (`commands/game.rs::instance_launch` → `minecraft/launch.rs::launch`)

1. **UI** (`components/instance/actions.ts`): `autofix_quick`, also `deps::check` ohne Netz.
2. `instance_launch`: Gates, `begin_with`, `platform::on_launch` (`.vibe/instance.json`, **optsync**), `console::on_launch`, Task-Spawn.
3. `launch()`:
   - `vibey_client::before_launch`, nur wenn aktiv; dann Netzwerk mit bis zu 90 s Zeitlimit.
   - `autoupdate::before_launch` mit `deps::warn_before_launch`, also **noch einmal `deps::check`**; das Auto-Update selbst ist standardmäßig aus.
   - `worldbackup::before_launch`, standardmäßig aus.
4. `install_instance_opts` → `do_install` → Schnellpfad `install/local.rs::prepare`:
   - `resolve_local`: `loader_ready`, `load_chain`+`merge` ×2, **`missing_files(vanilla)` + `missing_files(resolved)`**. Jede dieser Prüfungen liest und parst den Asset-Index und prüft jede Datei per `tokio::fs::metadata` (je ein `spawn_blocking`).
   - `java::resolve` → `probe()`: `java -XshowSettings:properties -version`, nur im Speicher gecacht.
   - Asset-Index wird **ein drittes Mal** gelesen/geparst (`materialize_assets`, das bei 1.21 sofort zurückkehrt).
   - `extract_natives` (Marker), `link_client_jar`.
   - Außerdem: `install_state` wird bei **jedem** Start Installed → Installing → Installed gesetzt. Das sind 2× `instance.json` schreiben und 2× `instance://changed` an die UI.
5. Account (Token-Refresh nur bei Ablauf), `build`, Log-Zeilen, AFK, Pre-Launch-Hook, `gpupref`, `spawn`.

### Messung (Debug-Build, ms; warm = Median aus 3–4 Läufen)

| Phase | Vanilla kalt | Vanilla warm | Fabric (51 Mods) kalt | Fabric warm | NeoForge (30 Mods) kalt | NeoForge warm |
|---|---:|---:|---:|---:|---:|---:|
| UI `autofix_quick` (deps::check) | – | – | 7 | 13 | 19 | 15 |
| Gates + `begin_with` | 0,4 | 0,3 | 0,2 | 0,3 | 0,4 | 0,4 |
| `platform::on_launch` (optsync, instance.json) | 1,8 | 4,0 | 4,0 | 11,0 | 9,5 | 7,0 |
| `deps::warn_before_launch` (2. deps::check) | 0,4 | 0,6 | 5,9 | 17,1 | 11,8 | 13,8 |
| Vibey/Auto-Update/Welt-Backup (aus) | 0,7 | 0,1 | 0,1 | 0,2 | 0,1 | 0,2 |
| `loader_ready` + `load_chain` ×2 | 1,8 | 2,9 | 3,3 | 4,4 | 4,9 | 5,3 |
| **`missing_files(vanilla)`** | **77** | **157** | **61** | **207** | **189** | **147** |
| **`missing_files(resolved)`** | **66** | **123** | **52** | **159** | **331** | **119** |
| **`java::resolve` (Probe)** | **187** | 0,5 | 0,4¹ | 0,6 | 0,5¹ | 0,5 |
| Asset-Index 3. Mal + materialize | 9 | 14 | 8 | 15 | 27 | 13 |
| Natives + Client-JAR | 1,0 | 1,2 | 1,4 | 1,3 | 2,0 | 1,6 |
| Status-Wechsel/Lock (Rest von install_total) | ~2 | ~25 | ~4 | ~6 | ~8 | ~7 |
| Account, build, Log, AFK, Hook, gpupref | 1,5 | 2,0 | 1,3 | 2,3 | 3,0 | 2,6 |
| `spawn` + `attach` | 14 | 9 | 17 | 9 | 27 | 9 |
| **Summe `launch()`** | **363** | **339** | **156** | **425** | **606** | **325** |
| **Klick → Wrapper-Start (gesamt)**² | **429** | **407** | **241** | **520** | **747** | **416** |

¹ Java-Probe war durch den vorherigen Vanilla-Start im selben Launcher-Prozess schon im Speicher-Cache. Ohne diesen Cache kostet sie bei jeder Instanz einmal pro Sitzung ~190 ms.
² Inklusive ~60–80 ms Python-Start des Mess-Wrappers. Die unveränderte Binary (ohne Instrumentierung) lag gleich auf: warm 443–706 ms, kalt 414–1257 ms (NeoForge).

Hinweise zur Einordnung:
- Warm ist teils langsamer als kalt. Ursache ist die Systemlast (andere Agenten-Builds), nicht der Code.
- Es ist ein Debug-Build: JSON-Parsing (Asset-Index ~530 KB, Version-JSONs) ist in Release ~10× schneller. Der Hauptposten ist aber Syscall-gebunden (≈ 9.200 Datei-Opens) und schrumpft in Release kaum.
- Vergleichsmessung in Python, gleiche 4.593 Objekte, warm:

  | Methode | Dauer |
  |---|---:|
  | Einzel-`stat` | 208 ms (45 µs/Datei) |
  | `scandir` über die `objects/xx`-Ordner | 31–41 ms |

  Rusts `std::fs::metadata` öffnet unter Windows ebenfalls ein Handle pro Datei (CreateFile + GetFileInformationByHandle). `read_dir` liefert die Größe dagegen direkt aus `FindNextFile`, ohne die Datei zu öffnen.

### Was beim unveränderten zweiten Start unnötig wiederholt wird

| Wiederholung | Kosten (Debug, warm) | Ersparnis |
|---|---:|---:|
| `missing_files(vanilla)` **zusätzlich** zu `missing_files(resolved)`: resolved ist bei Vanilla identisch und bei Loadern eine Obermenge (`merge` übernimmt client/asset_index/logging/libraries) | 120–200 ms | 100 % davon |
| Asset-Objekte per Einzel-`metadata` statt Verzeichnis-Scan | 100–160 ms | ~80 % |
| Asset-Index 3× lesen + parsen | 10–30 ms | 2/3 |
| Java-Probe (Prozessstart `java -version`) nur im Speicher gecacht | ~190 ms beim 1. Start je Sitzung | 100 % (Disk-Cache) |
| `install_state` Installing → Installed (2 Schreibvorgänge, 2 UI-Events → UI lädt Instanzen neu) | 5–25 ms + UI-Refetch | 100 % |
| `deps::check` doppelt (UI-Vorabprüfung + `warn_before_launch`) | 13–17 ms | 50 % |
| Volle SHA1-Prüfung? **Nein.** Ohne `force` wird nur die Größe geprüft (`Net::is_valid`). Netzwerk im Normalfall: **keins** (Auto-Update/Vibey aus; Token-Refresh nur bei Ablauf) | – | – |

Seriell statt parallel: `java::resolve` läuft nach `resolve_local`, beides ist unabhängig.

**Geschätzte Ersparnis Hebel 1:**
- Warm: ~0,3 s (Debug) bzw. ~0,15–0,25 s (Release) pro Start.
- Erster Start je Launcher-Sitzung: zusätzlich ~0,19 s.
- Mit kaltem OS-Datei-Cache (direkt nach dem Booten), auf HDDs oder mit Fremd-Virenscannern, die jedes Öffnen abfangen, ist der Effekt der eingesparten ~9.000 Opens deutlich größer, geschätzt 1–3 s. Das ist nicht gemessen.

### Umsetzungsplan Hebel 1

Dateien/Funktionen nach heutigem Stand (nach dem Umbau entsprechend zuordnen):

1. **`minecraft/install/local.rs::resolve_local`:** Nur noch `missing_files(paths, &resolved, env)` prüfen, `vanilla` nur noch für `required_java`/`java.component` laden.
   - Test: Für Vanilla und eine Loader-Fixture liefert `missing_files(resolved)` dieselbe Fehlmenge wie die bisherige Summe. Eine fehlende Vanilla-Library, die der Loader ersetzt, darf keinen Fehlalarm auslösen.
2. **Neue Funktion `missing_assets(paths, &AssetIndex) -> usize`** (z. B. in `install/assets.rs`):
   - Die benötigten Hash-Präfixe gruppieren, je Präfix einmal `std::fs::read_dir(objects/xx)` und `DirEntry::metadata().len()` mit der Soll-Größe vergleichen.
   - Alles in **einem** `spawn_blocking`, oder in 4–8 Blöcke aufgeteilt.
   - `missing_files` prüft dann nur noch Libraries, Client-JAR, Logging-Config und Index einzeln (~60–120 Dateien).
   - Test: Temp-Ordner mit Objekten; fehlende Datei, falsche Größe und fehlender Präfix-Ordner werden erkannt.
3. **Asset-Index einmal parsen:** `resolve_local` gibt den geparsten `AssetIndex` zurück, `prepare` nutzt ihn für `materialize_assets` weiter. Optional einen Cache in `AppState` mit Schlüssel (Pfad, mtime, Größe).
4. **Java-Probe dauerhaft cachen** (`vibe-server-core/src/minecraft/java.rs::probe`):
   - `meta/java-probe.json` mit `{pfad: {mtime, size, JavaInstall}}`, beim Start laden, nach erfolgreicher Probe schreiben.
   - Wenn mtime oder Größe von `java(w).exe` **und** `jvm.dll` abweichen, neu proben, z. B. nach einem Java-Update auf demselben Pfad.
   - Zusätzlich `java::resolve` per `tokio::join!` parallel zu `resolve_local` starten.
   - Test: Cache-Treffer bei gleicher mtime, Neu-Probe bei geänderter mtime.
5. **Schnellpfad ohne Statuswechsel** (`install.rs::install_instance_opts`):
   - Ist `before == Installed` und liefert `local::prepare` `Some`, dann **weder** `Installing` setzen **noch** `modify` aufrufen. Das passiert nur noch, wenn tatsächlich (nach)installiert wird.
   - Den `install_lock` im Schnellpfad nicht nehmen. Ein paralleler Install auf dieselben Libraries schadet nicht, weil nur gelesen wird.
   - Test: Die Zahl der `instance://changed`-Events bei einem Warmstart ist 0.
6. **`deps::check` einmal pro Start:** Ergebnis 10 s lang im Speicher cachen, mit Schlüssel (Instanz, Mod-Ordner-Fingerprint aus `local::scan`). Klein, kann warten.
7. Optional: In `bench/launcher.mjs` einen Regressions-Check „Warmstart < 150 ms (Release)“ als manuelle Mess-Anleitung aufnehmen.

Risiken:
- Wird eine **ersetzte** Library-Version gelöscht, merkt das niemand, solange `resolved` sie nicht braucht. Das ist korrekt.
- Der Verzeichnis-Scan sieht keine Hash-Fehler, das tut aber auch die heutige Größenprüfung nicht. Die volle Prüfung bleibt bei „Reparieren“ (`force`).
- Persistenter Java-Cache: Ein manipuliertes JDK am gleichen Pfad mit gleicher mtime würde nicht erkannt. Akzeptabel, das heutige In-Memory-Verhalten ist genauso.

---

## Hebel 2 – JVM-Start / AppCDS

### Vorab-Funde (Hello-World-Tests, ohne Minecraft)

| Prüfung | Ergebnis |
|---|---|
| Basis-Archiv `bin/server/classes.jsa` in Mojangs Runtimes | **fehlt** in `java-runtime-delta` (21.0.7), `-epsilon` (25.0.1), `-gamma` (17.0.15), `jre-legacy` (8u51). Temurin-JDKs haben es. |
| `java -Xshare:dump` in der verwalteten Runtime | klappt bei allen vier in 0,8–2 s, schreibt `bin/server/classes.jsa` (13 MB bei 21) |
| JVM-Grundstart (Hello-World, Median 10 Läufe) | 21: 173 → 110 ms, 17: 171 → 111 ms mit Basis-Archiv. 8: kein Vorteil messbar. |
| `AutoCreateSharedArchive` ohne Basis-Archiv | wirkungslos („ArchiveClassesAtExit is unsupported when base CDS archive is not loaded“) |
| Pfad mit Leerzeichen | Mojang 21.0.7: Klassen werden **nicht** archiviert („Unsupported location“). Temurin 21.0.11 / 25: ok. |
| JDK-Wechsel (anderer 21er-Build) | Archiv wird automatisch neu erstellt |
| Klassenpfad geändert / JAR angefasst (`touch`) | Archiv wird **verworfen und nicht neu erstellt** („shared class paths mismatch“), auch nicht bei Temurin 21.0.11. Ohne Fingerabdruck im Dateinamen gibt es also nach jedem Loader-/Versionswechsel dauerhaft kein CDS mehr. |
| Zwei JVMs gleichzeitig, beide erstellen | beide laufen normal, die zuletzt endende schreibt, das Archiv ist danach gültig |
| Archiv ist von laufender JVM gemappt, zweite will neu schreiben | kein Fehler, die zweite läuft einfach ohne Archiv |
| Java 17 | `-XX:ArchiveClassesAtExit=` (erster Lauf) / `-XX:SharedArchiveFile=` (danach) funktioniert, nach `-Xshare:dump` |
| Java 8 (8u51 Oracle, Mojang `jre-legacy`) | nur Basis-CDS (`-Xshare:dump`). AppCDS ist dort ein kommerzielles Feature (`-XX:+UnlockCommercialFeatures`), also **nicht** nutzen. |
| Java 25 | dynamisches CDS wie 21; zusätzlich gäbe es den AOT-Cache (JEP 483/514/515: `-XX:AOTCacheOutput=` / `-XX:AOTCache=`). Mit MC 26.x nicht gemessen. |

### Minecraft-Messung

Zeit ab Prozessstart in Sekunden. **Hauptmenü** = letzte Atlas-Zeile; in Klammern `Setting user` (Spiel-Init fertig, weniger lastabhängig).

- **Reihe 1** (19:35–20:16): der Reihe nach, hohe Fremdlast (75–90 % CPU).
- **Reihe 2** (20:43–21:05): abwechselnd A/B/C, niedrigere Last. Für Vergleiche zählt vor allem Reihe 2.
- Java: Mojang `java-runtime-delta` 21.0.7. „Basis“ = dieselbe Runtime nach `-Xshare:dump`.

**Vanilla 1.21.11**

| Variante | Kalt (1. Start überhaupt) | Erstell-Lauf | Warm Reihe 1 | Warm Reihe 2 (Paare) |
|---|---:|---:|---|---|
| ohne CDS (heute) | 67,9 (62,9)¹ | – | 16,4 / 21,0 / 23,2 | **9,8 (6,5) / 18,9 (10,5)** |
| Basis-CDS | – | – | 18,6 / 26,5 / 20,3 | – |
| Basis + dyn. Archiv, Original-JAR | – | **366,3** | 10,6 / 11,1 / 23,3 | – |
| entsignierte JAR, ohne CDS | – | – | – | 8,5 (5,3) / 17,9 (8,5) |
| **entsignierte JAR + Basis + dyn. Archiv** | – | **27,6** | – | **7,2 (4,2) / 12,0 (5,7)** |

**Fabric 1.21.11 + 51 Mods**

| Variante | Kalt | Erstell-Lauf | Warm Reihe 1 | Warm Reihe 2 (Paare) |
|---|---:|---:|---|---|
| ohne CDS (heute) | 48,2 (34,4) | – | 35,3 / 31,8 / 38,3 | **19,4 (11,3) / 23,2 (9,8)** |
| Basis-CDS | – | – | 36,9 / 26,8 / 31,9 | – |
| Basis + dyn., Original-JAR | – | **396,0** | 24,4 / 31,9 / 30,1 | – |
| entsignierte JAR, ohne CDS | – | – | – | 20,9 (10,9) / 22,2 (10,1) |
| entsignierte JAR + Basis + dyn. | – | **79,4** | – | **22,0 (10,1) / 21,8 (9,4)** |

**NeoForge 1.21.1 + 30 Mods**

| Variante | Kalt | Erstell-Lauf | Warm Reihe 1 | Warm Reihe 2 (Paare) |
|---|---:|---:|---|---|
| ohne CDS (heute) | 55,7 (38,5) | – | 47,0 / 32,4 / 33,7 | 40,6² / **22,9 (15,7) / 21,2 (15,3) / 19,3 (13,3)** |
| Basis-CDS | – | – | 52,4 / 40,3 / 37,3 | – |
| Basis + dyn., Original-JAR | – | **227,0** | 19,7 / 18,5 / 20,3 | 41,7² / **19,0 (13,4)** |
| entsignierte JAR + Basis + dyn. | – | **68,3** | – | **17,1 (11,9) / 17,2 (12,1)** |

¹ Ausreißer: „287 Datafixer optimizations took 53187 milliseconds“ (sonst 0,4–1,5 s), zeitgleich 35 CPU-s Defender.
² Dieses Paar lief mit 22–28 CPU-s Defender-Last (Fremd-Build), beide Werte sind gleich verzerrt.

Archivgrößen:

| Instanz | Original-JAR | entsignierte JAR |
|---|---:|---:|
| Vanilla | 45 MB | 100 MB |
| Fabric | 144 MB | 140 MB |
| NeoForge | 138 MB | 135 MB |

Das Spielende dauert im Erstell-Lauf 3–4 s länger (Dump beim Beenden: 8,7–9,7 s statt 5,2–5,6 s bis Prozessende).

**Auswertung**

- **Vanilla:** −25 bis −36 % bis Hauptmenü (9,8 → 7,2 s bzw. 18,9 → 12,0 s), Spiel-Init sogar −35 bis −45 %. Nur Entsignieren ohne CDS bringt −5 bis −15 %, vermutlich weil die Signaturprüfung beim Klassenladen wegfällt.
- **NeoForge:** −10 bis −20 % bei normaler Last (≈ 2–4 s). Unter hoher Last waren es bis −40 % (Reihe 1: 33,7 → 19,7 s Median).
- **Fabric:** **kein messbarer Gewinn** (±1 s). Knot lädt Minecraft und alle Mods mit eigenem Klassenlader aus transformierten Bytes (Mixins); die landen nicht im Archiv. Dafür kostet der Erstell-Lauf einmalig ~60 s extra. → Für Fabric/Quilt **kein** dynamisches Archiv, nur Basis-CDS.
- **Basis-CDS allein** ist im Minecraft-Start im Rauschen (theoretisch ~60 ms). Es ist aber Voraussetzung für das dynamische Archiv.
- **Stabilität:** Bei allen 23 Starts mit dynamischem Archiv (plus 9 nur mit Basis-CDS) lief das Spiel normal bis zum Hauptmenü und ließ sich sauber schließen. Archive wurden korrekt wiederverwendet (gleiche Größe, keine Neuerstellung). Eine Welt wurde **nicht** betreten. Das muss vor dem Ausrollen noch getestet werden.

### Ursache des langsamen Erstell-Laufs: signiertes Client-JAR mit Riesen-Manifest

- Im ersten Lauf mit `AutoCreateSharedArchive` (Archiv fehlt, Dump-Modus) erschien die erste Logzeile erst nach 160–325 s. Das passiert auch ohne Minecraft:
  - Hello-World mit dem Fabric-Klassenpfad: 0,3 s normal, 189 s mit `-XX:ArchiveClassesAtExit`.
  - Pro JAR gemessen kosten 67 von 68 JARs ~0,2 s. **Allein das Client-JAR (31 MB) kostet 259 s.**
- Mit `-Xlog:class+path` sieht man die Lücke direkt nach `path [2] = …\1.21.11.jar`, noch vor dem Programmstart.
- Ursache: Das Manifest hat **3.780.310 Bytes und 115.652 Zeilen** (SHA-384-Digest jedes Eintrags, mit Fortsetzungszeilen). Das JAR ist von Mojang signiert (`META-INF/MOJANGCS.SF/.RSA`). Die JVM liest im Dump-Modus das Manifest (Class-Path-Attribut) offenbar mit quadratischem Aufwand.
- **Nicht Defender:**

  | Java | Dauer | CPU-Zeit MsMpEng |
  |---|---:|---:|
  | Mojang 21.0.7 | 210 s | 31 CPU-s |
  | Temurin 21.0.11 | 190 s | 8,6 CPU-s |
  | Temurin 25.0.2 | 94 s | 5,4 CPU-s |

- Dasselbe gilt für NeoForge: Dort liegt das per `link_client_jar` hartverlinkte Vanilla-JAR `versions/neoforge-21.1.267/neoforge-21.1.267.jar` (3,2-MB-Manifest) auf dem Klassenpfad (in `-DignoreList`).
- Außerdem lehnt CDS Klassen aus **signierten** JARs grundsätzlich ab. Mit dem Original-JAR landen die Minecraft-Klassen also nie im Archiv (Vanilla-Archiv 45 MB statt 100 MB).
- **Lösung (getestet):** eine entsignierte Kopie (`bench/strip_jar.py`): Signaturdateien weg, Manifest nur `Manifest-Version` + `Main-Class`, alle anderen Einträge unverändert.
  - Dauert einmalig 2,7 s (Python).
  - Damit sinkt der Erstell-Lauf bei Vanilla von **366 s auf 27,6 s**, und die Minecraft-Klassen kommen ins Archiv.

### Umsetzungsplan Hebel 2

Neues Modul `minecraft/cds/` (z. B. `base.rs`, `jar.rs`, `args.rs`, `fingerprint.rs`), aufgerufen aus `install` bzw. `launch::build`.

1. **Basis-Archiv je verwalteter Runtime** (`vibe-server-core/src/minecraft/java.rs`):
   - Nach `install_mojang_component`/`install_adoptium`, und einmal nachträglich für vorhandene Runtimes im Hintergrund nach dem Launcher-Start:
     - Fehlt `bin/server/classes.jsa` oder passt der Marker `.vibe-cds.json` nicht (Größe+mtime von `jvm.dll`), wird `<java> -Xshare:dump` ausgeführt (`CREATE_NO_WINDOW`, Zeitlimit 60 s).
     - Zusätzlich `-XX:-UseCompressedOops -Xshare:dump` für `classes_nocoops.jsa`, sonst nutzt ein Heap > 32 GB das Archiv nicht.
   - Nur für Runtimes unter `java_root`. Fremde JDKs bleiben unangetastet (Program Files ist schreibgeschützt; Temurin bringt das Archiv ohnehin mit).
   - Der Start wartet **nie** darauf. Ist das Archiv noch nicht fertig, gibt es ohne dynamisches CDS keinen Nachteil.
   - Achtung Reparatur: `install_mojang_component(force)` löscht keine Zusatzdateien (gelesen: es prüft nur Manifest-Dateien). Nach einem Runtime-Update stimmt `jvm.dll` nicht mehr → neu dumpen.
2. **CDS-taugliche Client-JAR** (`cds/jar.rs`):
   - Aus `versions/<mc>/<mc>.jar` eine entsignierte Kopie erzeugen: Signaturdateien entfernen, Manifest auf `Manifest-Version`/`Main-Class` kürzen, alles andere byteweise kopieren. Schreiben nach `tmp` + rename.
   - Ablage nach SHA1 des Originals, z. B. `meta/cds/jars/<sha1>.jar`. Vanilla setzt diese Kopie statt des Originals auf den Klassenpfad.
   - Für Loader-Profile ersetzt `link_client_jar` den Hardlink `versions/<id>/<id>.jar` durch diese Kopie. Der Dateiname bleibt, weil Forge/NeoForge ihn erwarten.
   - Die heutige Prüfung `target.len() == base_len` braucht dann einen Marker (Quell-SHA1).
   - Das Original bleibt unverändert, damit die SHA1-Prüfung und Reparatur weiter funktionieren.
   - Nur erzeugen, wenn CDS für die Instanz aktiv ist. Einmalig ~1–3 s, am besten im Hintergrund direkt nach der Installation.
3. **Startargumente** (`cds/args.rs`, aufgerufen in `launch::build` vor den Nutzer-JVM-Argumenten):
   - Java ≥ 19: `-XX:SharedArchiveFile=<game_dir>/.vibe/cds/<fp>.jsa -XX:+AutoCreateSharedArchive`
   - Java 13–18 (also 17): Datei vorhanden → `-XX:SharedArchiveFile=…`, sonst `-XX:ArchiveClassesAtExit=…`
   - Java < 13 (8): nichts, nur das Basis-Archiv aus Schritt 1.
   - **Fingerabdruck `fp`** = SHA1 über: Java-Pfad, `java.runtime.version`, `jvm.dll` Größe+mtime, Main-Class, kompletter `-cp`- und `-p`-String, Größe+mtime jedes Eintrags. Andere `*.jsa` in `.vibe/cds/` beim Start löschen. Das ist nötig, weil die JVM bei geändertem Klassenpfad nicht neu erstellt (siehe oben).
   - **Nicht aktivieren**, wenn:
     - die Nutzer-JVM-Argumente schon `-Xshare`, `SharedArchiveFile`, `ArchiveClassesAtExit` oder `AOTCache` enthalten,
     - das Basis-Archiv fehlt,
     - der Loader Fabric/Quilt ist: kein messbarer Gewinn, aber ein einmalig ~60 s langsamerer Erstell-Lauf, siehe Tabelle,
     - eine zweite Sitzung derselben Instanz startet (`slot > 1`). Dann nur `-XX:SharedArchiveFile` ohne AutoCreate und nur, wenn die Datei existiert.
   - Bei Mojang 21.0.7 und Leerzeichen im Pfad bringt es wenig, schadet aber nicht. Im Log vermerken.
4. **Log/UI:**
   - Launcher-Zeile „Java-Schnellstart (CDS): aktiv, 100 MB“ bzw. „wird beim Beenden erstellt (einmalig, Spielende dauert ~4 s länger)“.
   - Einstellung global `java_cds: bool` (Beta: Standard an für Vanilla/Forge/NeoForge), Instanz-Override `java.cds: Option<bool>`, Knopf „Schnellstart-Cache leeren“.
   - „Reparieren“ (`force`) löscht `.vibe/cds/` und die CDS-JAR-Kopie. Die Archive (45–140 MB je Instanz) in der Speicheranzeige mitzählen.
5. **Absicherung:**
   - Ungültige oder kaputte Archive ignoriert die JVM bei `-Xshare:auto` selbst.
   - Zusätzlich: Endet eine Sitzung mit CDS-Argumenten in < 30 s mit Fehlercode, wird das Archiv gelöscht und beim nächsten Start einmal ohne CDS gestartet. Ins Log schreiben.
6. **Tests:**
   - Unit-Tests für `args.rs`: je Java-Hauptversion, mit Nutzer-Flags, `slot > 1`, Fabric aus.
   - Unit-Tests für `fingerprint.rs`: Klassenpfad- oder mtime-Änderung ergibt einen neuen Namen.
   - Unit-Tests für `jar.rs`: Manifest minimal, `*.SF/*.RSA` weg, alle anderen Einträge identisch.
   - Marker-Logik des Basis-Dumps.
   - Manuell: `bench/run_jvm_pairs.sh` plus ein echter Weltbeitritt mit CDS (nicht gemessen!).
7. **Risiken:**
   - Speicherplatz.
   - Erster Start mit Archiv-Erstellung: Vanilla +10–18 s, Spielende +3–4 s (Dump beim Beenden).
   - Entsignierte JAR: Minecraft prüft die eigene Signatur nicht; Mods, die das tun, sind mir nicht bekannt.
   - JVM-Bugs rund um CDS: Fallback wie in Schritt 5.
   - **Ungetestet:** Java 17 mit Forge 1.18–1.20, Java 8 mit 1.12, Java 25 mit 26.x.

---

## Hebel 3 – Windows Defender

### Warum nicht gemessen

- Das Konto hat keine Adminrechte, und der **Manipulationsschutz ist aktiv** (`IsTamperProtected = True`).
- `Add-MpPreference -ExclusionPath` geht nur erhöht, also mit UAC-Dialog. Auch Lesen klappt ohne Admin nicht: `Get-MpPreference` liefert „N/A: Must be an administrator to view exclusions“, `MpCmdRun -CheckExclusion` endet mit `0x80070005`.
- Laut Vorgabe habe ich deshalb **keine Ausnahme gesetzt**.

### Schätzung aus eigenen Daten (CPU-Zeit von MsMpEng während jedes Starts, `typeperf`)

| Start | MsMpEng CPU-s | Wanduhr bis Hauptmenü |
|---|---:|---:|
| Vanilla, allererster Start (frische JARs) | 35 | 67,9 s (davon 53 s DataFixer-Optimierung, sonst 0,5–1 s) |
| Fabric 51 Mods, allererster Start | 101 | 48,2 s (warm 31–38 s) |
| NeoForge 30 Mods, allererster Start | 59 | 55,7 s (warm 32–47 s) |
| Warme Starts in ruhiger Phase (Reihe 2) | 1–9 | 7–23 s |
| Warme Starts unter Fremdlast (Reihe 1) | 9–100 | – |

- Defender cacht seine Urteile pro Datei. Bei warmen Starts fallen nur wenige CPU-Sekunden an, verteilt auf andere Kerne und teils asynchron. Eine Ausnahme spart dort **geschätzt 0–5 %**, also kaum mehr als das Messrauschen.
- Interessant ist der **erste Start nach neuen Dateien** (neue Version, Mod-Updates, Java-Update): 35–100 CPU-s Scan-Arbeit. Kalt- und Warmstart liegen hier 15–25 s auseinander; das ist die **obere Grenze** dessen, was eine Ausnahme sparen könnte. Ein Teil davon ist Erststart-Arbeit des Spiels selbst (Configs, Caches).
- Der Ausreißer mit 53 s DataFixer beim ersten Vanilla-Start traf mit 35 CPU-s Defender-Last zusammen. Die Ursache ließ sich ohne Ein-/Ausschalten nicht trennen.

### Quellen anderer

- Microsoft: Dev Drive + Defender-Leistungsmodus (asynchrones Scannen) „bis zu 30 %“ schnellere Builds. Microsoft betont, dass der Leistungsmodus **sicherer ist als Ordner-Ausnahmen**. [Microsoft Learn: Performance mode](https://learn.microsoft.com/en-us/defender-endpoint/microsoft-defender-endpoint-antivirus-performance-mode), [Windows Blog: Dev Drive](https://blogs.windows.com/windowsdeveloper/2023/06/01/dev-drive-performance-security-and-control-for-developers/)
- Anekdotisch bei Java-Desktop-Apps: Start von ~2 min auf ~20 s nach Ausnahme für `javaw.exe` ([Portfolio Performance Forum](https://forum.portfolio-performance.info/t/why-is-pp-so-insanely-slow-opening-up/32119/13)); „Defender adds 1.5 minutes or more to Eclipse launch“ ([eclipse.org platform-dev](https://eclipse.org/lists/platform-dev/msg01700.html)); [microsoft/java-wdb#9](https://github.com/microsoft/java-wdb/issues/9).
- Eine kontrollierte Messung speziell für Minecraft habe ich nicht gefunden. Die vielen „Add Minecraft to Defender exclusions“-Seiten sind generische Texte ohne Daten.

### Sauberer Weg: opt-in-Ausnahme nur für den Vibe-Datenordner

1. **Statusanzeige** unter Einstellungen → Leistung, ohne Admin abfragbar:
   - `Get-MpComputerStatus` liefert `AMRunningMode` (Normal/Passive/EDR Block), `RealTimeProtectionEnabled` und `IsTamperProtected`.
   - Fremd-Virenscanner über `root/SecurityCenter2 → AntiVirusProduct` (displayName, productState). Ist ein anderer Scanner aktiv und Defender passiv, ist eine Defender-Ausnahme wirkungslos. Dann stattdessen einen Hinweis zeigen.
   - Gruppenrichtlinie/Intune: Gibt es `HKLM\SOFTWARE\Policies\Microsoft\Windows Defender\Exclusions` oder `…\Policies\Microsoft\Windows Defender\DisableLocalAdminMerge = 1`, werden lokale Ausnahmen ignoriert bzw. sind sie verwaltet. Dann „Von deiner Organisation verwaltet“ anzeigen und den Knopf deaktivieren.
   - Den eigenen Zustand merkt sich der Launcher selbst (`settings.defender_exclusion = { paths, added_at }`), weil Lesen nicht ohne Admin geht. Beim Hinzufügen und Entfernen prüft der erhöhte Prozess das Ergebnis und meldet es zurück.
2. **Hinzufügen** (Knopf „Spieldateien vom Echtzeit-Scan ausnehmen“ mit Erklärtext und Risikohinweis):
   - Rust startet per `ShellExecuteExW` mit dem Verb `runas` → **UAC-Dialog**. Es läuft `powershell.exe -NoProfile -NonInteractive -EncodedCommand <b64>`.
   - Inhalt: `Add-MpPreference -ExclusionPath '<p1>','<p2>'`, danach `(Get-MpPreference).ExclusionPath` prüfen und das Ergebnis als JSON in eine Ergebnisdatei mit Zufallsnamen unter `%TEMP%` schreiben. Rust wartet auf den Prozess (`WaitForSingleObject`) und liest die Datei.
   - Pfade in einfache Anführungszeichen setzen, `'` als `''` maskieren, absolute kanonische Pfade ohne abschließenden `\`.
   - UAC abgelehnt (`ERROR_CANCELLED`) → freundliche Meldung, nichts gespeichert.
3. **Welche Pfade:** Empfohlen sind **nur die geprüften Spieldateien**: `meta/libraries`, `meta/versions`, `meta/assets`, `meta/natives`, `java/`.
   - Diese Dateien kommen per SHA1-geprüftem Download von Mojang, Fabric oder NeoForge.
   - **Nicht** ausnehmen: `instances/*/mods`, Resourcepacks, Downloads und Importe. Das sind Inhalte von Dritten und der Ort, an dem echte Malware-Mods landen; Fälle wie „fractureiser“ 2023 gab es wirklich.
   - Die Variante „ganzer Datenordner“ höchstens als zweite, deutlich gewarnte Option.
   - **Keine** Prozess-Ausnahme für `java.exe`/`javaw.exe`: Die gilt für jede Java-Anwendung auf dem PC.
4. **Entfernen:**
   - Knopf „Ausnahme entfernen“ (`Remove-MpPreference -ExclusionPath …`, ebenfalls über UAC).
   - Automatisch angeboten beim Verschieben des Datenordners (`datadir`): alte Pfade entfernen, neue anbieten.
   - Im Deinstallations-Hinweis erwähnen. Ein erhöhter Uninstaller-Schritt (NSIS) ist optional; der Pfad fehlt nach der Deinstallation ohnehin.
5. **Alternative ohne Ausnahme:**
   - Hinweis „Datenordner auf ein Dev Drive verschieben“ (Windows 11, ReFS, Defender-Leistungsmodus). Gleicher Mechanismus wie `datadir`, ohne Sicherheitslücke. Microsoft empfiehlt das ausdrücklich statt Ausnahmen.
6. **Risiken:**
   - In ausgenommenen Ordnern werden Dateien nicht mehr in Echtzeit geprüft.
   - Ausnahmen sind für jede Software auslesbar und werden von Malware als Ablageort gezielt gesucht.
   - Bei verwalteten Geräten widerspricht das unter Umständen der Firmen-Richtlinie.
   - Der Nutzen bei warmen Starts ist klein (siehe Schätzung). Darum nur **opt-in**, nie automatisch, und mit ehrlichem Text („spart vor allem beim ersten Start nach Updates Zeit“).
7. **Tests:**
   - Unit-Tests für das Zusammenbauen des Befehls (Maskierung, Pfadliste, Base64/UTF-16LE) und für das Auswerten der Status-Ausgaben (Normal/Passive, Fremd-AV, GPO-Schlüssel).
   - Manuell in einer VM mit Admin: hinzufügen, prüfen, entfernen; UAC ablehnen; Manipulationsschutz an/aus.
   - Mit `bench/run_jvm_series.sh` vorher/nachher messen. Das ist auf diesem PC noch offen, weil Adminrechte nötig sind.

---

## Empfohlene Reihenfolge

1. **Hebel 1:** Schritte 1–5, klein und risikoarm, direkt nach dem Umbau.
2. **Hebel 2a:** Basis-CDS-Dump für verwaltete Runtimes, im Hintergrund, harmlos.
3. **Hebel 2b:** CDS-JAR + dynamisches Archiv für Vanilla/Forge/NeoForge, zunächst als Beta-Schalter. Vor dem Standard-An noch prüfen:
   - Weltbeitritt
   - Forge 1.18–1.20 auf Java 17
   - 1.12 auf Java 8 (nur Basis-CDS)
   - Pfad mit Leerzeichen bei Temurin vs. Mojang-Runtime
4. **Hebel 3:** opt-in-Defender-Ausnahme nur für geprüfte Spieldateien, plus Dev-Drive-Hinweis. Vorher auf einem Admin-Konto vorher/nachher messen.

Offen bzw. nicht gemessen:
- echter OS-Kaltstart nach dem Booten
- Release-Build
- Defender mit und ohne Ausnahme
- Java 25 AOT-Cache (`-XX:AOTCacheOutput`) für MC 26.x
- Quilt, Forge, ältere Versionen
- Weltbeitritt mit CDS
- Wiederholungen bei ruhigem System: n = 2–4 pro Variante, Rauschen ±2–5 s

## Anhang – Reproduktion

Dateien in `bench/`:

| Datei | Zweck |
|---|---|
| `cdp.mjs` | CDP-Client: `invoke`, Event-Listener für `task://update`, `game://state`, `game://log` |
| `launcher.mjs` | `start` / `stop` / `call <cmd> <json>` / `install <id>` / `launch <id> <label> <loader>` mit Phasen aus den Task-Meldungen |
| `setup.mjs`, `addmods.mjs` | Test-Instanzen anlegen, Mods von Modrinth installieren |
| `wrap.py` | Wrapper-Befehl: Java-Befehlszeile + Zeitstempel als `spawn-*.json` sichern, sofort beenden (`VIBE_BENCH_WRAP=run` startet stattdessen das Spiel) |
| `instrumentation.patch` | temporäre `BENCH …us`-Zeitmessung (nicht committen, nur `git apply` für Messungen) |
| `parse_bench.py` | Auswertung der `BENCH`-Zeilen gegen `launch-results.jsonl` |
| `jvmbench.py` | Startbefehl nachspielen, Marker messen, Fenster per WM_CLOSE schließen, MsMpEng-CPU per `typeperf`, wartet automatisch, solange ein anderes Minecraft läuft (`BENCH_MC_CHECK`) |
| `run_jvm_series.sh`, `run_jvm_pairs.sh` | Messreihen 1 und 2 |
| `strip_jar.py` | entsignierte Client-JAR-Kopie |

Ablauf:

```sh
# Debug-Build mit eingebetteter Minimalseite (dist/index.html, gitignored)
cargo build -j 2 --features tauri/custom-protocol --bin vibe-launcher
export BENCH_EXE=<exe> BENCH_HOME=<temp> BENCH_OUT=<temp>/out BENCH_PORT=9377
node bench/launcher.mjs start
BENCH_WRAPPER='<python.exe> <repo>/bench/wrap.py' BENCH_MODS=<modrinth-ids> node bench/setup.mjs
node bench/launcher.mjs launch bench-fabric warm1 fabric      # Vorbereitung messen (Wrapper beendet sofort)
cp <java-runtime> jre/delta-cds && jre/delta-cds/bin/java -Xshare:dump
BENCH_JRE=<temp>/jre bash bench/run_jvm_series.sh             # bzw. run_jvm_pairs.sh
```

---

## Umsetzung und Nachher-Messung

Stand 21.11.2026, Branch `henny/launch-speed-appcds` (auf `integ/refactor`). Hebel 3 (Defender-Ausnahme) wurde vom Nutzer gestrichen und ist nicht umgesetzt.

### Hebel 1 – Vorbereitung

| Punkt aus dem Plan | Umsetzung |
|---|---|
| 1. nur noch eine Prüfung | `install/local.rs::resolve_local` prüft nur noch `resolved` (`check_files`); `vanilla` wird nur noch für Java-Version/-Komponente, Asset-Index-ID und Log-Konfiguration gelesen. |
| 2. Assets ordnerweise | `install/check.rs::missing_assets`: Soll-Objekte nach Hash-Präfix gruppiert, je `objects/xx` ein `read_dir`, Größe aus `DirEntry::metadata` (unter Windows aus `FindNextFile`, ohne Datei-Handle), auf 4 Threads verteilt. Einzelprüfung bleibt nur für Libraries, Client-JAR, Log-Konfiguration und Index. |
| 3. Asset-Index einmal parsen | `resolve_local` gibt den geparsten Index zurück, `prepare` nutzt ihn für `materialize_assets`. |
| 4. Java-Probe dauerhaft | `vibe-server-core/src/minecraft/java/probe.rs`: `meta/java-probe.json`, Schlüssel Pfad, gültig nur bei gleicher Größe+mtime von `java(w).exe` **und** `jvm.dll`/`libjvm`. Kaputte Datei → leerer Cache. |
| 5. kein Statuswechsel im Schnellpfad | `install_instance_opts`: Ist die Instanz installiert und der Installations-Lock frei, läuft `local::prepare` **ohne** `Installing → Installed` (keine zwei `instance.json`-Schreibvorgänge, keine zwei `instance://changed`). Der Lock wird dabei per `try_lock` gehalten, damit ein eventueller Java-Download nicht mit einer parallelen Installation kollidiert; ist er belegt, gilt der alte Weg. |
| 6. `deps::check` einmal | **nicht umgesetzt** (≈ 15 ms, liegt in `content/`). |
| „Reparieren“ | unverändert volle Prüfung (`force`), löscht zusätzlich die CDS-Archive der Instanz. |

### Hebel 2 – AppCDS (`src-tauri/src/minecraft/cds/`)

- `rules.rs`: nur Vanilla/Forge/NeoForge, Java ≥ 19, keine eigenen `-Xshare`/`SharedArchiveFile`/`ArchiveClassesAtExit`/`AOTCache`/`UseCompressedOops`-Argumente, Heap < 32 GB. **Leerzeichen** im Datenordner- oder Java-Pfad schalten CDS bei Java < 21.0.11 ab (Mojangs 21.0.7 archiviert dort nichts).
- `base.rs`: fehlt `bin/server/classes.jsa` bei einer verwalteten Runtime (unter `java/`), läuft einmalig `java -Xshare:dump` im Hintergrund (ohne Fenster, 120 s Zeitlimit); Marker `.vibe-cds` mit Größe+mtime von `jvm.dll` erkennt Runtime-Updates. Fremde JDKs werden nie verändert. Der Start wartet nie darauf.
- `jar.rs`: entsignierte Kopie des Client-JARs (Signaturdateien weg, Manifest nur `Manifest-Version`+`Main-Class`, alle anderen Einträge per `raw_copy_file` unverändert), Ablage `meta/cds/<sha1 aus dem Versions-JSON>/<originaler Dateiname>` (Name bleibt, weil Forge/NeoForge ihn in `-DignoreList` erwarten). Erstellung im Hintergrund (`.part` + rename); das Original bleibt unangetastet.
- `fingerprint.rs`: SHA1 über Java-Pfad, Java-Version, Größe+mtime von `java.exe`/`jvm.dll`, Profil-ID (Loader+Version), Main-Class, kompletten `-cp`/`-p`-Wert und Größe+mtime jedes Eintrags → Archiv `<spielordner>/.vibe/cds-<fp>.jsa`; andere `cds-*.jsa` werden beim Start gelöscht.
- `mod.rs`: `-XX:SharedArchiveFile=… -XX:+AutoCreateSharedArchive` direkt vor der Main-Class (auch mit Wrapper). Zweite Sitzung derselben Instanz: nur `SharedArchiveFile`, und nur wenn das Archiv existiert. **Rückfall:** Endet eine Sitzung mit CDS in < 30 s als Absturz, wird das Archiv gelöscht und für diesen Fingerabdruck `cds-off-<fp>` gesetzt → ab dann ohne CDS, bis sich Java/Loader/Mods ändern. Jede andere Abweichung (Grundarchiv fehlt, Kopie noch nicht fertig, Fehler) startet einfach ohne CDS und schreibt eine Log-Zeile „Java-Schnellstart (CDS): …“.
- Einstellungen: global „Schnellstart (Java-Klassenarchiv)“ (`settings.java_cds`, Standard an) unter Einstellungen → Java & RAM, je Instanz Auswahl „Wie global / An / Aus“ (`java.cds`) im Java-Tab der Instanz. Beides ist im Simple Mode ausgeblendet (Java-Runtime-Bereich).
- Speicherplatz-Tab: neue Kategorie „Schnellstart-Cache“ (`fast_cache`: `meta/cds/` + `instances/*/minecraft/.vibe/cds-*`), leerbar außer bei laufenden Instanzen; zählt nicht doppelt in die Summe.

### Nachher-Messung (ein kurzer Durchlauf)

Debug-Build dieses Branches (`--features tauri/custom-protocol`), eigener Temp-Datenordner (ohne Leerzeichen), Offline-Testprofil, Mojang `java-runtime-delta` 21.0.7, 4096 MB, Skripte wie oben (`launcher.mjs`, `wrap.py`, `jvmbench.py`). Kein anderes Minecraft lief; die Fremdlast durch andere Agenten-Builds war wieder hoch. **n ist klein (1–3 pro Variante)**, die Zahlen sind eine Stichprobe, keine Messreihe. „Vorher“ bei der Vorbereitung sind die Werte aus der Messung oben (gleicher PC, gleiche Methode, alter Code-Stand `195a33f`); der alte Stand wurde nicht neu gebaut.

**Vorbereitung im Launcher (Klick → Wrapper-Start, warm, ms)**

| | Vanilla 1.21.11 vorher | Vanilla nachher | NeoForge 1.21.1 vorher | NeoForge nachher |
|---|---:|---:|---:|---:|
| Spieldateien prüfen (`missing_files` ×2 → `check_files` ×1) | 280 (157+123) | **48–58** | 266 (147+119) | **48–51** |
| Java ermitteln (warm / 1. Start nach Launcher-Neustart) | 0,5 / ~190 | 2–3 / **2–3** (Datei-Cache) | 0,5 / ~190 | 2–3 / **2–3** |
| Ende der Launch-Aufgabe (`task_done`, inkl. UI-Aufruf) | ≈ 340 | **99–107** | ≈ 325 | **128–136** |
| Klick → Wrapper-Start gesamt¹ | 407 | **147–153** | 416 | **170–179** |

¹ inklusive ~60–80 ms Python-Start des Mess-Wrappers. Der Launcher selbst braucht also warm ~70–110 ms; reine Vorbereitung (`install_instance_opts`, Stufe „Spieldateien“ bis „Account“) ≈ 55 ms. Release wird schneller sein (JSON-Parsing des Asset-Index ist im Debug-Build ein Großteil der restlichen ~50 ms). Kein Statuswechsel mehr im Schnellpfad.

**JVM bis Hauptmenü (s ab Prozessstart; in Klammern `Setting user`)**

| Variante | Vanilla 1.21.11 | NeoForge 1.21.1 (ohne Mods) |
|---|---|---|
| ohne CDS, allererster Start (kalt) | 31,3 (25,6) | 33,5 (25,8) |
| ohne CDS, warm | 12,7 (8,7) | 25,3 (18,2) |
| mit CDS, Erstell-Lauf (einmalig) | 57,4 (46,9), Beenden 8,9 s statt 5,2 s | 97,5 (85,7), Beenden 7,9 s statt 5,5 s |
| **mit CDS, warm** | **9,5 (6,2) / 8,1 (5,0)** | **12,5 (9,9) / 11,0 (8,3)** |
| Archiv / entsignierte JAR | 101 MB / 27 MB | 98 MB / 23 MB |

Einordnung:
- Vanilla warm −25 bis −36 % bis Hauptmenü, wie in der Vorab-Messung.
- NeoForge warm −50 bis −57 % in dieser Stichprobe; der einzige warme Lauf ohne CDS (25,3 s) lag höher als in Reihe 2 oben (19–23 s, dort mit 30 Mods). Realistisch eher −20 bis −40 %.
- Der Erstell-Lauf ist deutlich langsamer als oben gemessen (Vanilla +45 s statt +18 s, NeoForge +72 s statt +48 s), vermutlich wegen der hohen Fremdlast; er fällt einmal pro Fingerabdruck an (nach Java-, Loader- oder Mod-Änderung erneut).
- Im Erstell-Lauf schreibt die JVM beim Beenden viele `[warning][cds] Skipping …`-Zeilen ins Spiel-Log (normal, keine Fehler).
- Alle 10 Starts liefen bis zum Hauptmenü und ließen sich sauber schließen; das Archiv wurde in den warmen Läufen wiederverwendet (gleiche Größe, keine Neuerstellung).

### Offen / nicht getestet

- Weltbeitritt mit CDS (weiterhin nicht getestet), Forge (nur NeoForge gemessen), Java 25, Release-Build, Pfad mit Leerzeichen am echten System (nur Regel + Unit-Test).
- NeoForge **mit** Mods nicht gemessen (Instanz ohne Mods).
- Rückfall nach frühem Absturz nur per Unit-Test geprüft, nicht mit einer echt abstürzenden JVM.
- Grundarchiv wird erst beim Start einer Instanz angestoßen (kein Hintergrund-Durchlauf direkt nach dem Launcher-Start); der erste CDS-Start einer neuen Runtime ist deshalb frühestens der übernächste Start.
- `deps::check` läuft weiter zweimal pro Start (≈ 15 ms).
- Kein Test für „0 `instance://changed`-Events beim Warmstart“ (braucht ein AppState-Testgerüst); im Code ist der Schnellpfad ohne `modify`.
