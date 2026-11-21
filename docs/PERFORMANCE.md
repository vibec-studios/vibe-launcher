# Launcher-Performance unter Windows

Vergleich mit `2c11ccd` auf Windows 11 (26200), Intel Core i5-12600K mit 16 logischen CPUs und WebView2 157.0.4341.60. Die Startseite wurde im Expertenmodus mit abgeschlossenem Onboarding, leerem Instanzbestand, Standarddarstellung sowie deaktivierten Vibe-Diensten und Update-Checks gemessen. Beide Vite-Produktionsbuilds liefen im selben vorhandenen Tauri-Debug-Binary über `VIBE_DEV_DIST`. Damit erfasst der Vergleich den realen Rust-/WebView2-Prozessbaum bei identischem Backend. Die Zeiten gelten für den Debug-Live-Pfad.

## Start und Leerlauf

| Messgröße | Vorher | Nachher |
| --- | ---: | ---: |
| Prozessstart bis First Contentful Paint, Median aus 5 Starts | 786 ms | 746 ms |
| Prozessstart bis Startseiten-Überschrift und Bibliotheksknopf verfügbar, Median aus 5 Starts | 906 ms | 785 ms |
| Working Set nach 1 min | 465,1 MiB | 430,1 MiB |
| Working Set nach 10 min | 465,1 MiB | 433,9 MiB |
| Privater zugesicherter Speicher nach 1 min | 230,9 MiB | 213,9 MiB |
| Privater zugesicherter Speicher nach 10 min | 228,8 MiB | 213,7 MiB |
| CPU nach 1 min | 0,085 % | 0,026 % |
| CPU nach 10 min | 0,052 % | 0,019 % |

Jeder Start nutzte einen eigenen temporären `VIBE_LAUNCHER_HOME` und `WEBVIEW2_USER_DATA_FOLDER` sowie einen lokalen CDP-Port zwischen 9371 und 9377. Bei der Startmessung wechselten die Varianten in fünf Paaren mit frischen Profilen. Windows-Dateicaches wurden dabei wiederverwendet. CDP las den First Contentful Paint aus der Paint Timing API und prüfte die Oberfläche ungefähr alle 15 ms auf die Überschrift und den Bibliotheksknopf. Der zweite Wert ist damit eine Näherung für die Interaktivität. RAM ist die Summe der Werte von `Get-Process` für den Launcher und alle WebView2-Nachkommen. Gemeinsam genutzte Seiten können in der Working-Set-Summe mehrfach vorkommen. CPU ist die Änderung der aufsummierten Prozess-CPU-Zeit in den 15 Sekunden vor dem Stichtag, normiert auf die gesamte CPU-Kapazität. Die Leerlaufmessung hatte einen Durchlauf pro Variante auf einem parallel genutzten Rechner. In beiden Varianten prüft der Debug-Live-Pfad zusätzlich alle 400 ms auf neue Frontend-Dateien.

## Seitenwechsel und große Listen

Die Vite-Builds liefen im selben isolierten WebView2 mit `VITE_MOCK=1` und `vl.mock.many=1`. Der Mock liefert 25 Instanzen und für „Cobblemon Abenteuer“ 312 Mods. Für den Test im nativen Fenster nutzten beide Mock-Builds umbenannte Mock-Globals. So blieb der schreibgeschützte Tauri-IPC-Namensraum unberührt. CDP maß ab Navigation bis zum erwarteten Seiteninhalt und zwei weiteren Animation Frames. Die kalten Werte enthalten beim Instanzdetail auch die simulierte IPC-Latenz.

| Wechsel | Erster Aufruf vorher | Erster Aufruf nachher | Wiederholung vorher | Wiederholung nachher |
| --- | ---: | ---: | ---: | ---: |
| Startseite → Bibliothek mit 25 Instanzen | 78 ms | 122 ms | 57 ms | 53 ms |
| Bibliothek → Instanz mit 312 Mods | 364 ms | 380 ms | 71 ms | 73 ms |
| Instanz → Startseite | 92 ms | 80 ms | 81 ms | 81 ms |

Median aus drei frischen Profilen pro Variante und je fünf Wiederholungen im selben Profil. Gemessen wurden 678 DOM-Elemente im Hauptbereich der Bibliothek und 631 im Hauptbereich der Modansicht, in beiden Varianten. Beim ersten Bibliotheksaufruf per Direktklick wurden zusätzlich 44 ms beobachtet. Dabei lädt der Launcher den Bibliothekscode erstmals.

## Vite-Bundle

