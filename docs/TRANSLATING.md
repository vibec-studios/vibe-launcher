# Übersetzen / Translating

Der Launcher spricht Deutsch (`de`), Englisch (`en`), Spanisch (`es`), Französisch (`fr`), Polnisch (`pl`),
Portugiesisch Brasilien (`pt-BR`) und Türkisch (`tr`). Neue Texte entstehen zuerst auf Deutsch und Englisch;
alle anderen Sprachen fallen für fehlende Schlüssel automatisch auf **Englisch** zurück (danach Deutsch).
Eine halb fertige Übersetzung ist also nie kaputt, nur stellenweise englisch.

*English summary: German and English live in `src/i18n/<area>.ts`. Every other language is plain JSON in
`src/i18n/locales/<lang>/`. Missing keys fall back to English. Run `node scripts/i18n-missing.mjs --lang <code>`
to see what is missing, translate it into the matching `<area>.json`, open a pull request.*

## Wo liegt was

| Was | Datei |
|---|---|
| Deutsch + Englisch (Quelle) | `src/i18n/<bereich>.ts` – je `{ de: {...}, en: {...} }` |
| Weitere Sprachen | `src/i18n/locales/<sprache>/<bereich>.json` – flach `"schlüssel": "Text"` |
| Glossar (Hilfe → Begriffe) | `src/i18n/locales/<sprache>/help/glossary.json` |
| Hilfe-Center (Anleitungen, Touren) | `src/i18n/locales/<sprache>/help/content.json` (optional) |
| Liste der Sprachen | `src/i18n/languages.ts` |

Jede Sprache wird als eigener Chunk erst geladen, wenn sie gewählt ist (`locales/<sprache>/index.ts`).
`*.todo.json` wird nie geladen – das ist nur eine Arbeitsdatei.

## Fehlende Texte finden

```bash
node scripts/i18n-missing.mjs                 # Übersicht: Fortschritt pro Sprache
node scripts/i18n-missing.mjs --lang fr       # alle fehlenden Schlüssel mit englischem Text
node scripts/i18n-missing.mjs --lang fr --write   # legt <bereich>.todo.json mit den fehlenden Texten an
node scripts/i18n-missing.mjs --check         # Exit 1 bei kaputtem JSON oder falschen Platzhaltern (für CI)
```

Workflow: `--write` ausführen, die `*.todo.json` übersetzen, Inhalt in die passende `<bereich>.json` übernehmen,
`.todo.json` löschen, `--check` laufen lassen.

Das Skript meldet außerdem **veraltete** Schlüssel (gibt es im Englischen nicht mehr → können raus) und
Glossar-/Hilfe-Einträge, die noch fehlen.

## Regeln

- **Platzhalter** wie `{name}`, `{n}`, `{version}` genau so übernehmen. Reihenfolge darf sich ändern.
- **Markennamen bleiben**: Vibe, Vibey Client, Vibe Launcher, Modrinth, CurseForge, Fabric, Forge, NeoForge,
  Quilt, Iris, OptiFine, Sodium, playit.gg, Blockbench, Minecraft: Java Edition.
- **Ton**: locker und freundlich, wie unter Gamern. Du-Form (ES *tú*, FR *tu*, PT-BR *você*, TR *sen*, PL *ty*
  ohne Geschlechtsformen, wo es geht). Keine Fachbegriffe ohne Not.
- **Simple Mode**: Schlüssel mit `simple:`-Präfix sind die Anfänger-Variante (z. B. „Spiel“ statt „Instanz“).
  Fehlt die `simple:`-Variante, wird der normale Text der Sprache genommen.
- **Länge**: Buttons und Tabs sind schmal – lieber kurz. Der Launcher wurde mit FR und PL (lange Texte) bei
  980 × 620 geprüft.
- **Mehrzeilige Texte** (`\n` im JSON) behalten die gleiche Zeilenzahl.
- Minecraft-Begriffe so, wie sie im Spiel in der jeweiligen Sprache heißen (Spielmodi, Schwierigkeit …).

## Neue Sprache hinzufügen

1. In `src/i18n/languages.ts` einen Eintrag ergänzen (`code`, Eigenname, englischer Name, Intl-Locale).
2. Ordner `src/i18n/locales/<code>/` anlegen und `index.ts` aus einer anderen Sprache kopieren.
3. Im Rust-Backend `LANGUAGES` in `src-tauri/src/settings/syslang.rs` ergänzen (sonst setzt `settings_set` die
   Sprache auf Englisch zurück) und optional die Windows-Sprach-ID in `from_langid`.
4. `node scripts/i18n-missing.mjs --lang <code> --write` und loslegen.

Die Sprachauswahl in Einstellungen und Onboarding liest die Liste automatisch.

## Wie der Fallback funktioniert

`translate()` in `src/i18n/index.ts`:

- `de` / `en`: wie bisher (Sprache → Deutsch → Englisch).
- andere Sprachen: `simple:`-Variante der Sprache → Text der Sprache → `simple:`-Variante Englisch →
  Englisch → Deutsch → Schlüssel.

Datums- und Zahlenformate kommen aus `intlLocale()` (z. B. `pl-PL`). Ankündigungen vom Server und der
Discord-Status kennen nur DE/EN; alle anderen Sprachen bekommen dort Englisch.
