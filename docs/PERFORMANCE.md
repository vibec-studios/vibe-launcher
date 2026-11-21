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