| Messgröße | Vorher | Nachher | Änderung |
| --- | ---: | ---: | ---: |
| JS-Einstiegschunk, minifiziert | 2.179,4 kB | 941,7 kB | −56,8 % |
| Bis zur Startseite geladene JS-Chunks, minifiziert | 2.923,1 kB | 1.585,6 kB | −45,8 % |
| Dieselben Start-Chunks, gzip pro Datei summiert | 785,9 kB | 450,4 kB | −42,7 % |
| Alle JS-Chunks, minifiziert | 3.932,4 kB | 3.957,6 kB | +0,6 % |
| Gesamtes `dist` inklusive Bilder und Fonts | 5.436,7 kB | 5.485,8 kB | +0,9 % |

Die Chunk-Größen stammen aus dem Vite-Output und die Start-Chunks aus CDP Resource Timing. Bei Bedarf lädt der Router die übrigen Seiten und der Launcher den Einstellungsdialog. Die Startseite importiert nur die Abfrage für die Wochen-Spielzeit. Die Statistik rendert ihre Balken mit React. Markdown und HTML-Bereinigung liegen im Projekt-Chunk. Der Skin-Viewer und der Code-Editor waren bereits getrennt gebündelt.

## Beibehaltene Änderungen

- Die Robbe verwendet in Ruhe zwei verlustfrei aus dem vorhandenen 3D-Modell gerenderte WebP-Frames für Blick und Blinzeln. Die kompakte Standardvariante belegt 1,9 kB. Die Hover-Animation verwendet weiterhin das 3D-Modell und gibt ihren WebGL-Kontext nach dem Auslaufen frei. Three.js wird für die Robbe erst bei Hover geladen. Im Smoke-Test stand das Canvas beim ersten Hover nach rund 200 ms zur Verfügung.
- Der statische Hintergrund registriert keine Fensterabfrage. In einem zusätzlichen instrumentierten Lauf sank die Zahl der zweisekündlichen Prüfungen von fünf auf null in elf Sekunden. Bewegte Hintergründe behalten die Pausierlogik für minimierte oder versteckte Fenster.
- Die Modliste war bereits virtualisiert. Die Bibliothek nutzt für Instanz-Icons bereits natives Lazy Loading und asynchrone Dekodierung. Bei 25 Instanzen entstand kein Bedarf für eine weitere Virtualisierung. Die Zustand-Abonnements wurden geprüft, insbesondere die Aufgabenabonnements der Seitenleiste. Die Messung erfasste keine Last durch laufende Aufgaben.
- Geprüft wurden die Rust-Initialisierung, der auf 600 Einträge begrenzte API-Cache, Hintergrundtasks und Discord-Polling. Die Backend-Arbeit lag in diesem Leerlaufszenario unterhalb eines belastbar isolierbaren Optimierungsgewinns. Der Vergleich verwendet die regulären WebView2-Optionen plus CDP. Das Cargo-Releaseprofil verwendet bereits LTO, eine Codegen-Unit, Optimierungsstufe 3 und Strip.

## Verifikation

- `pnpm exec tsc --noEmit` und `pnpm build` waren erfolgreich. `pnpm exec tauri build --debug --no-bundle` baute die Baseline mit zwei Cargo-Jobs. Das frische Binary startete mit eingebetteter Baseline und danach mit dem finalen Vite-Build über `VIBE_DEV_DIST`. Wegen der 18 Minuten für den ersten Debug-Neubau blieb ein separates optimiertes Profil offen.
- `cargo test -j 2 --locked --lib --features tauri/custom-protocol settings::tests` prüfte 20 Tests für Einstellungen und Einstellungsimport. Alle 20 waren erfolgreich.
- Die isolierten CDP-Smoke-Tests prüften Blinzeln, 3D-Hover mit anschließendem Freigeben des Canvas, reduzierte Systembewegung, den Einstellungsdialog über Knopf und Deep Link sowie Navigation zu Konten, Serverdetails und einer Projektseite mit gerendertem Markdown.

## Runde 2

Die Baseline ist `467801a` auf `integ/big-update`. Beide Vite-Produktionsbuilds liefen über `VIBE_DEV_DIST` im selben vorhandenen Tauri-Debug-Binary aus Runde 1. Windows 11 (Build 26200), Core i5-12600K und WebView2 157.0.4341.60 entsprechen dem ersten Vergleich. Der Starttest verwendet Deutsch, Expertenmodus, abgeschlossene Einrichtung, leere Bibliothek, Standarddarstellung und deaktivierte Vibe-Dienste und Update-Checks. Jeder Durchlauf startet mit eigenem `VIBE_LAUNCHER_HOME`, `WEBVIEW2_USER_DATA_FOLDER` und lokalem CDP-Port. Andere Agenten arbeiteten während der Messungen auf demselben Rechner.

