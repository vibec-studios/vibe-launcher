import { AlertTriangle, X } from "lucide-react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { IconButton, SearchInput } from "@/components/ui";
import { SelectBox } from "@/features/content/ContentRow";
import { useT } from "@/i18n";
import type { ExtSettingKey, ExternalInstance, ExternalLauncher } from "@/lib/types";
import { InstanceRow, SettingsBar } from "./rows";

interface Props {
  launchers: ExternalLauncher[];
  allInstances: ExternalInstance[];
  visible: ExternalInstance[];
  chosen: ExternalInstance[];
  matches: (i: ExternalInstance) => boolean;
  q: string;
  query: string;
  setQuery: (v: string) => void;
  selected: Record<string, boolean>;
  toggle: (key: string, on?: boolean) => void;
  toggleMany: (list: ExternalInstance[], on: boolean) => void;
  allVisibleSelected: boolean;
  someVisibleSelected: boolean;
  chooseFolder: ReactNode;
  tech: boolean;
  extra: ExternalLauncher[];
  setExtra: Dispatch<SetStateAction<ExternalLauncher[]>>;
  versions: Record<string, string>;
  setVersions: Dispatch<SetStateAction<Record<string, string>>>;
  keys: ExtSettingKey[];
  offered: ExtSettingKey[];
  toggleKey: (k: ExtSettingKey) => void;
}

export function LauncherList(p: Props) {
  const tr = useT();
  const { launchers, allInstances, visible, chosen, matches, q, query, setQuery, selected, toggle, toggleMany, allVisibleSelected, someVisibleSelected, chooseFolder, tech, extra, setExtra, versions, setVersions, keys, offered, toggleKey } = p;
  return (
      <div className="flex min-h-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2.5 rounded-ctl text-[14px] font-medium text-text">
            <SelectBox state={allVisibleSelected ? "on" : someVisibleSelected ? "mixed" : "off"} onClick={() => toggleMany(visible, !allVisibleSelected)} label={tr("ext.select_all")} />
            {tr("ext.select_all")}
          </label>
          <span className="text-[14px] text-muted" aria-live="polite">{tr("ext.selected", { n: chosen.length, total: allInstances.length })}</span>
          <div className="flex-1" />
          {allInstances.length > 6 && <SearchInput value={query} onChange={setQuery} placeholder={tr("ext.search")} className="w-[220px]" />}
          {chooseFolder}
        </div>
        <div className="flex flex-col gap-4">
          {launchers.map((l) => {
            const list = l.instances.filter(matches);
            if (q && list.length === 0) return null;
            const groupOn = list.length > 0 && list.every((i) => selected[i.source_path]);
            const groupSome = list.some((i) => selected[i.source_path]);
            return (
              <section key={`${l.id}|${l.path}`} className="flex flex-col gap-1 rounded-card border border-line bg-surface p-3">
                <div className="flex items-center gap-2.5 px-2 pb-1.5">
                  <SelectBox state={groupOn ? "on" : groupSome ? "mixed" : "off"} onClick={() => toggleMany(list, !groupOn)} label={l.name} />
                  <span className="min-w-0 break-words text-[16px] font-semibold text-text">{l.name}</span>
                  <span className="text-meta tabular-nums text-dim">{l.instances.length}</span>
                  {/* Ordnerpfad nur im Experten-Modus (Simple: Tooltip reicht) */}
                  <span className="selectable min-w-0 flex-1 truncate text-right text-caption text-dim" title={l.path}>
                    {tech ? l.path : ""}
                  </span>
                  {extra.some((x) => x.path === l.path) && (
                    <IconButton
                      label={tr("ext.remove_dir")}
                      tip
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6"
                      onClick={() => setExtra((e) => e.filter((x) => x.path !== l.path))}
                    >
                      <X size={14} />
                    </IconButton>
                  )}
                </div>
                {l.id === "norisk" && (
                  <div className="flex items-start gap-1.5 px-2 pb-1.5 text-[12px] text-dim">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                    {tr("ext.norisk_hint")}
                  </div>
                )}
                {list.length === 0 ? (
                  <div className="px-2 py-3 text-meta text-dim">{tr("ext.empty_group")}</div>
                ) : (
                  list.map((i) => (
                    <InstanceRow
                      key={i.source_path}
                      inst={i}
                      selected={!!selected[i.source_path]}
                      onToggle={() => toggle(i.source_path)}
                      version={versions[i.source_path] ?? ""}
                      onVersion={(v) => setVersions((s) => ({ ...s, [i.source_path]: v }))}
                      keys={keys}
                    />
                  ))
                )}
              </section>
            );
          })}
          {q && visible.length === 0 && <div className="py-8 text-center text-[13px] text-dim">{tr("ext.no_match")}</div>}
        </div>
        {offered.length > 0 && (
          <details className="rounded-card border border-line bg-surface">
            <summary className="cursor-pointer px-4 py-3 text-[14px] font-medium text-text">{tr("ext.set.title")}</summary>
            <SettingsBar offered={offered} keys={keys} onToggle={toggleKey} />
          </details>
        )}
      </div>
  );
}
