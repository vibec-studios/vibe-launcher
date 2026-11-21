# Vibey Client eingestellt

Stand 21.11.2026. Vibe konzentriert sich komplett auf den Launcher. Der Vibey Client wird nicht mehr weiterentwickelt.

## Was aus dem Launcher-Frontend entfernt ist

- **Cosmetics:** Seite „Cosmetics“, 3D-Vorschau, Emote-Rad, Creator-Bereich mit Blockbench-Plugin, Eintrag in der
  Seitenleiste, Tour-Schritt und Hilfetexte. Alte Links (`#/cosmetics`, `#/cosmetics/creator`) leiten zur Startseite um.
- **Vibey Client installieren:** Client-Pack „Vibey Client“, Schalter in den Instanz-Einstellungen, Symbol im
  Instanzkopf, Ziel „Vibey Client“ im Neues-Spiel-Assistenten. „Mit Freunden spielen“ richtet jetzt immer Essential ein.
- **Clips/Rückblick und Clip-Editor:** Galerie zeigt nur noch Screenshots (kein Umschalter mehr).
- **Skin-Wechsel im Spiel (Skin-Brücke):** kein Frontend-Teil mehr; Skin-Editor und Skin-Bibliothek bleiben.
- **Sprachchat-Hinweis für Welten aus dem Spiel** (Instanz-Tab „Welten“): entfernt, Sprachchat gibt es für Server.
- Hinweise wie „mit Vibey Client …“ in Onboarding, Warteliste, Datenschutz-Übersicht und Hilfe.

## Was bleibt

Freunde, Chat, Presence, Einladungen, Play-Links (Beitreten), Hosting-Panel für Launcher-Server, Remote-Server, AFK,
Skin-Editor, Screenshots, Client-Packs NoRisk/Essential, Vibe-Konto und Beta-Warteliste.

## Bestehende Nutzer

Hat eine Instanz noch den Vibey Client (Datei `vibeyclient*.jar`, Mod-Name „Vibey Client“ oder Client-Pack „vibey“),
zeigt die Instanzseite einen dezenten Hinweis: „Der Vibey Client wird nicht mehr weiterentwickelt. Du kannst ihn
behalten oder entfernen.“ „Entfernen“ fragt nach und entfernt den Client über das Client-Pack bzw. das normale
Mod-Entfernen. Das Ausblenden wird je Instanz in `settings.dismissed_notices` (`vibey-eol:<id>`) gemerkt.
Code: `src/features/instances/vibeyEol/`.

## Was aus dem Rust-Teil entfernt ist

- **`vibey_client/**`** (Verteilung über `/api/v1/client/latest`, Installation je Instanz, Cosmetics-Assets,
  Einreichungen, Blockbench) mit allen 15 `vibey_*`-Befehlen.
- **Update vor dem Spielstart** (`vibey_client::before_launch`): Der Launcher installiert oder aktualisiert den
  Client nicht mehr still. Ein über den Hinweis entferntes Jar kommt also nicht zurück.
- **Client-Pack „vibey“:** nicht mehr in `client_packs_list`. NoRisk, NoRisk Mini und Essential bleiben.
- **Clips/Clip-Editor:** `clips_list`, `clip_update`, `clip_delete`, `clip_open_folder`, `clips_watch`,
  `clip_set_trim`, `clip_export_available`, `clip_export_trim` und das Event `clips://changed`.
- **Skin-Brücke** (`play::skin_bridge`, `.vibe/skins*.json`, `skin-request.json`). `skin_apply_library` bleibt.
- **Seitenleiste:** `"cosmetics"` ist kein bekannter Eintrag mehr. Alte Einstellungen mit dem Schlüssel laden
  weiter, er wird still verworfen.

Bleibt im Rust-Teil: AFK (`afk/**`, lädt den Helfer weiter aus `vibec-studios/vibey-client`, siehe `AFK-AGENT.md`),
`play_sessions` (liest `.vibe/session.json`, liefert ohne Client nichts mehr), `.vibe/instance.json` vor jedem Start,
die Domain-Migration `*.vibey.henny.dev` und `client_pack_install`/`client_pack_remove`.

### Alte Daten

- `instances/<id>/vibey-client.json` und Vibey-Client-Jars bleiben unberührt; nichts wird automatisch gelöscht.
- Einstellungen → Speicher bietet `<daten>/vibey/` und alle `instances/<id>/vibey-client.json` als „Vibey-Client-Reste (eingestellt)“ zum Entfernen an (Kategorie `vibey`, `storage_clean`). Jars in `mods/` fasst das nicht an.
- **Play-Links mit `client_pack: "vibey"`:** Die Vorschau zeigt kein Client-Pack an, die Einrichtung installiert
  nichts und schreibt ins Instanz-Log „Der Einladende nutzt den Vibey Client. Den gibt es nicht mehr – du trittst
  ohne ihn bei.“ Neue Links und `instance.json` nennen kein `"vibey"` mehr.
- Weggeklickte Hinweise der Form `<art>:<id>` (z. B. `vibey-eol:<instanz>`) bleiben beim Speichern der
  Einstellungen erhalten.

## Eingestellte Dokumente

`CLIP-EDITOR.md` und `SKIN-BRIDGE.md` sind gelöscht. In `VIBE-API-2.md`, `WAITLIST.md`, `VOICE-BEDROCK.md` und
`PLAY-LINKS.md` sind die Client-Teile als „eingestellt“ markiert.
