import { ArrowUpDown, ChevronDown, Layers, LayoutGrid, List, PackageOpen, Plus } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { Button, DropdownCheckItem, DropdownLabel, DropdownMenu, DropdownSeparator, PageToolbar, SearchInput, Segmented, ToolbarButton } from "@/components/ui";
import { openNewInstance } from "@/components/instance/actions";
import { openImport } from "@/features/import/importStore";
import { HelpLink } from "@/features/help/HelpButton";
import { useT } from "@/i18n";

export type SortKey = "recent" | "name" | "created" | "playtime";
export const SORTS: SortKey[] = ["recent", "name", "created", "playtime"];
export type GroupKey = "group" | "loader" | "version" | "none";
export const GROUPS: GroupKey[] = ["group", "loader", "version", "none"];
export type FilterKey = "all" | "custom" | "modpacks";
export const FILTERS: FilterKey[] = ["all", "custom", "modpacks"];
export type ViewKey = "grid" | "list";
const VIEWS: ViewKey[] = ["grid", "list"];

export interface LibraryToolbarProps {
  filter: FilterKey;
  setFilter: (f: FilterKey) => void;
  counts: Record<FilterKey, number>;
  query: string;
  setQuery: (q: string) => void;
  sort: SortKey;
  setSort: (s: SortKey) => void;
  groupBy: GroupKey;
  setGroupBy: (g: GroupKey) => void;
  view: ViewKey;
  setView: (v: ViewKey) => void;
}

export function LibraryToolbar(p: LibraryToolbarProps) {
  const t = useT();
  const nav = useNavigate();
  return (
    <PageToolbar
      actions={
        <>
          <ToolbarButton variant="subtle" icon={<Layers size={15} />} label={t("nav.modsets")} onClick={() => nav({ to: "/modsets", search: {} })} />
          <ToolbarButton variant="subtle" data-tour="instances-import" icon={<PackageOpen size={15} />} label={t("home.action.import")} onClick={() => openImport()} />
          <HelpLink guide="import" className="h-9 w-9 rounded-ctl" />
          <Button variant="primary" data-tour="instances-new" icon={<Plus size={16} />} onClick={openNewInstance}>
            {t("inst.new")}
          </Button>
        </>
      }
    >
      <Segmented<FilterKey>
        size="md"
        value={p.filter}
        onChange={p.setFilter}
        items={FILTERS.map((f) => ({
          value: f,
          label: (
            <>
              {t(`instances.filter.${f}`)}
              <span className="text-[12px] font-medium tabular-nums text-dim">{p.counts[f]}</span>
            </>
          ),
        }))}
      />
      <SearchInput value={p.query} onChange={p.setQuery} placeholder={t("instances.search")} className="min-w-[200px] max-w-[320px] flex-1 basis-[200px]" />
      <DropdownMenu
        align="start"
        trigger={
          <ToolbarButton variant="subtle" icon={<ArrowUpDown size={15} />} label={`${t("layout.sort_view")}: ${t(`instances.sort.${p.sort}`)}`} className="data-[state=open]:bg-white/[.07]">
            {t(`instances.sort.${p.sort}`)}
            <ChevronDown size={14} className="-mr-1 text-dim" />
          </ToolbarButton>
        }
      >
        <DropdownLabel>{t("instances.sort")}</DropdownLabel>
        {SORTS.map((s) => (
          <DropdownCheckItem key={s} checked={p.sort === s} onCheckedChange={() => p.setSort(s)}>
            {t(`instances.sort.${s}`)}
          </DropdownCheckItem>
        ))}
        <DropdownSeparator />
        <DropdownLabel>{t("instances.groupby")}</DropdownLabel>
        {GROUPS.map((g) => (
          <DropdownCheckItem key={g} checked={p.groupBy === g} onCheckedChange={() => p.setGroupBy(g)}>
            {t(`instances.groupby.${g}`)}
          </DropdownCheckItem>
        ))}
        <DropdownSeparator />
        <DropdownLabel>{t("instances.view")}</DropdownLabel>
        {VIEWS.map((v) => (
          <DropdownCheckItem key={v} checked={p.view === v} onCheckedChange={() => p.setView(v)}>
            <span className="inline-flex items-center gap-2">
              {v === "grid" ? <LayoutGrid size={14} className="text-dim" /> : <List size={14} className="text-dim" />}
              {t(`instances.view.${v}`)}
            </span>
          </DropdownCheckItem>
        ))}
      </DropdownMenu>
    </PageToolbar>
  );
}
