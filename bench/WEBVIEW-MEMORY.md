# Speicher des Launcher-Prozessbaums (WebView2) – Messung

Stand: 21.11.2026, Code-Stand `42690e8` (`integ/refactor`). Nur gemessen, **kein Produktcode geändert** – keine der geprüften Maßnahmen war messbar und verlässlich wirksam.

## Methode

- Debug-Build mit eingebettetem Produktions-Frontend (`pnpm build`, `cargo build -j 2 --features tauri/custom-protocol`), eigener Datenordner (`VIBE_LAUNCHER_HOME`, `onboarding_done: true`), Offline-Testkonto, leere Bibliothek, echtes Netz (Modrinth).
- Skript: `bench/webview-memory.mjs` (`MEM_EXE`, `MEM_HOME`, `MEM_PORT`, `MEM_LABEL`, `MEM_LONG` = Sekunden bis zur Leerlauf-Messung, `MEM_BROWSER_ARGS` = zusätzliche WebView2-Argumente, `MEM_PERPAGE=1` = GPU/Renderer nach jeder Seite).
- Messpunkte: Startseite nach 30 s → zwei Runden durch alle Hauptseiten (Bibliothek, Entdecken, Mod-Sets, Konten, Skins, Statistik, Galerie, Server, Freunde, Einstellungen → Darstellung, Start) → nach 5 min → nach erzwungener GC.
- „privat“ = Private Bytes (`PrivatePageCount`), „WS“ = Working Set, je Prozess aus `Win32_Process`, Baum ab `vibe-launcher.exe`.
- Last: mehrere Agenten bauen parallel; die drei 5-min-Läufe liefen gleichzeitig. Die Streuung zwischen Läufen mit gleichem Stand liegt beim GPU-Prozess bei **±25 MiB**.

## Ausgangswerte (Baseline, MiB)

| Prozess | privat 30 s | privat nach Seitenwechseln | privat 5 min | WS 30 s | WS 5 min |
|---|---:|---:|---:|---:|---:|
| vibe-launcher (Debug) | 13,5 | 14,8 | 14,7 | 100 | 102 |
| WebView2 Browser | 40 | 42 | 40 | 124 | 128 |
| WebView2 GPU | 85–105 | 206–247 | 218 | 94 | 113 |
| WebView2 Renderer | 51 | 94–104 | 76 | 98 | 132 |
| Utility: NetworkService | 12,6 | 13,2 | 12,5 | 44 | 45 |
| Utility: StorageService | 7,3 | 7,3 | 7,2 | 22 | 22 |
| Crashpad | 3,5 | 3,5 | 3,2 | 21 | 16 |
| **Summe (7 Prozesse)** | **213–235** | **382–432** | **372** | **458–505** | **518** |

JS-Heap (CDP `Performance.getMetrics`): 6 MB nach dem Start, 12–13 MB nach den Seitenwechseln, 9,7 MB nach GC. DOM: 383–469 Knoten.

### Wo wächst es?

GPU-Prozess je Seite (erste Runde, MiB privat): Start 85 → Bibliothek 116 → **Entdecken 182 (+65)** → … → **Einstellungen/Darstellung 220 (+34)**. Alle anderen Seiten ±5.

- **Kein JS-Problem:** Der Heap bleibt unter 15 MB. Schwere Module (three.js im Maskottchen nur beim Hover, Skin-Viewer, CodeMirror) sind bereits per Lazy-Loading eingebunden, lange Listen virtualisiert.
- **Keine Bilder:** Entdecken zeigt 20 Bilder, dekodiert zusammen ≈ 4 MB; alle mit `loading="lazy"`, `decoding="async"` und verkleinerten Modrinth-Varianten (`_96.webp`, `_350`).
- **Keine Layer:** LayerTree zeigt 3 Compositing-Layer auf Entdecken (Dokument, Hinweis-Blase), 5 im Einstellungen-Dialog (Overlay, Dialog). Teure Effekte (Blur/Glas, Video, Canvas-Hintergrund) sind nur bei eigenem Hintergrund aktiv, im Standard aus.
- Der Zuwachs ist Chromiums interner Raster-/Skia-Ressourcen-Cache im GPU-Prozess. Er sinkt im Leerlauf nur wenig (5 min: −30 MiB) und lässt sich aus der Seite heraus nicht freigeben.

## Geprüfte WebView2-Argumente

Werte privat in MiB (GPU / Renderer / Summe), Läufe parallel, daher verrauscht.

| Argumente | GPU nach Seiten | GPU 5 min | Renderer 5 min | Summe 5 min | Bewertung |
|---|---:|---:|---:|---:|---|
| keine (Baseline) | 247 | 218 | 76 | 372 | – |
| `--force-gpu-mem-available-mb=96` | 244 | – | 73 (GC) | 396 (GC) | keine Wirkung (kommt nachweislich beim GPU-Prozess an) |
| `--force-gpu-mem-discardable-limit-mb=16` | 272 | 257 | 71 (GC) | 415 (GC) | keine Wirkung |
| `--disable-gpu-rasterization` | 196 | – | 77 (GC) | 352 (GC) | GPU −20…−50, Renderer +10, mehr CPU beim Scrollen; im Rauschen |
| `--js-flags=--optimize-for-size` | 197 | 169 | 70 | 316 | Renderer −6; GPU-Unterschied ist Rauschen (V8 berührt den GPU-Prozess nicht) |
| beide zusammen | 160 | 160 | 72 | 309 | wie oben |

Seitenwechsel (erstes Öffnen, ms bis DOM ruhig): Entdecken 350–450, Skins 340–510, Einstellungen 600–1100, Rest < 300 – in allen Varianten im selben Bereich.

## Bewertung und Vorschläge

Keine Maßnahme erfüllt „messbar wirksam ohne Nebenwirkung“ sicher genug für eine Änderung am Produkt:

1. **`--js-flags=--optimize-for-size`**: ≈ −6 MiB Renderer (−8 %), kostet aber JIT-Leistung. Nur mit einer ruhigen A/B-Reihe (≥ 5 Läufe nacheinander) und Seitenlade-Zeiten übernehmen. Umsetzung wäre `additionalBrowserArgs` im Fenster in `tauri.conf.json` – dabei Tauris Standard `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection` mit übernehmen, sonst gehen die verloren.
2. **`--disable-gpu-rasterization`**: einziger Hebel am GPU-Prozess, aber Software-Raster im Renderer; auf schwachen CPUs ruckeliger. Nicht empfohlen.
3. **Größter echter Hebel: `ICoreWebView2_19::MemoryUsageTargetLevel = Low`**, solange das Fenster verborgen/minimiert ist oder ein Spiel läuft (gibt GPU-/Renderer-Caches frei), plus `TrySuspend` im Tray. Gehört zum Bereich „Beim Spielen schlank“ (Fenster/Tray) und wurde deshalb hier nicht angefasst.
4. Nicht weiter verfolgen: Bild-Verkleinerung, Lazy-Loading, Virtualisierung, Query-`gcTime` – bereits umgesetzt bzw. ohne messbaren Anteil (JS-Heap < 15 MB).
