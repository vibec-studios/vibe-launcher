# Eigene Themes (Format v2)

Themes sind **Daten**, kein Code: Sie lassen sich gefahrlos teilen. Ein Theme kann Farben setzen, Bausteine
des Launchers per CSS umgestalten und kleine Deko-Elemente (HTML/SVG) an festen Plätzen zeigen, aber nie
JavaScript ausführen, nichts nachladen und keine Konto-, Bestätigungs- oder Einstellungsdialoge verändern.

Importieren: *Einstellungen → Darstellung → Eigene Themes → Importieren* (JSON, Code oder `.vibetheme`-Datei).
Der Dialog prüft das Theme, zeigt eine Vorschau und listet alles, was beim Prüfen entfernt oder angepasst wurde.

| | Format v1 | Format v2 |
|---|---|---|
| Code | `VIBE-THEME-1:…` | `VIBE-THEME-2:…` |
| Inhalt | `values` (Theme-Einstellungen) | `values` + `palette`, `css`, `slots`, `author`, `description` |
| Launcher | ab 1.0.0-beta.6 | ab 1.0.0-beta.9 |

v1-Dateien und -Codes funktionieren unverändert. Exportiert wird automatisch v1, solange ein Theme nur Werte
hat – so bleiben einfache Themes mit älteren Launchern kompatibel. Große Themes (über 60 000 Zeichen Code)
werden nur als Datei geteilt.

## Aufbau

```json
{
  "format": "vibe-launcher-theme",
  "version": 2,
  "name": "Iron Man",
  "author": "Vibe Launcher",
  "description": "Rot und Gold, Arc Reactor auf der Startseite.",
  "values": { "theme": "nether", "accent": "#ffb627", "tone": "dark", "…": "wie v1" },
  "palette": { "canvas": "#160506", "surface": "#220a0b", "text": "#fff1e0" },
  "css": "[data-part=\"button-primary\"] { border-radius: 0; box-shadow: 0 0 14px #ffb62788; }",
  "slots": { "home-hero": "<div class=\"jarvis\">{{greeting}}, {{player}}.</div>" }
}
```

Beispiele: `skills/vibe-launcher-theme/examples/` („Iron Man“ mit animiertem Arc Reactor, „Stiller See“).

## Palette

Eigene Farb-Tokens überschreiben die Flächen des Basis-Themes. Alle optional, nur `#rrggbb`. Akzent- und
Statusfarben bleiben in `values` (`accent`, `status`). Die Palette gilt nur, solange der Ton (`values.tone`)
eingestellt bleibt – stellt jemand den Ton um, zeigt der Launcher die Grundfarben.

| Schlüssel | CSS-Variable | Wofür |
|---|---|---|
| `frame` | `--tone-frame` | Fensterrahmen (Seitenleiste, Titelleiste) |
| `canvas` | `--tone-canvas` | Inhaltsfläche |
| `surface` / `surface2` / `surface3` | `--tone-s1/s2/s3` | Karten, Hover, gedrückt |
| `overlay` | `--tone-overlay` | Menüs, Dialoge |
| `border` / `border2` | `--line-1/2` | Linien |
| `field` | `--field` | Eingabefelder |
| `text` / `muted` / `dim` | `--t1/t2/t3` | Text, Nebentext, Hinweise |
| `on_accent` | `--ui-on-accent` | Schrift auf Akzentflächen |

Kontrast beim Import: Text unter 4,5 : 1 gibt einen Hinweis, unter 3 : 1 wird die Textfarbe verworfen (und
notfalls auch die Flächenfarben), Nebentext unter 2,2 : 1 und `on_accent` unter 3 : 1 ebenso.

## Parts (stabile Haken für CSS)

Theme-CSS spricht **Parts** an, keine internen Klassen. Ein Element kann mehrere Parts haben;
`[data-part="button"]` trifft alle Knöpfe, `[data-part="button-primary"]` nur die Hauptknöpfe.
Zustände über vorhandene Attribute: `[aria-current="page"]`, `[aria-selected="true"]`, `[data-state="checked"]`,
`:hover`, `:focus-visible`, `:disabled`.

| Part | Element |
|---|---|
| `sidebar`, `nav-item` | Seitenleiste, ihre Einträge (aktiv: `aria-current="page"`) |
| `header` | Titelleiste |
| `main` | Inhaltsfläche |
| `home`, `home-header`, `home-hero` | Startseite, Begrüßungszeile, „Weiterspielen“-Karte |
| `button`, `button-primary`, `button-accent`, `button-ghost`, `button-outline`, `button-subtle`, `button-danger` | Knöpfe |
| `icon-button` | Symbol-Knöpfe |
| `card` | Karten (Einstellungsgruppen, „Weiterspielen“) |
| `instance-tile` | Instanz-Kacheln |
| `dialog` | normale Dialoge (nicht die Schutzbereiche) |
| `input` | Eingabefelder, Auswahlfelder |
| `tabs`, `tab`, `segmented` | Reiterleisten, Reiter, Segment-Umschalter |
| `badge`, `chip` | Etiketten, Chips |
| `progress`, `progress-bar` | Fortschrittsbalken |
| `switch`, `checkbox` | Schalter, Checkboxen |
| `section`, `section-title` | Abschnitte mit Überschrift |
| `empty` | Leerzustände |
| `slot` (+ `data-slot="…"`) | Inhalt eines Deko-Platzes |

