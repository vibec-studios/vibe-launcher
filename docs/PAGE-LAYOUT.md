# Seiten-Layout und Werkzeugleisten

Gemeinsame Bausteine in `src/components/ui/PageLayout.tsx` und `src/components/ui/Choice.tsx`. Ziel: Jede Seite beginnt an derselben Stelle, alle Knöpfe einer Leiste sind gleich hoch, und kein einzelner Knopf rutscht eine Zeile tiefer.

## Regeln

- **Seitenrand:** 24 px seitlich, 16 px oben, 16 px zwischen Blöcken, 40 px unten (`Page`). Seiten mit eigenen Scrollbereichen nutzen `px-6 pt-4` für die Leiste und `pb-4` darunter.
- **Höhe in Werkzeugleisten:** 36 px für alles: `Button`/`IconButton`/`Select`/`SearchInput` in Standardgröße, `Segmented size="md"`. Kein `size="sm"` in Seiten-Werkzeugleisten.
- **Aufteilung:** links Filter und Suche (`children`), rechts Aktionen (`actions`), Hauptaktion ganz rechts (`variant="primary"`).
- **Umbruch:** Wird es eng, umbrechen nur die linken Elemente innerhalb ihrer Spalte. Die Aktionen bleiben zusammen oben rechts.
- **Kompakt:** Ist die Leiste schmaler als `compactBelow` (Standard 1100 px), zeigen `ToolbarButton`s nur ihr Symbol und den Namen als Tooltip. Die Hauptaktion bleibt ein normaler `Button` mit Text.
- **Leere Zustände:** `EmptyState` immer mit einer nächsten Aktion (anlegen, importieren, Suche zurücksetzen, Anleitung öffnen).

## Bausteine

| Baustein | Zweck |
| --- | --- |
| `Page` | Scrollende Seite mit Standardrand. `width="narrow"` (920 px, linksbündig) oder `"wide"` (bis 2200 px, zentriert). |
| `PageToolbar` | Werkzeugleiste: `children` links, `actions` rechts, `compactBelow` für den Kompaktmodus. |
| `ToolbarButton` | Neben-Aktion in der Leiste (`label` ist Pflicht und dient als Tooltip/aria-label im Kompaktmodus). |
| `ToolbarMeta` | Ruhige Zahl oder Einordnung, z. B. „18 Screenshots“. |
| `Segmented size="md"` | 36 px hoher Umschalter. Optional `title` je Eintrag für Symbol-Einträge. |
| `ChoiceCard` / `ChoiceGrid` | Große Auswahlkarte mit Symbol, Titel und einem Satz Erklärung (für Assistenten). `selected` markiert die Wahl, `arrow` zeigt einen Pfeil für „weiter“. |
| `Steps` | Schrittanzeige für Assistenten (`steps`, `current`). |
| `Dialog size="full"` | Großer Assistent: bis 1240 px breit, fast volle Fensterhöhe. |

## Beispiel

```tsx
<Page>
  <PageToolbar
    actions={
      <>
        <ToolbarButton variant="subtle" icon={<PackageOpen size={15} />} label={t("home.action.import")} onClick={openImport} />
        <Button variant="primary" icon={<Plus size={16} />} onClick={openNew}>
          {t("inst.new")}
        </Button>
      </>
    }
  >
    <SearchInput value={q} onChange={setQ} className="min-w-[160px] max-w-[320px] flex-1 basis-[240px]" />
  </PageToolbar>
  …
</Page>
```

## Bibliothek

Sortierung, Gruppierung und Ansicht (Kacheln/Liste) liegen in einem Menü „Sortierung und Ansicht“ (`src/features/instances/LibraryToolbar.tsx`). So passt die Leiste bei 1280 px in DE und EN in eine Zeile.
