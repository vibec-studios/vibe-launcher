# vibefix-infer

Reine Rust-Inferenz für VibeFix-Net, Paketformate 1 (`export/`), 2 (`export/v2/`, Hybrid aus Regeln, Heuristik
und Netz) und 3 (`export/v3/`, mit separatem Absturz-Kopf). Keine Torch-, ONNX- oder BLAS-Bindings.
Die Bibliothek implementiert FP16 → FP32, Pre-LN-Transformer, GELU-Tanh,
Softmax und GEMM mit AVX2/FMA-Laufzeiterkennung und portablem Pfad. Abhängigkeiten wie im Launcher sind `serde`,
`serde_json`, `regex`, `sha2`, `thiserror`, `flate2`, `toml`; zusätzlich `unicode-normalization` (NFC wie Python)
und `fancy-regex` (nur für die wenigen Python-Muster mit Lookaround in v2).

## API

```rust
use vibefix_infer::{AnyModel, LogFile};

let model = AnyModel::load("export/v2")?;
let files = vec![LogFile { kind: "latest_log".into(), name: "latest.log".into(), text }];
let analysis = model.analyze(&files);
println!("{}", serde_json::to_string(&analysis)?);
```

- `set_profile(Some("melden"))` wählt ein benanntes Profil aus `profiles`. Ohne Profil oder mit
  `set_profile(None)` gilt `calibration`, wie bei `Inference2`. Unbekannte Profilnamen sind Fehler.
- `AnyModel::load(dir)` / `from_bytes(config, tokenizer, weights)` lesen die Version aus `config.json` und laden
  `Model` (v1), `v2::Model2` oder `v3::Model3`. Geprüft werden SHA-256 von Gewichten und Tokenizer, alle Tensorformen gegen
  `config.json`; unbenutzte Tensoren (neuer Baustein) und unbekannte v2-Kalibrierungsschalter sind Fehler. Eine
  unbekannte Version ergibt `Error::Version`.
- `analyze(&[LogFile]) -> Analysis` begrenzt die Eingaben in v1/v2 wie `vibefix.ingest.readlog`, in v3 wie die
  Python-Referenz in der v2-Aufbereitung und separat in der Merkmalsextraktion. Es liefert das
  Diagnoseformat aus `vibefix/fix/FORMAT.md`, identisch zu `vibefix.run.model_adapter.convert`:
  `{"status", "ood", "ood_score", "crash_score"?, "healthy", "causes": [{"cause", "confidence", "actions",
  "entities": {typ: [werte]}, "evidence": {file, line}, "locations": [...]}], "entities": [...]}`.
  `analyze_with_meta` nimmt zusätzlich Fall-Metadaten (z. B. Mod-Liste der Instanz) wie `with_metadata`.
- `predict` liefert die Rohvorhersage wie `Inference.predict` bzw. `Inference2.predict`. Einzelschritte: v1
  `encode`/`run`/`decide`, v2 `prepare`/`run`/`decide`/`convert`. `read_log(path)` liest Dateien wie die Referenz
  (gz, UTF-16, Sampling großer Logs, Normalisierung), `identify(text, name)` bestimmt die Dateiart.
- Entitätstypen je Ursache für das Planerformat: `taxonomy/causes.yaml` (eingebettet als `data/cause_entities.json`),
  überschreibbar mit `set_taxonomy`.

## CLI

```powershell
cd src-tauri; cargo build -j 2 --release -p vibefix-infer
.\target\release\vibefix-infer.exe --model C:\pfad\zu\vibefix-v3 latest.log crash-2026-11-22.txt
.\target\release\vibefix-infer.exe --model C:\pfad\zu\vibefix-v3 --raw --pretty --time latest.log.gz
```

Ohne `--model` gilt `VIBEFIX_MODEL`, dann ein vollständiges v3-Paket mit eigener README-Zeile
`Status: empfohlen` oder `Recommended`, danach `./export/v2` und `./export`. Ein explizites v2-Profil
wählt bei automatischer Paketsuche v2. `--raw` gibt die Rohvorhersage aus. Die Ausgabe enthält
`model_version` und die erkannten Dateiarten.

## Exaktheit

Nachgebaut sind `vibefix.prep` (Normalisierung, Segmentierung, Metadaten, Mod-Listen, Ausnahmeketten),
`vibefix.model.{lines,tokenizer,batch,inference}` und für v2 `vibefix.labels.{rules,rule_context,rule_handlers,
heuristics,prepared}` sowie `vibefix.model.v2.{capping,lines,prep,candidates,batch,numpy_net,decide}`.