Design v1 und v2 tragen dieselben Parts. Wer nur eines meinen will: `html[data-design="v2"] [data-part="card"]`.
Weitere Bedingungen an `html`: `[data-tone]`, `[data-theme]`, `[data-cards]`, `[data-radius]`.

## Erlaubtes CSS

- Regeln mit Selektoren aus Typ, `.klasse`, `#id`, Attributen, Kombinatoren (` `, `>`, `+`, `~`) und den
  Pseudoklassen `:hover :active :focus :focus-visible :focus-within :disabled :enabled :checked :indeterminate
  :first-child :last-child :only-child :first-of-type :last-of-type :only-of-type :empty :root :placeholder-shown
  :read-only :read-write :default :required :optional :valid :invalid :not() :is() :where() :has() :nth-*() :lang() :dir()`.
- Pseudoelemente `::before ::after ::placeholder ::selection ::marker ::first-line ::first-letter ::-webkit-scrollbar*`
  (bekommen immer `pointer-events: none`).
- @-Regeln `@media`, `@supports`, `@container` (bis Tiefe 3), `@keyframes`, `@font-face`.
- `:root { --x: … }` setzt Variablen für den themebaren Bereich.
- Klassen und Ids gelten nur für eigene Elemente in den Deko-Plätzen (intern wird `vt-` vorangestellt), interne
  Klassen des Launchers lassen sich nicht ansprechen.

Entfernt werden: `@import`, `@namespace`, `@layer`, `@property`, `@scope`, `@page` und alle anderen @-Regeln,
verschachtelte Regeln (CSS-Nesting), Selektoren mit Namensraum, `&`, `:host`, `data-vt-*`; die Eigenschaften
`pointer-events`, `behavior`, `-moz-binding`, `-webkit-app-region`, `user-modify`, `view-transition-*`,
Anker-Positionierung; `position: fixed`; alle Funktionen außer Farben, Mathe, Verläufe, Transformationen, Filter,
Formen, `var()`, `counter()` u. ä. (also kein `expression()`, `image-set()`, `attr()`, `element()`, `paint()`);
`url()` außer `data:image/png|webp|gif|svg+xml` und in `@font-face` `data:font/woff2|woff|ttf|otf`.
`z-index` wird auf −10 … 10 begrenzt.

## Deko-Plätze (Slots)

Statisches HTML/SVG an festen Plätzen. Nicht klickbar (`pointer-events: none`), für Screenreader ausgeblendet,
auf ihre Fläche zugeschnitten.

| Slot | Wo | Größe |
|---|---|---|
| `home-hero` | Startseite ganz oben | volle Breite, max. 360 px hoch |
| `home-side` | Startseite, rechte Spalte oben | Spaltenbreite, max. 320 px |
| `sidebar-top` | Seitenleiste unter dem Logo | Leistenbreite, max. 160 px |
| `background` | Ebene hinter dem Seiteninhalt | ganze Inhaltsfläche |
| `corner-tl`, `corner-tr`, `corner-bl`, `corner-br` | Ecken der Inhaltsfläche, hinter dem Inhalt | 200 × 200 px |

`background` und die Ecken liegen **unter** dem Seiteninhalt und verdecken nie Bedienelemente.

Erlaubt: HTML `div span p strong b em i small br img h1–h4 ul ol li hr sup sub mark code`, SVG-Formen, Text,
Verläufe, Masken, Muster, Filter (`fe…`), `use` mit `href="#id"`. Attribute: `class`, `id`, `style` (gleiche
Regeln wie Theme-CSS), SVG-Geometrie und -Darstellung, `img src` nur `data:image/…`, Verweise nur `url(#id)`.
Verboten und entfernt: Skripte, `on…`-Handler, `foreignObject`, Links, Formulare, Medien, `iframe`, SVG-Animation
(`animate`, `set`), externe Quellen. Animationen gehen über `@keyframes` im Theme-CSS.

## Platzhalter

In Texten der Deko-Plätze, vom Launcher immer als Text eingesetzt (nie als HTML):

| Platzhalter | Inhalt |
|---|---|
| `{{greeting}}` | „Guten Morgen“ (5–11 Uhr), „Guten Tag“ (11–18), „Guten Abend“ – in der Launcher-Sprache |
| `{{player}}` | Name des aktiven Minecraft-Kontos (sonst „Spieler“) |
| `{{time}}`, `{{date}}` | Uhrzeit (HH:MM) und Datum (z. B. „Montag, 23. November“), aktualisiert sich |
| `{{friends_online}}` | Zahl der Freunde online |
| `{{instances}}` | Zahl der Instanzen |
| `{{last_played}}` | Name der zuletzt gespielten Instanz (sonst „—“) |
| `{{version}}` | Launcher-Version |

