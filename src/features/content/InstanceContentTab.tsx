// OWNER: Frontend-Agent B. Inhalte einer Instanz – aufgebaut wie die Modrinth App:
//   1. Suche über alles + „Dateien hinzufügen“ + Hauptknopf „Inhalte hinzufügen“
//   2. Sortierung, Filter-Chips (Alle / Mods / Resourcepacks / Shader · Updates / Aktiv / Deaktiviert), Seite (Mods),
//      rechts „Alle aktualisieren“, „Neu prüfen“ (F5), Mod-Sets und das Werkzeuge-Menü (Performance-Mods, Ordner)
//   3. Tabelle mit Spaltenköpfen (Auswahl, Name, Version, Aktionen) – Klick auf Name/Version sortiert –, virtualisiert
//      für 300+ Einträge. Mehrfachauswahl mit schwebender Sammelaktionsleiste, Kontextmenü, optimistisches Aktivieren,
//      Drag & Drop (.jar -> Mods, .zip -> Resourcepacks bzw. Shader im Shader-Filter).
// Hinweise (Modpack-Update, Abhängigkeiten, manuelle Downloads) zeigt die Hinweiszeile der Instanzseite.
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { EmptyState, ErrorState, cn } from "@/components/ui";
import { useT } from "@/i18n";
import type { ContentKind, Instance, QuickMod } from "@/lib/types";
import { useSimple } from "@/lib/mode";
import { PerfDialog } from "./PerfDialog";
import { QuickModDialog } from "./QuickModDialog";
import { OrgDialogsHost } from "./organize/OrgDialogsHost";
import { UnusedNotice } from "./organize/UnusedNotice";
import { ContentSearchRow } from "./list/AddFiles";
import { ContentGrid } from "./list/ContentGrid";
import { EmptyActions } from "./list/EmptyActions";
import { FilterRow } from "./list/FilterRow";
import { DropOverlay, SelectionBar } from "./list/SelectionBar";
import { ToolsGroup } from "./list/ToolsGroup";
import { discoverType, keyOf, type TypeFilter } from "./list/keys";
import { useContentActions } from "./list/useContentActions";
import { useContentData } from "./list/useContentData";
import { useContentDrop } from "./list/useContentDrop";
import { useContentFilters } from "./list/useContentFilters";
import { useContentSelection } from "./list/useContentSelection";
import { useRowActions } from "./list/useRowActions";

export type { TypeFilter };