### Start und Bundle

Die Startzeiten stammen aus sieben Paaren mit wechselnder Reihenfolge. CDP prüfte wie in Runde 1 ungefähr alle 15 ms. Werte in Klammern zeigen Minimum und Maximum. Die letzte Spalte enthält den Median der paarweisen Differenzen. Windows-Dateicaches wurden wiederverwendet.

| Messgröße | Vorher | Nachher | Paarweise Änderung |
| --- | ---: | ---: | ---: |
| First Contentful Paint | 830 ms (812–1.142) | 790 ms (755–920) | −39 ms |
| Startseitenüberschrift und Bibliotheksknopf verfügbar | 868 ms (852–1.213) | 825 ms (786–968) | −37 ms |

| Vite-Bundle | Vorher | Nachher | Änderung |
| --- | ---: | ---: | ---: |
| JS-Einstiegschunk, minifiziert | 1.028,6 kB | 546,8 kB | −46,8 % |
| Bis zur Startseite geladene JS-Chunks, minifiziert | 1.686,6 kB | 1.329,0 kB | −21,2 % |
| Dieselben Start-Chunks, gzip pro Datei summiert | 481,2 kB | 390,2 kB | −18,9 % |
| Anzahl JS-Chunks beim Start | 7 | 18 | +11 |
| Alle JS-Chunks, minifiziert | 4.066,4 kB | 4.097,9 kB | +0,8 % |
| Gesamtes `dist` inklusive Bilder und Fonts | 5.617,8 kB | 5.650,1 kB | +0,6 % |

Die Start-Chunks stammen aus CDP Resource Timing und wurden gegen die Skripte und Module-Preloads in `index.html` geprüft. Die Build-Analyse mit Sourcemaps zeigte rund 424 kB für die zweisprachigen Wörterbücher. React DOM belegte im ursprünglichen Einstieg rund 204 kB. Drei.js, der Code-Editor und Markdown lagen bereits außerhalb des Startpfads. Der Einstieg bündelte weiterhin die geschlossenen Dialoge, Teile der sozialen Oberfläche, die Hilfe samt Anleitungen und den virtualisierten Instanzinhalt.

Die Shell lädt jetzt Instanz-, Server-, Mod-Set- und Vibe-Dialoge sowie Autofix, Feedback, Hilfe, Touren und das Freunde-Panel bei der ersten Nutzung. Die Einrichtung wird bei Bedarf geladen. Drag-and-drop sowie der Empfänger für Desktop-Verknüpfungen und Deep Links sind sofort aktiv. Import- und Installationsdialoge werden beim Öffnen geladen. Der globale Datei-Drop nutzt dieselbe Aktion wie der Inhalte-Tab, ohne die Modliste und ihren Virtualisierer zu importieren. Die Bibliothek wird auf der sichtbaren Startseite bei abgeschlossener Einrichtung einmalig nach 400 ms und freier Browserzeit vorgeladen.

### Seitenwechsel

Wie in Runde 1 liefen die Mock-Builds mit umbenanntem IPC-Namensraum im nativen WebView2. `VITE_MOCK=1` und `vl.mock.many=1` ergeben 25 Instanzen und 312 Mods. CDP maß vom Auslösen der Navigation bis zum erwarteten Inhalt und zwei weiteren Animation Frames. Pro Szenario gab es fünf frische Profilpaare mit wechselnder Reihenfolge und je fünf Wiederholungen im Profil. Die Wiederholungswerte fassen die Mediane je Profil zusammen. Werte in Klammern zeigen Minimum und Maximum.

| Wechsel | Szenario | Vorher | Nachher | Paarweise Änderung |
| --- | --- | ---: | ---: | ---: |
| Startseite → Bibliothek | Sofortklick | 99 ms (90–117) | 105 ms (91–154) | +7 ms |
| Startseite → Bibliothek | Nach 1,2 s Leerlauf | 97 ms (85–111) | 68 ms (58–79) | −29 ms |
| Bibliothek → Instanz | Direkt nach Sofortklick | 363 ms (334–379) | 380 ms (349–1.111) | +17 ms |
| Bibliothek → Instanz | Nach der vorgeladenen Bibliothek | 364 ms (338–382) | 366 ms (351–379) | +3 ms |
| Instanz → Startseite | Erster Wechsel, Serie mit 1,2 s Leerlauf | 73 ms (71–75) | 67 ms (61–81) | −5 ms |
| Startseite → Bibliothek | Wiederholung, Serie mit 1,2 s Leerlauf | 43 ms (39–50) | 42 ms (39–48) | −1 ms |
| Bibliothek → Instanz | Wiederholung, Serie mit 1,2 s Leerlauf | 58 ms (57–70) | 58 ms (57–71) | 0 ms |
| Instanz → Startseite | Wiederholung, Serie mit 1,2 s Leerlauf | 64 ms (59–73) | 65 ms (61–72) | +1 ms |

