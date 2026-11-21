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

## Noch offen (Rust)

Die Befehle, Events und Hintergrundabläufe des Clients in `src-tauri/` (u. a. `vibey_client::*`, Clips, Skin-Brücke,
Update vor dem Spielstart) werden in einem eigenen Schritt entfernt.

## Eingestellte Dokumente

`CLIP-EDITOR.md` und `SKIN-BRIDGE.md` sind gelöscht. In `VIBE-API-2.md`, `WAITLIST.md`, `VOICE-BEDROCK.md` und
`PLAY-LINKS.md` sind die Client-Teile als „eingestellt“ markiert.