Unbekannte Platzhalter bleiben als Text stehen.

## Grenzen

| | Limit |
|---|---|
| Theme-Datei | 1 MB (Rust liest bis 1,6 MB), Eingabe als Code bis 1,45 Mio. Zeichen |
| CSS | 700 000 Zeichen, 1500 Regeln, 80 Angaben je Regel, 40 Keyframes |
| Schriften | 8 × `@font-face`, zusammen 300 KB |
| Bilder | je 200 KB, zusammen 600 KB |
| Deko-Platz | 260 000 Zeichen, 600 Knoten, insgesamt 2000 Knoten, Tiefe 24 |
| Code zum Kopieren | 60 000 Zeichen, sonst Datei |

## Sicherheit

- **Scope**: Theme-CSS wird beim Anwenden umgeschrieben. Jeder Selektor bekommt
  `:where([data-vt-scope],[data-vt-scope] *):not(:where([data-vt-protected],[data-vt-protected] *,[data-vt-lock]))`
  angehängt (plus `:not(#_vt_)`, damit Theme-Regeln die eingebauten Stile verlässlich schlagen). Scope-Wurzeln
  sind der App-Rahmen und normale Dialoge.
- **Schutzbereiche** liegen außerhalb des Scopes: Konto-Seite (dort pausiert das Theme-CSS ganz), Login-Dialoge,
  Bestätigungen (`confirm`), Geräte-/Remote-Kopplung, Einladungen, „Log teilen“, das ganze Einstellungs-Popup
  (inklusive Darstellung und Theme-Import), Onboarding. Dialoge darin erben den Schutz (`ThemeProtect`).
- Kein Theme-Element kann über Dialoge gelegt werden: `position: fixed` ist verboten, `z-index` begrenzt,
  Pseudoelemente fangen keine Klicks, Deko-Plätze sind gesperrt (`data-vt-lock`) und abgeschnitten.
- Schriftnamen und Keyframes bekommen ein Präfix (`vt-`), ein Theme kann also z. B. „Inter“ nicht durch eine
  eigene Schrift mit vertauschten Zeichen ersetzen.
- Palette: nur `#rrggbb`, Kontrastprüfung; die Farben gelten überall (auch in Schutzbereichen), bleiben aber lesbar.
- Content-Security-Policy bleibt `script-src 'self'`. Theme-CSS liegt in einem `<style>`-Element, Deko wird mit
  `createElement`/`setAttribute` aus dem geprüften Baum gebaut und zusätzlich durch DOMPurify geschickt.
- Erweiterungen liegen als Datei im Datenordner und werden bei jedem Laden erneut geprüft.

### Notausgang

- **Strg+Umschalt+0** schaltet ein eigenes Theme sofort ab (Grundwerte des Basis-Themes werden wiederhergestellt).
- **Umschalttaste beim Start gedrückt halten**: Theme-Erweiterungen bleiben in dieser Sitzung aus; der Hinweis
  bietet „Dauerhaft zurücksetzen“.
- Wirft ein Theme beim Anwenden einen Fehler oder wurde es beim letzten Start nicht fertig geladen, wird es
  automatisch deaktiviert.
- Nach dem Import erscheint der Hinweis auf Strg+Umschalt+0; *Einstellungen → Darstellung* ist nie themebar.

## Für Entwickler

| Wo | Was |
|---|---|
| `src/lib/themes/` | Kern ohne DOM: Regeln (`rules.ts`), CSS-Tokenizer/-Parser/-Bereinigung (`css/`), Markup (`markup/`), Palette, Format (`document.ts`), Kompilieren (`compile.ts`); Tests `*.test.ts` |
| `src/features/themes/` | Laufzeit: `ThemeHost` (anwenden, Cache, Absturzschutz), `ThemeSlot`, Platzhalter, Notausgang, Vorschau |
| `src/lib/customThemes.ts` | eigene Themes in den Einstellungen (Werte, Palette, Verweis auf die Erweiterung) |
| `src-tauri/src/commands/appearance.rs` | `appearance_theme_ext_save/load/delete/prune` (`<daten>/themes/<id>.vibetheme`) |
| `skills/vibe-launcher-theme/gen/` | aus `src/lib/themes` erzeugt (`pnpm theme:skill`), von `validate.mjs` genutzt |

Neuer Part: `data-part` am Element setzen, in `PARTS` (`rules.ts`) und in dieser Datei sowie in `SKILL.md`
ergänzen. Nach Änderungen am Kern `pnpm theme:skill` ausführen; `pnpm test` prüft, dass `gen/` aktuell ist und
dass die Beispiele über `validate.mjs` → Code → Import-Parser dasselbe Theme ergeben.

Mock: `localStorage["vl.mock.theme2"] = "ironman"` oder `"calm"` (mit `VITE_MOCK=1`). Screenshots:
`node scripts/visual/capture.mjs <ordner> --variants ironman-v1,ironman-v2,calm-v2 --only "page-home|dialog-theme-import"`.
