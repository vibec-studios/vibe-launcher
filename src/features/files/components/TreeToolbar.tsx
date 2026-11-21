import { ChevronsDownUp, FilePlus, FolderInput, FolderPlus, RefreshCw, Upload } from "lucide-react";
import type { RefObject } from "react";
import type { FileEntry } from "@/lib/types";
import { DropdownItem, DropdownMenu, IconButton, SearchInput, Segmented, Tooltip, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { targetDir, type FileActions } from "../FileTree";

interface Props {
  searchBox: RefObject<HTMLDivElement | null>;
  mode: "name" | "content";
  setMode: (m: "name" | "content") => void;
  filter: string;
  setFilter: (v: string) => void;
  query: string;
  setQuery: (v: string) => void;
  actions: FileActions;
  selEntry: FileEntry | null;
  collapseAll: () => void;
  refresh: () => void;
  anyFetching: boolean;
}

export function TreeToolbar({ searchBox, mode, setMode, filter, setFilter, query, setQuery, actions, selEntry, collapseAll, refresh, anyFetching }: Props) {
  const t = useT();
  return (
    <div ref={searchBox} className="flex shrink-0 flex-col gap-2 border-b border-line p-3">
      <div className="flex items-center gap-1">
        <Segmented
          value={mode}
          onChange={setMode}
          items={[
            { value: "name", label: t("files.mode.name") },
            { value: "content", label: t("files.mode.content") },
          ]}
        />
        <div className="flex-1" />
        <Tooltip content={t("files.act.new_file")}>
          <IconButton label={t("files.act.new_file")} size="sm" variant="ghost" onClick={() => actions.newItem("file", targetDir(selEntry))}>
            <FilePlus size={14} />
          </IconButton>
        </Tooltip>
        <Tooltip content={t("files.act.new_folder")}>
          <IconButton label={t("files.act.new_folder")} size="sm" variant="ghost" onClick={() => actions.newItem("folder", targetDir(selEntry))}>
            <FolderPlus size={14} />
          </IconButton>
        </Tooltip>
        <DropdownMenu
          trigger={
            <IconButton label={t("files.act.import")} tip size="sm" variant="ghost" className="data-[state=open]:bg-white/[.07]">
              <FolderInput size={14} />
            </IconButton>
          }
        >
          <DropdownItem icon={<Upload size={14} />} onSelect={() => actions.importInto(targetDir(selEntry), false)}>
            {t("files.act.import_files")}
          </DropdownItem>
          <DropdownItem icon={<FolderInput size={14} />} onSelect={() => actions.importInto(targetDir(selEntry), true)}>
            {t("files.act.import_folder")}
          </DropdownItem>
        </DropdownMenu>
        <Tooltip content={t("files.collapse_all")}>
          <IconButton label={t("files.collapse_all")} size="sm" variant="ghost" onClick={collapseAll}>
            <ChevronsDownUp size={14} />
          </IconButton>
        </Tooltip>
        <Tooltip content={t("files.reload")}>
          <IconButton label={t("files.reload")} size="sm" variant="ghost" onClick={() => void refresh()}>
            <RefreshCw size={14} className={cn(anyFetching && "animate-spin")} />
          </IconButton>
        </Tooltip>
      </div>
      {mode === "name" ? (
        <SearchInput value={filter} onChange={setFilter} placeholder={t("files.filter")} className="[&_input]:h-8 [&_input]:text-[13px]" />
      ) : (
        <SearchInput value={query} onChange={setQuery} placeholder={t("files.search")} className="[&_input]:h-8 [&_input]:text-[13px]" />
      )}
    </div>
  );
}