Der Bibliothekschunk war nach der Pause in fünf von fünf Läufen bereits geladen, in der Baseline in keinem. Die Bibliothek wurde in jedem dieser Paare 24–36 ms schneller sichtbar. Beim Sofortklick war der Chunk in beiden Varianten noch kalt. Der erste Instanzwechsel nach dem Sofortklick fiel nach dem Umbau etwas langsamer aus und streute stärker. Die Ansicht hatte in beiden Builds 683 DOM-Elemente in der Bibliothek und 633 in der Modliste.

### Leerlauf

Zwei Profilpaare starteten in wechselnder Reihenfolge. Die Läufe überlappten, die 15-Sekunden-Fenster für die CPU-Messung lagen zeitlich versetzt. Ein Messprozess in Paar zwei wurde nach einem Startfehler ersetzt. Dessen Zehn-Minuten-Probe fiel nach Ende der anderen Messläufe. Die Start- und Navigationszeiten oben stammen aus separaten Durchläufen mit je einem Launcher.

Wie in Runde 1 summiert RAM das Working Set bzw. den privaten zugesicherten Speicher des Launchers und seiner WebView2-Nachkommen. Gemeinsam genutzte Seiten können mehrfach im Working Set erscheinen. Die CPU-Zeit ist auf die gesamte Kapazität des Rechners normiert. Der Debug-Live-Pfad prüft weiterhin alle 400 ms auf neue Frontend-Dateien. Werte in Klammern zeigen Minimum und Maximum.

| Messgröße | Vorher | Nachher | Paarweise Änderung |
| --- | ---: | ---: | ---: |
| Working Set nach 1 min | 432,35 MiB (432,27–432,43) | 428,44 MiB (428,39–428,49) | −3,91 MiB |
| Working Set nach 10 min | 435,41 MiB (434,34–436,48) | 431,65 MiB (431,54–431,77) | −3,76 MiB |
| Privater zugesicherter Speicher nach 1 min | 204,85 MiB (204,72–204,97) | 207,48 MiB (205,07–209,90) | +2,64 MiB |
| Privater zugesicherter Speicher nach 10 min | 223,95 MiB (223,77–224,12) | 213,61 MiB (213,44–213,79) | −10,33 MiB |
| CPU nach 1 min | 0,085 % (0,079–0,092) | 0,042 % (0,026–0,059) | −0,043 Prozentpunkte |
| CPU nach 10 min | 0,006 % (0,000–0,013) | 0,003 % (0,000–0,007) | −0,003 Prozentpunkte |

Das Working Set sank in beiden Paaren an beiden Stichtagen. Der private Speicher stieg zunächst leicht und lag nach zehn Minuten in beiden Paaren rund 10 MiB niedriger. Die CPU-Differenz nach zehn Minuten wechselte zwischen den Paaren das Vorzeichen.

### Verifikation

- `pnpm exec tsc --noEmit` und `pnpm build` waren erfolgreich. `cargo test -j 2 --lib` im Rust-Projekt ergab im letzten Lauf 464 bestandene und zwei ignorierte Tests. `platform::syncdir::tests::spreads_between_instances_and_handles_deletes` war im vorigen Lauf fehlgeschlagen und bestand die Wiederholung.
- Isolierte CDP-Smoke-Tests prüften Hilfe, Feedback, Import, neue Instanz und neuen Server, jeweils mit Öffnen und Schließen. Beim Erststart erschien die Sprachauswahl. Ein Startargument für eine fiktive Instanz öffnete die Rückfrage. Der Smoke-Test sandte kein Feedback und startete kein Spiel.
- Im Mock mit einfacher Bedienung und Design v2 wurden zusätzlich die Einführungstour, das Freunde-Panel, Autofix, der Dialog für ein neues Mod-Set und der Modpack-Installationsdialog geöffnet.
- Ein Release-Vergleich und Messungen mit animierten Hintergründen, echter großer Bibliothek oder aktiven Vibe-Diensten bleiben offen. Die Wörterbücher belegen weiterhin rund 424 kB im Startpfad. Beim Instanzdetail lohnt eine gesonderte Prüfung der Abhängigkeiten der inaktiven Tabs.