- Python-`re`-Semantik: Tokenizer-Vortrennung, Log-Präfix, Stacktrace-/Ausnahmeerkennung und die v2-Kandidatenmuster
  mit Lookbehind/Lookahead (Klasse, Datei, Version, Bezeichner) sind von Hand geschrieben, inklusive der
  Backtracking-Fälle. `\w`, `\d`, `\s`, `str.strip` und `str.casefold` nutzen Tabellen aus Python 3.13 (Unicode 15.1,
  `data/unicode.txt`). Übrige Muster laufen über `regex`, Lookaround-Muster über
  `fancy-regex` mit Python-Klassensyntax-Übersetzung.
- `re.I` faltet `İ`/`ı` auf `i`, Rusts `(?i)` nicht; diese Zeichen werden vor der Suche ersetzt. NumPy 2 vergleicht
  float32 gegen Python-Zahlen in float32 (Ursachenschwelle v1, Entitätsschwelle v2); das ist nachgebildet.
- Regeltabellen (`patterns.toml`, `conflicts.toml`) und die Heuristik-Muster stammen aus `vibefix/labels` im
  VibeFix-Repository (`tools/sync_host.py`) und werden dort gepflegt.

## Tests im Launcher

Übernommen sind nur die Paritätsdaten aus Launcher-Fixtures (`src-tauri/src/platform/crash/testdata`) und
synthetischen Sonderfällen unter `tests/parity/`. Korpus-Paritätstests mit echten Logs bleiben im
VibeFix-Repository.

```powershell
cargo test -j 2 -p vibefix-infer
$env:VIBEFIX_MODEL_DIR = "C:\pfad\zu\vibefix-v3"; cargo test -j 2 -p vibefix-infer
```

Ohne `VIBEFIX_MODEL_DIR` laufen Host- und Aufbereitungsparität (ohne Modellpaket); Paket-, CLI- und v3-Paritätstests
werden übersprungen.

## Geschwindigkeit

Benchmark im VibeFix-Repository (`cargo run -j 2 --release --example bench [paket]`) über alle 706 lokalen und 24 Fixture-Fälle, ein Thread, inklusive
Begrenzung, Aufbereitung, Tokenisierung, Netz und Planerformat; Median aus fünf Läufen je Fall (`BENCH_REPEATS=5`),
weil während der Messung ein fremder Java-Prozess ~10 Kerne belegte. i5-12600K, Windows 11.

| Paket, Pfad | Median | P95 | Max |
|---|---:|---:|---:|
| v1, AVX2 + FMA | 24,4 ms | 48,2 ms | 84,8 ms |
| v1, portabel (`VIBEFIX_NO_SIMD=1`) | 36,7 ms | 94,2 ms | 224,5 ms |
| v2 `export/v2` (Breite 64), AVX2 + FMA | 30,8 ms | 69,2 ms | 93,8 ms |
| v2 `export/v2` (Breite 64), portabel | 54,5 ms | 118,4 ms | 154,5 ms |
| v1 NumPy-Referenz (Agent C, 32 Fälle, OpenBLAS 1 Thread) | 57,9 ms | 181,9 ms | 321,3 ms |

v1-Zeilenauswahl + Tokenisierung: Median 1,5 ms, Max 6,0 ms. v2-Aufbereitung (Metadaten, Regeln, Heuristik,
Auswahl, Kandidaten): Median 5,3 ms, P95 18,0 ms, Max 44,0 ms. Laden: 3–5 ms, erster Aufruf zusätzlich ~50 ms für
das Übersetzen der Regex-Tabellen.

## Aufbau

| Pfad | Inhalt |
|---|---|
| `package.rs`, `weights.rs`, `any.rs` | config.json, FP16-Gewichte, Prüfsummen, Versionsweiche |
| `tokenizer.rs`, `parts.rs` | Byte-BPE, Vortrennung |
| `normalize.rs`, `prefix.rs`, `category.rs`, `segment.rs`, `select.rs`, `features.rs` | Aufbereitung v1 |
| `trunk.rs`, `block.rs`, `math.rs`, `gemm.rs`, `net.rs` | Netz (gemeinsamer Zeilen-/Dokument-Encoder) |
| `diagnosis.rs`, `analysis.rs` | v1-Köpfe, OOD, Entitäten, Planerformat |
| `readlog.rs`, `sample.rs` | Dateien lesen, Begrenzung großer Logs |
| `host/` | Metadaten, Mod-Listen, Regel-Engine, Heuristik, Python-Regex-Adapter |
| `v2/` | Begrenzung, Aufbereitung, Kandidaten, Kodierung, Netz, Entscheidung, `Model2` |
| `v3/` | Absturzmerkmale und separater Absturz-Kopf auf dem unveränderten v2-Netz |

Neue Paketversion: Version in `SUPPORTED_VERSIONS` aufnehmen, neue Tensoren laden (unbekannte schlagen fehl),
neue Kalibrierungsschalter in `v2/package.rs` und `v2/decide.rs` nachziehen, Referenzen erzeugen, `cargo test`.
