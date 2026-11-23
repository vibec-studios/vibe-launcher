# Architektur und Ordnerkonvention

Wie Code im Launcher geschnitten wird: kurze Dateien mit einer klaren Aufgabe, Features als eigene Ordner, stabile Importpfade. Gilt für neuen Code und für jedes Aufräumen.

## Größenrichtwert

- **Höchstens ~300 Zeilen je Code-Datei** (`.ts`, `.tsx`, `.rs`, `.mjs`, `.css`). Wird eine Datei größer, nach Verantwortung teilen, nicht nach Zeilen.
- **Ausnahmen:** Übersetzungs-Bundles und Locales (`src/i18n/*.ts`, `locales/`, `panel/src/i18n/`), Tests (`tests.rs`, `tests/`, `*.test.ts`), Testdaten (`testdata/`), generierte Dateien (`gen/`, `dist/`, `*.d.ts`), das Mock-Backend (`src/dev/mock/`). Reine Tabellen oder Kataloge dürfen begründet größer sein.
- **Prüfen:** `node scripts/check-size.mjs` listet alle Code-Dateien über 300 Zeilen. Die CI (`--check --warn-only`) warnt bei **neuen** Dateien über 300 Zeilen und bei Dateien, die über ihren Wert in `scripts/size-baseline.json` wachsen. Nach dem Verkleinern die Baseline mit `node scripts/check-size.mjs --baseline` nachziehen.

## Frontend (`src/`)

| Ordner | Inhalt |
| --- | --- |
| `app/` | Shell, Router, globale Hosts (Toasts, Bestätigungen, Event-Brücke) |
| `components/` | Geteilte Bausteine: `ui/` (Design-System), `content/`, `instance/` … – nichts Feature-Spezifisches |
| `lib/` | App-weite Logik: `api.ts` (Tauri-Aufrufe), `types.ts`, `queries.ts`, Stores, Format-Helfer |
| `features/<feature>/` | Ein Bereich der App (Seite, Dialoge, Logik), siehe unten |
| `i18n/` | Ein Übersetzungs-Bundle je Bereich, Locales unter `locales/<sprache>/` |
| `dev/mock/` | Simuliertes Backend für `VITE_MOCK=1` |
| `console/` | Eigenes Konsolenfenster (`console.html`) |

### Feature-Ordner

```text
src/features/<feature>/
  <Feature>Page.tsx      Einstieg (Route oder Dialog-Host) – schlank, setzt nur zusammen
  components/            Teilkomponenten, eine Komponente (plus kleine Helfer) je Datei
  hooks/                 useXyz.ts – Datenladen, abgeleiteter Zustand, Effekte
  api.ts                 Tauri-/HTTP-Aufrufe des Features
  store.ts               zustand-Store für UI-Zustand (offen/zu, Auswahl, Entwürfe)
  types.ts               Typen, die nur dieses Feature braucht
  utils.ts               reine Funktionen ohne React
```

- Kleine Features (wenige kurze Dateien) dürfen flach bleiben. Die Unterordner lohnen sich, sobald ein Feature mehr als eine Handvoll Dateien hat oder eine Datei die 300 Zeilen reißt. Vorbilder: `features/skins/editor/`, `features/remote/add/`.
- Große Komponenten teilen: Abschnitte als eigene Komponenten nach `components/`, Logik in einen Hook (`hooks/useXyz.ts`), Berechnungen nach `utils.ts`. Props statt verschachtelter Closures.
- Andere Bereiche importieren nur den Einstieg oder ausdrücklich geteilte Teile, nicht tief verschachtelte Interna.
- **Importe stabil halten:** Wird eine viel genutzte Datei geteilt, bleibt an der alten Stelle ein schlanker Re-Export (z. B. `lib/types.ts` → `lib/types/*.ts` + `lib/types/index.ts`, alte Datei exportiert weiter). So müssen andere Bereiche nicht angefasst werden.
- Pfad-Alias `@/` für alles außerhalb des eigenen Feature-Ordners, relative Pfade innerhalb.