export function InstanceContentTab({ instance, initialType = "all" }: { instance: Instance; initialType?: TypeFilter }) {
  const t = useT();
  const navigate = useNavigate();
  const id = instance.id;
  const vanilla = instance.loader.kind === "vanilla";
  // Simple-Modus: einfache Liste (an/aus, entfernen, aktualisieren), Updates werden automatisch gesucht
  const simple = useSimple();
  const kinds = useMemo<ContentKind[]>(() => (vanilla ? ["resourcepack", "shader"] : ["mod", "resourcepack", "shader"]), [vanilla]);

  const { lists, pending, failed, all, updTask, updates, manualProjects, known } = useContentData(id, kinds, simple);
  const f = useContentFilters({ id, all, kinds, initialType, updates, known });
  const { type, counts, visible } = f;
  const [perfOpen, setPerfOpen] = useState(false);
  const [quickMod, setQuickMod] = useState<QuickMod | null>(null);

  const { selection, setSelection, anchor, state, byKeys } = useContentSelection(all, visible, updates);
  const ops = useContentActions(id, state, setSelection);
  const { setEnabled, remove, update, openFolder } = ops;
  const actions = useRowActions({ id, state, anchor, setSelection, byKeys, ops });

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "a") {
      e.preventDefault();
      setSelection(new Set(visible.map(keyOf)));
    } else if (e.key === "Escape" && selection.size) {
      setSelection(new Set());
    } else if (e.key === "Delete" && selection.size) {
      e.preventDefault();
      void remove(byKeys(selection));
    }
  };

  const { zipKind, dropKinds, dropRef, over } = useContentDrop(id, type, vanilla);

  const selItems = selection.size ? byKeys(selection) : [];
  const selUpdates = selItems.filter((c) => updates.has(keyOf(c)));
  const updatesRunning = updTask?.status === "running";
  const empty = !pending && all.length === 0;
  const addKind: ContentKind = type === "all" ? (vanilla ? "resourcepack" : "mod") : type;
  const toDiscover = () => navigate({ to: "/discover", search: { instance: id, type: discoverType[addKind] as never } });
  const total = type === "all" ? counts.all : (counts.kind[type] ?? 0);
  const openPerf = () => setPerfOpen(true);

  return (
    <div className="@container flex h-full min-h-0 flex-col gap-3 px-6 pb-4 pt-4 outline-none" tabIndex={-1} onKeyDown={onKeyDown}>
      {/* 1. Suche + Hinzufügen (leer: alles steht im Leerzustand, keine „0 Inhalte durchsuchen“-Suche) */}
      {!empty && <ContentSearchRow id={id} kinds={kinds} text={f.text} setText={f.setText} total={total} toDiscover={toDiscover} />}

      {/* 2. Sortierung, Filter-Chips, Aktionen */}
      {!empty && (
        <FilterRow id={id} kinds={kinds} known={known} total={all.length} f={f}>
          <ToolsGroup
            id={id}
            kinds={kinds}
            vanilla={vanilla}
            simple={simple}
            all={all}
            selItems={selItems}
            updatesAll={counts.updatesAll}
            updTask={updTask}
            updateAll={() => update(all.filter((c) => updates.has(keyOf(c))))}
            setEnabled={(l, v) => void setEnabled(l, v)}
            openFolder={openFolder}
            openPerf={openPerf}
            openQuickMod={setQuickMod}
          />
        </FilterRow>
      )}
      {perfOpen && <PerfDialog instance={instance} onClose={() => setPerfOpen(false)} />}
      <OrgDialogsHost instanceId={id} items={all} />
      {!empty && <UnusedNotice data={f.orgQ.data} />}
      {quickMod && <QuickModDialog instance={instance} tool={quickMod} onClose={() => setQuickMod(null)} />}

      {/* 3. Tabelle */}
      {/* Außen: Ablagefläche über die ganze Höhe; innen: Tabelle nur so hoch wie ihre Zeilen (keine leere Riesenbox
          unter drei Shadern). Leer: gestrichelter Rahmen = „hier ablegen“. */}
      <div ref={dropRef} className="relative flex min-h-0 flex-1 flex-col">
        <div
          data-tour="content-list"
          className={cn(
            "flex min-h-0 flex-col overflow-hidden rounded-card border bg-panel",
            empty ? "flex-1 border-dashed border-line2" : failed || pending || visible.length === 0 ? "flex-1 border-line" : "flex-initial border-line",
          )}
        >
          {failed ? (
            <ErrorState error={failed.error} onRetry={() => lists.forEach((l) => l.refetch())} />
          ) : empty ? (
            <EmptyState
              icon="box"
              title={t("ipage.ct.empty")}
              text={t(vanilla ? "ipage.ct.empty.resourcepack" : "ipage.ct.empty.mod")}
              action={
                <EmptyActions id={id} kinds={kinds} vanilla={vanilla} addKind={addKind} toDiscover={toDiscover} openFolder={openFolder} openPerf={openPerf} openQuickMod={setQuickMod} />
              }
            />
          ) : (
            <ContentGrid id={id} f={f} pending={pending} selection={selection} setSelection={setSelection} updates={updates} manualProjects={manualProjects} actions={actions} />
          )}
        </div>

        {/* Sammelaktionen: schwebende Leiste bei Auswahl */}
        {selection.size > 0 && (
          <SelectionBar
            id={id}
            count={selection.size}
            selItems={selItems}
            selUpdates={selUpdates}
            updatesRunning={updatesRunning}
            setEnabled={setEnabled}
            update={update}
            remove={remove}
            clear={() => setSelection(new Set())}
          />
        )}

        {over && <DropOverlay dropKinds={dropKinds} zipKind={zipKind} name={instance.name} />}
      </div>
    </div>
  );
}
