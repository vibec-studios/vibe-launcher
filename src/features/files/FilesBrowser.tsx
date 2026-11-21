// Datei-Bereich einer Instanz bzw. eines lokalen Servers: oben die „Häufig“-Leiste, links Dateibaum (oder
// Namens-/Volltextsuche), rechts Editor/Vorschau. Dateiaktionen über Kontextmenü, Werkzeugleiste und Tastenkürzel;
// Dateien lassen sich aus dem Explorer hineinziehen. Ungespeicherte Änderungen werden vor jedem Wechsel abgefragt.
import { useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import type { FileScope } from "@/lib/types";
import { ContextMenu, EmptyState, ErrorState } from "@/components/ui";
import { useT } from "@/i18n";
import { FilePane } from "./FilePane";
import { FileTree, RootMenu, type FileTreeHandle } from "./FileTree";
import { dirName, fkeys } from "./util";
import { NameDialogView } from "./components/NameDialog";
import { FindResults, ListSkeleton, SearchResults } from "./components/SearchLists";
import { TreeToolbar } from "./components/TreeToolbar";
import { useFileActions } from "./hooks/useFileActions";
import { useFileDrop } from "./hooks/useFileDrop";
import { useFileSearch } from "./hooks/useFileSearch";
import { useFileShortcuts } from "./hooks/useFileShortcuts";
import { useFileTree } from "./hooks/useFileTree";
import { useOpenFile } from "./hooks/useOpenFile";

export interface FilesBrowserProps {
  scope: FileScope;
  /** Spiel bzw. Server läuft gerade -> Warnung im Editor */
  running: boolean;
  runningText: string;
  /** Beim ersten Öffnen aufgeklappte Ordner */
  initialExpanded?: string[];
}

export function FilesBrowser({ scope, running, runningText, initialExpanded = [] }: FilesBrowserProps) {
  const t = useT();
  const qc = useQueryClient();
  const tree = useRef<FileTreeHandle>(null);
  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: fkeys.all(scope) }), [qc, scope]);

  const { setExpanded, selected, setSelected, dirs, rootQ, rows, entryByPath, selEntry, anyFetching, toggle, expandTo, revealInTree } = useFileTree(scope, initialExpanded, t, tree);
  const search = useFileSearch();
  const f = useOpenFile({ scope, t, refresh, expandTo, setSelected, tree });
  const { openPath, file, loadError, loading, dirty, setDirty, errors, checking, saving, editorKey, initialLine, autoFocus, editor, load, openFile, save, discard, reloadFile, restore, onContent } = f;
  const { nameDialog, setNameDialog, importPaths, actions, submitName } = useFileActions({ scope, t, refresh, expandTo, revealInTree, setSelected, setExpanded, f });
  const treeKey = useFileShortcuts(save, f.dirtyRef, actions);
  const { rootEl, dragPos, dropDir } = useFileDrop(importPaths);

  const rootEntries = dirs.get("");
  const rootCount = rootEntries?.length ?? 0;
  const openEntry = openPath ? (entryByPath.get(openPath) ?? null) : null;

  return (
    <div ref={rootEl} className="relative flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1">
        {/* ------------------------------------------------------------ Baum */}
        <aside className="flex w-[340px] shrink-0 flex-col border-r border-line max-[1100px]:w-[290px]">
          <TreeToolbar
            searchBox={search.searchBox}
            mode={search.mode}
            setMode={search.setMode}
            filter={search.filter}
            setFilter={search.setFilter}
            query={search.query}
            setQuery={search.setQuery}
            actions={actions}
            selEntry={selEntry}
            collapseAll={() => setExpanded(new Set())}
            refresh={() => void refresh()}
            anyFetching={anyFetching}
          />
          <div className="min-h-0 flex-1">
            {search.mode === "content" ? (
              <div className="scroll h-full">
                <SearchResults scope={scope} query={search.dQuery} onOpen={(p, l) => void openFile(p, l)} />
              </div>
            ) : search.showFind ? (
              <div className="scroll h-full">
                <FindResults scope={scope} query={search.dFilter} selected={selected} onPick={(e) => (e.is_dir ? (search.setFilter(""), revealInTree(e.path, true)) : void openFile(e.path))} />
              </div>
            ) : rootQ.isError && !rootQ.data ? (
              <ErrorState error={rootQ.error} onRetry={() => rootQ.refetch()} />
            ) : !rootQ.data ? (
              <ListSkeleton n={10} />
            ) : (
              <ContextMenu content={<RootMenu actions={actions} />}>
                <div className="h-full" data-drop-dir="">
                  {!rootCount ? (
                    <EmptyState icon="folder" title={t("files.empty.title")} text={t("files.empty.text")} className="py-10" />
                  ) : (
                    <FileTree
                      ref={tree}
                      rows={rows}
                      selected={selected}
                      openPath={openPath}
                      dirty={dirty}
                      dropDir={dropDir}
                      actions={actions}
                      onSelect={setSelected}
                      onToggle={toggle}
                      onKey={treeKey}
                    />
                  )}
                </div>
              </ContextMenu>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-1.5 text-[11px] text-dim">
            <span>{rootCount === 1 ? t("files.entries_one") : t("files.entries", { n: rootCount })}</span>
            <span className="flex-1" />
            <span className="truncate">{t("files.drop_hint")}</span>
          </div>
        </aside>

        {/* ------------------------------------------------------------ Editor */}
        <section className="flex min-w-0 flex-1 flex-col" data-drop-dir={openPath ? dirName(openPath) : ""}>
          <FilePane
            scope={scope}
            path={openPath}
            file={file}
            entry={openEntry}
            loading={loading}
            loadError={loadError}
            onRetry={() => openPath && void load(openPath, null)}
            dirty={dirty}
            errors={errors}
            checking={checking}
            saving={saving}
            editorKey={editorKey}
            initialLine={initialLine}
            autoFocus={autoFocus}
            editorRef={editor}
            onDirty={setDirty}
            onContent={onContent}
            onJump={(e) => editor.current?.gotoLine(e.line, e.column)}
            onSave={() => void save()}
            onDiscard={discard}
            onRestore={() => void restore()}
            onReloadFile={() => void reloadFile()}
            running={running}
            runningText={runningText}
            actions={actions}
            empty={<EmptyState icon="file" title={t("files.pick.title")} text={t("files.pick.text")} className="flex-1" />}
          />
        </section>
      </div>

      {dragPos && (
        <div className="pointer-events-none absolute inset-0 z-10 border-2 border-dashed border-accent/70 bg-black/20">
          <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-card bg-overlay px-4 py-2 text-[13px] font-semibold text-text shadow-e2">
            <Upload size={15} className="text-accent" />
            {t("files.drop_into", { name: dropDir ? `${dropDir}/` : t("files.root") })}
          </div>
        </div>
      )}
      <NameDialogView state={nameDialog} onClose={() => setNameDialog(null)} onSubmit={submitName} />
    </div>
  );
}
