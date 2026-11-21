# Hilfe, Anleitungen und Touren

Der Launcher hat einen Bereich „Hilfe & Anleitungen“ (Fragezeichen oben rechts, Einstellungen → Über) mit
Schritt-für-Schritt-Anleitungen und geführten Touren. Kleine „?“-Links an schwierigen Stellen öffnen die passende
Anleitung direkt.

Code: `src/features/help/`

| Datei | Inhalt |
| --- | --- |
| `content/catalog.ts` | Welche Anleitungen und Touren es gibt, Icons, Ziel-Elemente, Routen (sprachneutral) |
| `content/de.ts`, `content/en.ts` | Alle Texte der Anleitungen und Touren |
| `types.ts` | IDs (`GuideId`, `TourId`), Aktionen (`TourAction`) und Datenformate |
| `tour/` | Tour-System: Speicher, Ziel-Suche, Positionierung, Overlay mit Spotlight, Bubble |
| `HelpCenter.tsx`, `GuideView.tsx`, `ToursView.tsx` | Der Dialog „Hilfe & Anleitungen“ |
| `HelpButton.tsx` | Fragezeichen in der Kopfzeile und `HelpLink` für kontextuelle „?“-Links |
| `src/i18n/help.ts` | Texte der Oberfläche (Knöpfe, Status), nicht der Inhalte |

## Neue Anleitung hinzufügen

1. In `types.ts` die ID zu `GuideId` hinzufügen.
2. In `content/catalog.ts` einen Eintrag in `GUIDES` anlegen: `{ id, icon, tour? }`. Icons stehen in `icons.tsx`.
3. In `content/de.ts` und `content/en.ts` unter `guides` den Text eintragen:
   - `title`, `summary`
   - `steps`: kurze Sätze, je ein Schritt
   - optional `tips` und `keywords` (Suchbegriffe, auch Umgangssprache wie „ruckelt“)
   TypeScript meldet einen Fehler, wenn eine Sprache fehlt.

## Neue Tour hinzufügen

1. Ziel-Elemente markieren: `data-tour="name"` an das Element setzen, das hervorgehoben werden soll.
   - Niemals CSS-Klassen oder Strukturen als Ziel verwenden. Das Layout ändert sich (Design v2), das Attribut bleibt.
   - `Button`, `IconButton` und `SearchInput` reichen das Attribut durch. Bei Komponenten ohne Durchreichen (z. B.
     `Segmented`, `SettingsCard`) einen schlichten `<div data-tour="…">` darumlegen.
   - Das Element muss sichtbar sein und eine Größe haben. `display: contents` funktioniert nicht.
   - Derselbe Name darf an mehreren Stellen stehen (z. B. Knopf oben und im Leerzustand). Das erste sichtbare gewinnt.
2. In `types.ts` die ID zu `TourId` hinzufügen.
3. In `content/catalog.ts` in `TOURS` die Schritte anlegen:

   ```ts
   {
     id: "backups",
     guide: "backups",
     steps: [
       { targets: ["backups-create"], route: "/instances/{recent}?tab=backups" },
       { targets: ["backups-list"], optional: true },
       { targets: ["settings-backups"], open: "settings:game" },
     ],
   }
   ```

   - `targets`: Liste von `data-tour`-Namen. Das erste sichtbare Element wird genommen. So deckt ein Schritt Simple-
     und Experten-Modus ab.
   - `route`: Seite, die vorher geöffnet wird. `{recent}` wird durch die zuletzt gespielte Java-Instanz ersetzt.
   - `open`: öffnet vorher einen Dialog (`settings:<tab>`, `import:launcher`, `instance-settings:perf`). Neue Aktionen
     in `types.ts` (`TourAction`) und `tour/actions.ts` (`runAction`, `closeAction`) ergänzen. Was eine Tour öffnet,
     schließt sie beim nächsten Schritt bzw. am Ende wieder.
   - `optional: true`: fehlt das Ziel, wird der Schritt still übersprungen (z. B. Play-Link nur beim Hosten). Ohne
     `optional` zeigt die Tour den Text mittig mit dem Hinweis, dass das Element gerade nicht zu sehen ist.
4. In `content/de.ts` und `content/en.ts` unter `tours` den Titel und je Schritt `title` und `text` eintragen, in
   derselben Reihenfolge wie im Katalog. Mit `variants: { "<data-tour-name>": { title, text } }` bekommt ein Schritt
   eigenen Text, je nachdem, welches Ziel gefunden wurde.
5. Die Tour erscheint automatisch unter „Alle Touren“ und, wenn `guide` gesetzt ist, in der Anleitung als
   „Tour starten“.

## Verhalten

- Fortschritt (`seen`, `step`, `done`) steht in `localStorage` unter `vl.help.tours`. Abgebrochene Touren lassen sich
  fortsetzen.
- Automatisch startet nur die Einführung (`intro`) im Simple-Modus, und nur einmal: `autoStartTour` prüft `seen`,
  zusätzlich setzt `SimpleTour` die Einstellung `simple_tour_done`. Alle anderen Touren starten nur auf Klick.
- Tastatur: Pfeil rechts/links blättern, Esc beendet. Der Fokus liegt auf „Weiter“ und springt danach zurück.
- Reduzierte Bewegung (System oder Einstellung): keine Animation der Bubble, kein Gleiten des Spotlights, Scrollen
  ohne Animation.
- Liegt das Ziel in einem offenen Dialog, wird die Tour in diesen Dialog gerendert (sonst blockiert Radix Klicks und
  Fokus).
- Während der Tour sind Klicks auf die Seite gesperrt. Die Tour zeigt nur, sie bedient nichts.
- Für den Zugangsstatus der Vibe-Beta (Warteliste) ist das Ziel `data-tour="vibe-access"` vorgesehen. Solange es
  fehlt, zeigt die Tour „Vibe-Beta“ auf den ganzen Bereich „Vibe & Konto“.

## Kontextuelle „?“-Links

```tsx
import { HelpLink } from "@/features/help/HelpButton";

<SettingsCard title={t("settings.section.memory")} right={<HelpLink guide="performance" />}>
```

Sparsam einsetzen, nur an Stellen, an denen Nutzer oft hängen. Aktuell: Import (Bibliothek, Import-Dialog), Autofix
(Absturz-Hinweis), Hosting (Server → Verbindung), RAM (Einstellungen → Java & Speicher, Instanz-Einstellungen,
Leistungsstufe im Simple-Modus) und Backups (Instanz → Backups).

## Testen

Im Mock (`VITE_MOCK=1`) lässt sich jede Tour aus „Hilfe & Anleitungen → Alle Touren“ starten. Die Einführung startet
von selbst mit `localStorage` `vl.mock.mode = "simple"` und `vl.mock.tour = "1"`. Fortschritt zurücksetzen: Link unten
unter „Alle Touren“ oder `localStorage.removeItem("vl.help.tours")`.
