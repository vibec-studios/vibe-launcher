# Modpack aus Datei, Link oder Packwiz aktualisieren

Eigene Modpacks lassen sich ohne Modrinth/CurseForge-Katalog aktualisieren: Instanzmenü → **„Modpack aus Datei/Link aktualisieren …“**.

## Ablauf

1. **Quelle wählen** (`src/features/packupdate/PackSourceDialog.tsx`)
   - Datei auf dem PC: `.mrpack`, CurseForge-`.zip`, `.vlpack`, Prism-/MultiMC-Export oder eine lokale Packwiz-`pack.toml`
   - Link: direkter Download-Link zu einer dieser Dateien oder eine Packwiz-`pack.toml`-URL.
     GitHub-Links der Form `github.com/<owner>/<repo>/blob/<ref>/pack.toml` werden auf `raw.githubusercontent.com` umgeschrieben.
2. **Vorschau**: der vorhandene Dialog `ModpackUpdateDialog` (gleiche Diff-Logik wie beim Katalog-Update:
   aktualisiert/neu/entfernt, Overrides mit Konfliktschutz, Nutzer-Inhalte bleiben).
3. **Anwenden**: automatischer Snapshot, dann Austausch (gleicher Code wie Katalog-Updates, `modpack::apply_target`).

## Backend

| Command | Zweck |
|---|---|
| `modpack_from_preview(instanceId, input)` | Vorschau, `input = { kind: "file", path } \| { kind: "url", url }` |
| `modpack_from_update(instanceId, input)` | Update als Task (Snapshot vorher), gibt Task-ID zurück |
| `modpack_remote_check(instanceId)` | Packwiz: neue Version? (`RemoteUpdate` oder `null`) |

- `content/modpack_from.rs`: Eingabe auflösen, Ziel bauen, Instanz-Herkunft setzen.
- `content/packwiz/`: `pack.toml` → `index.toml` → Metadateien (`*.pw.toml`). Prüfsummen (sha1/sha256/sha512/md5)
  von Index und Dateien werden geprüft. Normale Dateien im Index werden zu Overrides (Konfliktschutz wie bei mrpack).
  Nur-Server-Dateien und optionale Dateien mit `default = false` werden übersprungen.
  CurseForge-Metadateien (`mode = "metadata:curseforge"`) werden über die CurseForge-API aufgelöst (braucht den API-Key).
  Fehlende SHA-1 von Modrinth-Dateien werden über `GET /versions` ergänzt, damit unveränderte Mods nicht neu geladen werden.
- `content/modpack.rs`: `preview_target` und `apply_target` sind die gemeinsamen Bausteine (Katalog und Datei/Link).

## Herkunft (`PackSourceKind`)

- Neu: `packwiz` – `project_id` = Adresse der `pack.toml`, `version_id` = Index-Hash, `version_name` = `version` aus der `pack.toml`.
- `pack.json` merkt sich zusätzlich `remote` (Adresse) und `remote_hash` (Index-Hash). `modpack_remote_check` lädt nur die
  `pack.toml` und vergleicht den Index-Hash. Die Instanzseite zeigt dann „Modpack-Update …“.
- Update aus einer Datei: Katalog-Packs (Modrinth/CurseForge) behalten ihre Herkunft, die Version wird aber unbekannt
  (die Katalog-Prüfung bietet danach wieder die offizielle neueste Version an). Packwiz-Instanzen werden zu `local`.
- Instanz ohne Modpack-Herkunft: funktioniert ebenfalls (ohne gespeicherten Ausgangsstand, Hinweis „ältere Installation“),
  so lässt sich ein Packwiz-Pack auch erstmals in eine leere Instanz holen.

## Mock

`src/dev/mock/packupdate.ts`. URL mit „fail“ liefert einen Fehler. `localStorage["vl.mock.packwiz-update"] = "2.2.0"`
lässt Packwiz-Instanzen ein Update melden.
