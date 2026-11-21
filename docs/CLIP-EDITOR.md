# Clip-Editor und langer Rückblick (Nr. 14)

Vertrag: Vibey Client `docs/CLIPS.md` §15 bzw. `contracts/14-34-client-launcher.md` Teil A.

## Was der Launcher macht

- **Scannen:** Nur `<id>.json` direkt im Clip-Ordner zählen. Der Pufferordner `.buffer/` (MPEG-TS-Stücke des langen
  Rückblicks) wird weder gelistet noch zur Größe gezählt (Test `buffer_dir_is_not_scanned`).
- **Neue Felder** werden gelesen und ans Frontend gegeben: `keyframes_ms`, `cuts_ms`, `rewind`, `trim_hint`, `trim`,
  `source_id`. Beim Umschreiben von `kept`/`title`/`tags`/`trim` bleiben alle anderen Felder erhalten (JSON lesen,
  ein Feld ändern, Temp-Datei + Rename).
- **Galerie:** Rückblick-Clips tragen die Marke „Rückblick“. Der Player-Dialog hat „Zuschneiden“; bei Rückblick-Clips
  (oder wenn schon ein `trim` gespeichert ist) ist der Editor sofort offen, vorausgewählt ist `trim`, sonst `trim_hint`,
  sonst der ganze Clip. Lange Clips laufen über das Asset-Protokoll (Streaming, kein vollständiges Einlesen).
- **Editor:** zwei Griffe (Maus oder Pfeiltasten, Umschalt = 5 s), der Anfang rastet auf den letzten Keyframe davor ein
  (Schnitt ohne Neukodierung). Sprungschnitte (`cuts_ms`) als gestrichelte Linien, der Vorschlag als Balken oben.
  „Vorschau“ spielt nur den Bereich.
- **Schnitt merken:** schreibt `trim` (nicht-destruktiv, `clip_set_trim`). „Ganzer Clip“ + merken entfernt `trim`.
- **Als neuen Clip speichern** (`clip_export_trim`): neuer Clip `YYYY-MM-DD_HH-mm-ss_edit` im selben Ordner,
  Reihenfolge MP4 → JPG → JSON (jeweils Dotfile-Temp + Rename), `reason: "edit"`, `source_id`, `duration_ms`/
  `size_bytes` neu, `events`/`highlight_ms`/`keyframes_ms`/`cuts_ms` verschoben (außerhalb liegende entfallen),
  `kept: false`, `rewind`/`trim_hint`/`trim` entfallen, Rest vom Original. „Original danach löschen“ nur auf Wunsch
  (mit Rückfrage, gesperrt bei behaltenen Clips), Löschreihenfolge JSON zuerst.

## Warum FFmpeg aus der Instanz

Ein MP4-Schnitt ohne Neukodierung braucht einen Muxer. Statt eine neue Abhängigkeit zu bündeln, nutzt der Launcher das
FFmpeg, das der Vibey Client für die Clip-Aufnahme ohnehin lädt (`<instanz>/minecraft/vibeyclient/ffmpeg/bin/ffmpeg(.exe)`,
LGPL, eigener Prozess). Wer Clips hat, hat dieses FFmpeg. Reihenfolge der Suche: eigene Instanz → andere Instanzen →
`PATH` → übliche Linux/macOS-Pfade. Fehlt es, zeigt der Editor einen Hinweis und nur „Schnitt merken“ geht.

Befehl: `ffmpeg -ss <start> -to <ende> -i <id>.mp4 -map 0 -c copy -avoid_negative_ts make_zero -movflags +faststart`,
Vorschaubild mit `-frames:v 1 -vf scale=480:-2`. Läuft ohne Konsolenfenster.

## Tests

`cargo test --lib clip` (Rust): Trim schreiben/entfernen mit Erhalt fremder Felder, Metadaten des neuen Clips,
eindeutige Ids, Keyframe-Abrundung, `.buffer/`, und ein echter Export mit FFmpeg (läuft nur, wenn FFmpeg gefunden wird).
Mock: `VITE_MOCK=1` enthält einen Rückblick-Clip; `localStorage vl.mock.clips.ffmpeg = "none"` simuliert fehlendes FFmpeg.