### Eigene Themes (Format v2)

Kern ohne DOM in `lib/themes/` (Format, CSS-Tokenizer und -Bereinigung, Markup-Allowlist, Palette, Kompilieren in den
Theme-Scope, Tests mit `pnpm test`), Laufzeit in `features/themes/` (`ThemeHost` in `AppearanceHost`, `ThemeSlot` an
den Deko-Plätzen, Notausgang). Bausteine tragen stabile Haken `data-part="…"`; Scope-Wurzeln sind `data-vt-scope`
(App-Rahmen, normale Dialoge), Schutzbereiche `data-vt-protected` bzw. `Dialog protect` / `ThemeProtect`. Der
KI-Skill nutzt denselben Kern als erzeugte Kopie (`skills/vibe-launcher-theme/gen/`, `pnpm theme:skill`).
Details: [THEMES.md](THEMES.md).

### Übersetzungen und Mock registrieren sich selbst

- **i18n:** Jede Datei `src/i18n/<bereich>.ts` mit `export default { de: {...}, en: {...} }` wird per `import.meta.glob` automatisch geladen, alphabetisch nach Dateiname. Bei doppelten Schlüsseln gewinnt die alphabetisch spätere Datei – doppelte Schlüssel vermeiden. Neue Bereiche brauchen keinen Eintrag in `index.ts`.
- **Mock:** Jede Datei `src/dev/mock/<bereich>.ts` mit `export default { befehl: (args) => … }` ist ein Handler-Modul und wird automatisch registriert (alphabetisch). Soll ein Modul Handler anderer Module bewusst überschreiben, bekommt es `export const priority = 1` (oder höher); höhere Priorität gewinnt, bei gleicher Priorität der spätere Dateiname. Hilfsmodule ohne `export default` (z. B. `util.ts`, `sessions.ts`) werden nicht als Handler behandelt.

## Rust (`src-tauri/`, `crates/`, `agent/`)

- **Modul je Aufgabe:** Ein Bereich ist ein Ordner mit `mod.rs` (öffentliche API, `pub use` der Untermodule) und Untermodulen nach Aufgabe, z. B. `content/world_preview/{mod.rs, anvil.rs, colors.rs, info.rs, mods/}`. Für neue Module `ordner/mod.rs` statt `ordner.rs` + `ordner/`.
- **Typische Schnitte:** `model.rs` (Datentypen, Serde), `store.rs` / `io.rs` (Dateien, Datenbank), `client.rs` / `api.rs` (HTTP), `<aufgabe>.rs` (eigentliche Logik), `util.rs`.
- **Tauri-Befehle** liegen dünn in `src-tauri/src/commands/<bereich>.rs` und rufen die Logik im Fachmodul auf. Befehlsnamen und Signaturen sind Vertrag mit dem Frontend – beim Aufteilen nicht ändern. Wird ein Fachmodul geteilt, bleibt der alte Pfad per `pub use` erreichbar.
- **Tests:** nicht inline, sondern als Untermodul `#[cfg(test)] mod tests;` mit `tests.rs` neben `mod.rs`. Werden die Tests groß, Ordner `tests/` mit `tests/mod.rs` und einer Datei je Thema. Testdaten unter `testdata/`. Beim Umbau darf die Testanzahl nicht sinken (`cargo test -j 2 -p <crate>`).

## Prüfen beim Umbau

- `pnpm exec tsc --noEmit`, `pnpm build`; Rust: `cargo check -j 2 --workspace --all-targets` und Tests der betroffenen Crates.
- Optik: Screenshot-Vergleich gegen eine Baseline vom Stand vor dem Umbau, siehe [`scripts/visual/README.md`](../scripts/visual/README.md). Jede Abweichung ist ein Fehler.
- Keine Code-Kommentare in neuem Code; vorhandene Kommentare wandern mit.
