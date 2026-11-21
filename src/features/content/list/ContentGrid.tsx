import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef, type Dispatch, type SetStateAction } from "react";
import { Button, EmptyState, cn } from "@/components/ui";
import { useT } from "@/i18n";
import type { ContentItem, ContentUpdate } from "@/lib/types";
import { ContentRow, GRID, ROW_H, RowSkeleton, SelectBox, type RowActions } from "../ContentRow";
import { resetOrgFilter } from "../organize/filter";
import { keyOf } from "./keys";
import { ColumnHead } from "./parts";
import type { ContentFilters } from "./useContentFilters";

interface Props {
  id: string;
  f: ContentFilters;
  pending: boolean;
  selection: Set<string>;
  setSelection: Dispatch<SetStateAction<Set<string>>>;
  updates: Map<string, ContentUpdate>;
  manualProjects: Set<string>;
  actions: RowActions;
}

export function ContentGrid({ id, f, pending, selection, setSelection, updates, manualProjects, actions }: Props) {
  const t = useT();
  const { visible, sort, desc, sortBy } = f;
  const allVisibleSelected = visible.length > 0 && visible.every((c) => selection.has(keyOf(c)));
  const headState: "on" | "off" | "mixed" = selection.size === 0 ? "off" : allVisibleSelected ? "on" : "mixed";
  return (
    <>
      {/* Spaltenköpfe (Simple: keine) */}
      <div role="rowgroup" className={cn(GRID, "h-11 shrink-0 overflow-y-hidden bg-surface text-[12.5px] font-semibold text-muted [scrollbar-gutter:stable]")}>
        <SelectBox
          state={headState}
          label={t("common.select_all")}
          onClick={() => setSelection(headState === "off" ? new Set(visible.map(keyOf)) : new Set())}
        />
        <ColumnHead active={sort === "name"} desc={desc} onClick={() => sortBy("name")}>
          {t("content.col.name")}
        </ColumnHead>
        <ColumnHead active={sort === "version"} desc={desc} onClick={() => sortBy("version")}>
          {t("content.col.version")}
        </ColumnHead>
        <span className="text-right">{t("ipage.ct.col.actions")}</span>
      </div>

      {pending ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          {Array.from({ length: 10 }, (_, i) => (
            <RowSkeleton key={i} />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          className="border-t border-line"
          icon="search_none"
          title={t("content.no_match")}
          text={t("content.no_match_text")}
          action={
            <Button
              size="sm"
              onClick={() => {
                f.setText("");
                f.setStatus("all");
                f.setSideFilter("all");
                f.setType("all");
                resetOrgFilter(id);
              }}
            >
              {t("ipage.filter.reset")}
            </Button>
          }
        />
      ) : (
        <VirtualRows f={f} selection={selection} updates={updates} manualProjects={manualProjects} actions={actions} />
      )}
    </>
  );
}

function VirtualRows({ f, selection, updates, manualProjects, actions }: Pick<Props, "f" | "selection" | "updates" | "manualProjects" | "actions">) {
  const { visible, type, org, orgQ } = f;
  const scrollRef = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 10,
  });
  return (
    <div ref={scrollRef} className="scroll min-h-0 flex-1" role="grid" aria-multiselectable>
      <div className="relative" style={{ height: v.getTotalSize() }}>
        {v.getVirtualItems().map((it) => {
          const item: ContentItem = visible[it.index];
          const key = keyOf(item);
          return (
            <div key={key} className="absolute inset-x-0" style={{ top: it.start, height: ROW_H }}>
              <ContentRow
                item={item}
                itemKey={key}
                selected={selection.has(key)}
                update={updates.get(key)}
                manual={item.source === "curseforge" && !!item.project_id && (manualProjects.has(item.project_id) || !!updates.get(key)?.manual)}
                actions={actions}
                showKind={type === "all"}
                org={org.items.get(key)}
                group={org.groups.get(org.items.get(key)?.group ?? "")}
                hasPack={orgQ.data?.has_pack}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
