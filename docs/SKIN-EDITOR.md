# Skin-Editor

Mal-Editor für Minecraft-Skins auf der Skins-Seite (Feature 33).

## Bedienung

- Öffnen: Knopf **Skin-Editor** oben rechts auf der Skins-Seite (startet mit dem gerade angezeigten Skin), Rechtsklick auf einen Bibliotheks-Skin → **Im Editor bearbeiten**, oder im Menü des aktuellen Skins → **Aktuellen Skin bearbeiten**.
- Im Editor über **Öffnen**: neue Vorlage, aktueller Skin des Accounts oder ein Skin aus der Bibliothek. Das Original wird nie überschrieben.
- Werkzeuge: Pinsel (B), Radierer (E, auch rechte Maustaste), Pipette (I, auch Alt + Klick), Füllen (G, bleibt auf einer Seite eines Körperteils), Spiegeln (M, malt auf der anderen Körperseite mit).
- Rückgängig/Wiederholen: Strg+Z / Strg+Y (bis zu 100 Schritte).
- **Ebene**: Grundschicht oder Außenschicht (Glossar-Begriff `skinlayer`). Beim Malen auf der Außenschicht wird die Grundschicht blass darunter gezeigt.
- **Körperteile**: Kopf, Körper, Arme, Beine einzeln wählen – die Ansicht zoomt dann auf dieses Teil, alles andere ist gesperrt.
- **Modell**: Classic oder Slim (Glossar-Begriff `skinmodel`).
- Rechts eine Live-3D-Vorschau (vorhandener `SkinViewer3D`), Außenschicht ein-/ausblendbar.
- Speichern: **In Bibliothek speichern** legt einen neuen Bibliotheks-Eintrag an (Herkunft „Skin-Editor“). **Speichern und anziehen** setzt ihn zusätzlich über die Mojang-Skin-API (`skin_apply_library`).

Alte 64×32-Skins werden beim Öffnen wie im Spiel auf 64×64 erweitert (linker Arm/linkes Bein gespiegelt). Gespeichert wird immer 64×64.

## Technik

- Frontend: `src/features/skins/editor/`
  - `layout.ts` – UV-Layout (Teile, Ebenen, Seiten), Treffer-Tabelle, Spiegel-Abbildung
  - `pixels.ts` – Pixelpuffer, Füllen, Linien, Spiegeln, Laden/Speichern, Vorlage
  - `history.ts`, `useSkinEditor.ts`, `shortcuts.ts` – Zustand, Verlauf, Tastenkürzel
  - `EditorCanvas.tsx`, `ToolPanel.tsx`, `ColorPanel.tsx`, `PartsPanel.tsx`, `EditorToolbar.tsx`, `LibraryPicker.tsx`, `SkinEditorDialog.tsx`
- Backend: neuer Befehl `skin_library_add_data(png, name, variant)` in `src-tauri/src/commands/skins.rs`. `png` ist eine `data:image/png;base64,…`-URL oder reines Base64; geprüft wird wie bei Dateien (PNG, 64×64 oder 64×32, max. 512 KB) über `auth::skins::decode_png_payload`.
- Mock: `skin_library_add_data` in `src/dev/mock/skins.ts`.
- i18n: `src/i18n/skineditor.ts` (DE/EN).
- Keine neuen Abhängigkeiten.
