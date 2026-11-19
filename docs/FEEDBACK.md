# Feedback & Fehlerberichte

Knopf „Feedback & Fehler melden“ in der Titelleiste (auch im Simple-Modus), in **Einstellungen → Über** und
„Problem melden“ in der Absturzanzeige einer Instanz. Code: `src-tauri/src/feedback/`,
`src-tauri/src/commands/feedback.rs`, `src/features/feedback/`.

## Ablauf

1. **Öffnen** – vorher nimmt Rust einen Screenshot des Launcher-Fensters auf (Windows: `PrintWindow` mit
   `PW_RENDERFULLCONTENT`, Ersatz `BitBlt`). Er bleibt nur im Speicher und wird nur angehängt, wenn das Häkchen
   gesetzt ist (Standard: aus).
2. **Eingabe** – Art (Fehler/Idee/Sonstiges), Text (10–5000 Zeichen), Kontakt (optional, ≤ 200), betroffene
   Instanz, „Logs anhängen“, Screenshot des Launchers, weitere Bilder per Datei-Dialog (öffnet Rust selbst),
   optional „Mit meinem Vibe-Konto verknüpfen“.
3. **Vorschau** (`feedback_preview`) – Rust liest die Logs, kürzt und bereinigt sie und legt das fertige Paket
   unter einem Einmal-Token ab. Die Vorschau zeigt **genau** dieses Paket: alle Metadaten, jeden Log-Text
   (ersetzte Stellen hervorgehoben), die Screenshots, Absender (anonym/Konto), Ziel-Adresse und Gesamtgröße.
4. **Senden** (`feedback_send(token)`) schickt das vorbereitete Paket unverändert. Erfolg → „Danke! Deine
   Meldung VB-1042 ist angekommen.“ mit Kopieren-Knopf. Offline/429/413/5xx → verständliche Meldung, Entwurf
   und Vorschau bleiben erhalten („Erneut senden“).

Der Entwurf (Art, Text, Kontakt) wird lokal mitgeschrieben und erst nach erfolgreichem Senden geleert.

**Einstieg für andere Bereiche** (z. B. Autofix „nicht automatisch lösbar“):

```ts
import { openFeedback } from "@/features/feedback/store";
openFeedback({ kind: "bug", instanceId, attachLogs: true, source: "autofix" });
// oder fertiger Knopf:
import { ReportProblemButton } from "@/features/feedback/FeedbackDialog";
<ReportProblemButton instanceId={id} source="autofix" />
```

## Vertrag

`POST {API}/api/v1/feedback` (`{API}` wie alle Vibe-Aufrufe, `src-tauri/src/domains.rs`; Debug-Builds:
`VIBE_API_URL`), `multipart/form-data`:

| Feld | Inhalt |
|---|---|
| `meta` | JSON (siehe unten), `application/json` |
| `log` (0–3) | `text/plain`, je ≤ 1 MB, Dateiname `launcher.log`, `latest.log`, `crash-….txt` |
| `screenshot` (0–3) | `image/png` oder `image/jpeg`, je ≤ 5 MB |

```json
{
  "kind": "bug" | "idea" | "other",
  "message": "…",            // 10–5000 Zeichen, getrimmt
  "contact": "…" | null,     // ≤ 200
  "app": "launcher",
  "version": "1.0.0-beta.4",
  "channel": "release" | "dev",
  "os": "Windows 11 Pro",
  "arch": "x86_64",
  "locale": "de",
  "page": "/instances/abc" | null,   // nur der Pfad, ohne Query
  "instance": { "mc_version", "loader", "loader_version", "mod_count", "java" } | null
}
```

`java` ist z. B. `"Java 21.0.5 (Microsoft, x64)"` aus der letzten Startzeile – ohne Pfad. `mod_count` = `.jar`
in `mods/`. Bedrock: `loader = "bedrock"`, `java = null`.

`Authorization: Bearer <Vibe-Token>` nur, wenn Vibe eingeschaltet, angemeldet, das Token noch gültig ist **und**
das Häkchen „Mit meinem Vibe-Konto verknüpfen“ gesetzt ist. Sonst anonym.

Antwort `201 { "id", "ticket" }`; Fehler `400/413/429` mit `{ error: { code, message } }` (429 mit
`Retry-After` in Sekunden). Rust liefert der Oberfläche `SendResult`:
`sent | rate_limited | rejected | offline`.

## Welche Logs

Mit „Logs anhängen“ (höchstens 3):

1. `launcher.log` – neueste Datei `logs/launcher.log*` im Datenordner, **letzte 256 KB**
2. `latest.log` der gewählten Instanz, **letzte 256 KB**
3. Crash-Report: der der letzten Sitzung (aus dem Spielzustand), sonst der neueste in `crash-reports/`, wenn
   jünger als 3 Tage – hier die **ersten 256 KB** (die Ursache steht oben)

Gekürzte Logs tragen einen Hinweis in der ersten bzw. letzten Zeile. Das Frontend übergibt **keine Pfade**:
Logs bestimmt Rust; Bilder kommen nur aus dem Fenster-Screenshot oder dem Datei-Dialog, den Rust öffnet
(Inhalt wird geprüft: PNG/JPEG per Signatur, ≤ 5 MB; Dateiname wird bereinigt).

## Bereinigung (`feedback/redact.rs`)

In dieser Reihenfolge, Tests in derselben Datei und in `feedback/tests.rs`:

| Was | Beispiel | Ersetzt durch |
|---|---|---|
| JWTs | `eyJhbGci….eyJzdWIi….sig` | `<token>` |
| Bearer | `Bearer abc.def` | `Bearer <token>` |
| Start-Argumente | `--accessToken x`, `--xuid x`, `--clientId x`, `--session x`, `--uuid x` | `--accessToken <redacted>` |
| Minecraft-Session | `token:<access>:<uuid>` | `token:<redacted>` |
| Schlüssel/Wert | `accessToken=…`, `"refresh_token": "…"`, `session_id: …`, `password=…`, `api_key=…` | Schlüssel bleibt, Wert `<redacted>` |
| E-Mail | `max@example.org` (nicht `mod.mixins@mod.json`) | `<email>` |
| Benutzer in Pfaden | `C:\Users\<name>`, `C:\\Users\\<name>`, `/home/<name>`, `/Users/<name>` | `<user>` |
| OS-Benutzer / Rechnername überall | `OneDrive - henny`, `DESKTOP-7K2` | `<user>` / `<host>` |
| IP-Adressen | `192.168.1.5`, `2001:db8::1` (nicht `127.0.0.1`, `0.0.0.0`, Versionen wie `47.2.0.1` in `forge-1.20.1-47.2.0.1.jar`) | `<ip>` |

Die Vorschau zeigt je Log die Anzahl ersetzter Stellen.

## Vibe-Hauptschalter

Feedback läuft **auch bei ausgeschalteten Vibe-Diensten**: Es ist eine Kernfunktion des Launchers (Fehler
melden muss immer gehen, gerade wenn etwas kaputt ist), und es wird nur auf ausdrücklichen Klick nach der
Vorschau gesendet – nie im Hintergrund. Der Dialog sagt klar, dass die Meldung an Vibe Craft Studios
(`vibe.axolite.app`) geht. Bei ausgeschaltetem Vibe wird nie ein Konto verknüpft (kein Token).

## Mock

`src/dev/mock/feedback.ts`. `localStorage vl.mock.feedback` = `offline` | `ratelimit` | `toolarge` | `server`
lässt das Senden entsprechend scheitern; sonst Ticket `VB-1042`.
