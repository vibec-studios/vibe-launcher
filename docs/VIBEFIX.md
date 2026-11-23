# VibeFix – KI-Log-Analyse

VibeFix ist ein eigenes, kleines Analyse-Modell (VibeFix-Net, aktuell **v3**) für Minecraft-Absturz-Logs. Es läuft
komplett im Launcher (reine Rust-Inferenz in [`crates/vibefix-infer`](../crates/vibefix-infer/README.md), keine
Cloud, kein Python) und ergänzt die eingebaute Regel-Analyse (`platform/crash/analyze.rs`, [CRASH-RULES.md](CRASH-RULES.md)).
Trainiert und ausgewertet wird das Modell im separaten Repository `vibe-autofix` (Gold-v2-Auswertung, Fix-Policy).

## Wo es auftaucht

- **Crash-Banner** und **Diagnose-Dialog** (Instanz → Absturz → Details), **„Probleme beheben“** nach einem Absturz
  und die Diagnose im **Logs-Tab** nutzen dieselbe Analyse (`crash_analysis`, `autofix_plan`).
- Während der Analyse zeigt die UI „Analyse-Modell wird geladen …“ (mit Prozent beim Download), danach
  „Log wird analysiert …“ (Event `vibefix://status`).
- Jede Ursache trägt eine Quelle: **VibeFix**, **VibeFix + Regeln** (Modell bestätigt einen Regel-Treffer) oder
  **Regeln**. Fundstelle und Sprung zur Zeile funktionieren wie bisher, auch bei gekürzten großen Logs.
- **Unbekannter Fehler** (`status: unknown`): VibeFix sieht einen Absturz, aber keine sichere Ursache. Es gibt dann
  keine Fix-Schritte, nur **„Log teilen“** – mit Vorschau des geschwärzten Logs (`mclogs_preview`) und eigener Bestätigung
  vor dem Upload zu mclo.gs.
- Einstellung: *Einstellungen → Spiel → Absturz-Analyse → „KI-Log-Analyse (VibeFix)“* (`settings.vibefix`). Im Dev-Build
  standardmäßig **an**. Aus = nur Regel-Analyse, kein Download.

## Fix-Vorschläge

- Modellbefunde werden auf die bekannten Diagnose-IDs abgebildet (`platform/crash/vibefix_map.rs`, z. B.
  `java_too_new` → `java_version` mit Richtung „älter“, `driver_amd` → `graphics`, `disabled_dependency` →
  `missing_dependency` mit „aktivieren“). Ursachen ohne Gegenstück behalten ihre ID und haben eigene Texte
  (`src/i18n/vibefix.ts`). Aktionen entstehen aus Modell-Entitäten und dem lokalen `ModIndex` (Datei, Version,
  deaktivierte Jars, Mixin-Configs).
- Schritte entstehen ausschließlich in der bestehenden Rust-Planung (`content/autofix/`). Hat VibeFix an der Analyse
  mitgewirkt, sind **alle Schritte aus der Absturzanalyse abgewählt und brauchen eine Bestätigung**
  (`content/autofix/gate.rs`, Fix-Policy aus `eval/FIX-REPORT.md`: v2+ nie automatisch). Statische Prüfungen
  (Abhängigkeiten, Loader, bekannte Paare) bleiben unverändert.
- Die kalibrierte Konfidenz (`model_confidence`, 0–1) wird getrennt von der gerundeten Anzeige weitergegeben.

## Datenschutz

- Logs werden **nur lokal** ausgewertet; die Analyse sendet nichts und erzeugt keine Telemetrie.
- Netzwerk nur für das Modell: `GET` auf das Manifest, dessen Signatur und die Modelldateien bei GitHub – ohne
  Nutzerdaten (nur der übliche User-Agent `VibeLauncher/<version>`). Geprüft wird nur, wenn eine Analyse startet, und
  höchstens alle 6 Stunden (nach einem Fehlschlag frühestens nach 10 Minuten, Timeout 8 s).
- „Log teilen“ lädt nur nach ausdrücklicher Bestätigung hoch; Benutzername, Rechnername, E-Mail- und IP-Adressen sowie
  Zugangsdaten werden vorher entfernt (`feedback/redact.rs`).

## Modell-Update-Ablauf

1. Analyse startet → `vibefix::prepare` (nur wenn eingeschaltet). Fällig? Dann Manifest + `manifest.json.sig` von
   `https://github.com/vibec-studios/vibe-launcher/releases/download/vibefix-model/manifest.json` laden.
2. Signatur (ed25519, öffentlicher Schlüssel in `src-tauri/src/vibefix/mod.rs`) und Inhalt prüfen: Schema, sichere
   Asset-Namen, genau `config.json`, `tokenizer.json`, `weights.bin`, Größe, SHA-256, Formatversion in
   `vibefix_infer::SUPPORTED_VERSIONS`. Unbekannte Formate werden ignoriert (das lokale Modell bleibt).
3. Nur wenn die Version **neuer** ist als die lokale (kein Downgrade über alte, signierte Manifeste), Dateien in
   `<daten>/vibefix/.staging-<id>/` laden, Größe/SHA-256/Signatur erneut prüfen, dann per Umbenennen nach
   `<daten>/vibefix/<version>/` aktivieren, `current.json` atomar setzen und alte Versionen löschen.
