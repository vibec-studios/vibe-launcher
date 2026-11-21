# Skin-Wechsel im Spiel (Nr. 34)

Vertrag: `contracts/14-34-client-launcher.md` Teil B, Vibey Client `docs/SKINS.md`. Code: `src-tauri/src/play/skin_bridge.rs`.

## Ablauf

- **Wann geschrieben:** sobald eine Instanz mit Vibey Client startet (Ereignis `game://state` mit Konto, also vor dem
  Spielprozess), bei `skins://changed` für alle laufenden Vibey-Instanzen und nach jedem Wechsel aus dem Spiel.
- **Was:** `.vibe/skins/<id>.png` (Kopien, nur bei geänderter SHA-1 neu, Temp + Rename), dann `.vibe/skins.json`
  (`schema 1`, `account` = Konto, mit dem die Instanz gestartet wurde, `can_change`/`reason`, `active`, `skins[]` neueste
  zuerst, max. 500, nur Ids `[A-Za-z0-9_-]{1,64}`), danach veraltete PNGs löschen.
- **`active`:** einmal pro Start wird das Mojang-Profil gelesen (SHA-1 der aktiven Textur, Variante; Textur-Cache),
  danach aus dem Ergebnis des letzten Wechsels. Liegt der Skin in der Bibliothek, steht `library_id` dabei.
- **Anfragen:** Ein Hintergrund-Thread prüft alle ~0,9 s `skin-request.json`, aber nur solange ein Spiel läuft
  (`stat` genügt). Ungültig/älter als 60 s → Fehler `other` (falls die `id` lesbar ist). Sonst sofort
  `skin-result.json` `working`, Anfrage löschen, `skin_apply_library` mit dem Konto der Instanz (inkl. Cape-Logik),
  ein Wechsel gleichzeitig pro Konto (sonst `busy`), Ergebnis `ok`/`error`, `skins.json` neu, `skins://changed`.
- **Fehlercodes:** 401/abgelaufen → `signed_out`, 429 → `rate_limited`, andere Mojang-Ablehnung → `mojang`,
  Verbindungsfehler → `network`, Skin nicht in der Bibliothek → `not_found`, kein Konto → `no_account`, Offline-Profil
  (nur Debug) → `offline_account`, sonst `other` (mit `message`).

Kein Token in den Dateien; alles bleibt im Instanzordner. Das Frontend braucht nichts Neues (Mock unverändert).

## Tests

`cargo test --lib skin_bridge`: Schreiben inkl. Aufräumen und ungültiger Ids, Anfragen (gültig, zu alt, falsche Aktion,
Pfad in `skin_id`, falsches Schema, kaputt), Ergebnisdateien, Fehler-Mapping.