4. Modell lazy laden (erst bei der ersten Analyse, nicht beim Start) und im Speicher halten. Lokale Dateien werden bei
   jedem Laden gegen das signierte Manifest geprüft; ein beschädigtes Paket wird verworfen und beim nächsten Mal neu geladen.
5. Offline oder Fehler: vorhandene lokale Version nutzen. Gibt es keine, springt die Regel-Analyse ein (dezenter Hinweis
   „Analyse-Modell gerade nicht verfügbar“). Inferenzfehler fallen ebenfalls auf die Regeln zurück.

Datenordner: `<daten>/vibefix/{current.json, state.json, <version>/{config.json, tokenizer.json, weights.bin,
manifest.json, manifest.json.sig}}`.

## Manifest

```json
{
  "schema": 1,
  "name": "vibefix",
  "version": "3",
  "format": 3,
  "published": "2026-11-23T07:57:25.480Z",
  "files": [
    { "name": "config.json", "asset": "vibefix-v3-config.json", "size": 18451, "sha256": "…" },
    { "name": "tokenizer.json", "asset": "vibefix-v3-tokenizer.json", "size": 83292, "sha256": "…" },
    { "name": "weights.bin", "asset": "vibefix-v3-weights.bin", "size": 1475018, "sha256": "…" }
  ]
}
```

`manifest.json.sig` enthält die ed25519-Signatur der exakten Manifest-Bytes (Base64). `version` wird numerisch
verglichen (`3` < `3.1` < `4`), ein Rollback braucht deshalb eine höhere Versionsnummer.

## Neue Modellversion veröffentlichen

Der private Signaturschlüssel liegt **nur** unter `%USERPROFILE%\.vibefix\model-signing.key` (nie ins Repository,
nie ausgeben). Das Skript gibt nur den öffentlichen Schlüssel aus.

```powershell
# einmalig (schon erledigt; nicht erneut ausführen, sonst passt der Schlüssel im Launcher nicht mehr)
node scripts/vibefix-model/release.mjs keygen

# Assets aus einem Export-Ordner des VibeFix-Repos erzeugen und prüfen
node scripts/vibefix-model/release.mjs pack --export C:\pfad\zu\vibe-autofix\export\v3 --out $env:USERPROFILE\.vibefix\release-v3
node scripts/vibefix-model/release.mjs verify --out $env:USERPROFILE\.vibefix\release-v3 --pubkey enmE9uuX+YteYQDsRuapFB2jvjb5pfYR45nJaZAp3vw=

# erstes Mal: Vorab-Release mit festem Tag anlegen (nie latest)
$out = "$env:USERPROFILE\.vibefix\release-v3"
gh release create vibefix-model --repo vibec-studios/vibe-launcher --prerelease --latest=false `
  --title "VibeFix-Modell" --notes "Analyse-Modell für den Launcher (wird bei Bedarf geladen, signiert). Kein Launcher-Release." `
  "$out\vibefix-v3-config.json" "$out\vibefix-v3-tokenizer.json" "$out\vibefix-v3-weights.bin" "$out\manifest.json" "$out\manifest.json.sig"

# spätere Versionen: neue Assets hochladen, Manifest + Signatur zuletzt ersetzen
gh release upload vibefix-model --repo vibec-studios/vibe-launcher --clobber `
  "$out\vibefix-v4-config.json" "$out\vibefix-v4-tokenizer.json" "$out\vibefix-v4-weights.bin"
gh release upload vibefix-model --repo vibec-studios/vibe-launcher --clobber "$out\manifest.json" "$out\manifest.json.sig"
```

Die Asset-Namen sind versioniert, damit ein halb hochgeladenes Update nie alte und neue Dateien mischt. Alte Assets
können nach einer Übergangszeit gelöscht werden. Der Tag `vibefix-model` stört weder den Launcher-Updater
(`releases/latest`, Tag `dev`) noch den Agent-Updater (`agent-v*`).

Ein neues Paketformat braucht vorher eine Launcher-Version, deren `vibefix-infer` es kennt (`SUPPORTED_VERSIONS`).

## Entwicklung und Tests

- `cargo test -j 2 -p vibe-launcher --lib -- vibefix crash autofix` prüft Manifest/Signatur (auch Manipulation),
  Hash-Fehler, Download über einen lokalen Testserver, Offline-Rückfall, Abbildung der Befunde und die Bestätigungspflicht.
- Mit `VIBEFIX_MODEL_DIR=<export/v3>` laufen zusätzlich die Paket- und Paritätstests der Crate und ein Ende-zu-Ende-Test
  auf den Crash-Fixtures.
- Mock (`VITE_MOCK=1`): `localStorage["vl.mock.crash"] = "survival"` für einen Absturz, dann
  `localStorage["vl.mock.vibefix"]` = `diagnosed` (Standard) | `unknown` | `unavailable` | `error` | `disabled`;
  `vl.mock.vibefix.download = "1"` zeigt den Modell-Download bei jeder Analyse.
