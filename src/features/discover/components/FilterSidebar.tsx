import { useQuery } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { useMemo } from "react";
import { IconButton, Select, Skeleton } from "@/components/ui";
import { compareMc } from "@/components/content/util";
import { LoaderIcon } from "@/components/instance/LoaderIcon";
import { useT } from "@/i18n";
import { api } from "@/lib/api";
import { formatLoader } from "@/lib/format";
import { useSimple } from "@/lib/mode";
import { qk, useGameVersions, useSettings } from "@/lib/queries";
import type { ProjectType, Source } from "@/lib/types";
import { CategoryIcon, catIconKey, catLabel } from "../categoryIcons";
import { ALL, FALLBACK_VERSIONS, LOADERS } from "../constants";
import { useDiscoverFilters } from "../store";
import { TargetPicker } from "../TargetPicker";
import { CheckRow, FilterGroup } from "./FilterGroup";

export function FilterSidebar({ type, source, sourcePicker }: { type: ProjectType; source: Source; sourcePicker: React.ReactNode }) {
  const t = useT();
  const simple = useSimple();
  const f = useDiscoverFilters();
  const gv = useGameVersions();
  const settings = useSettings();
  const versions = useMemo(() => {
    const list = gv.data?.length
      ? gv.data.filter((v) => v.kind === "release" || (settings.data?.show_snapshots && v.kind === "snapshot")).map((v) => v.id)
      : FALLBACK_VERSIONS;
    const all = f.version && !list.includes(f.version) ? [f.version, ...list] : list;
    return [...new Set(all)].sort((a, b) => (/^\d/.test(a) && /^\d/.test(b) ? compareMc(b, a) : 0));
  }, [gv.data, settings.data?.show_snapshots, f.version]);

  const cats = useQuery({
    queryKey: qk.categories(source, type),
    queryFn: () => api.contentCategories(source, type),
    staleTime: 60 * 60_000,
    placeholderData: undefined,
  });

  const active = !!(f.version || f.loader || f.categories.length || f.sort !== "relevance" || f.trending);
  const loaderApplies = type === "mod" || type === "modpack";

  return (
    <aside className="scroll flex w-[220px] shrink-0 flex-col px-3 pb-6 pt-4">
      <div className="mb-1 flex h-9 shrink-0 items-center gap-2 pl-2">
        <span className="flex-1 text-section text-text">{t("discover.filters")}</span>
        {active && (
          <IconButton label={t("discover.reset")} tip variant="ghost" size="sm" onClick={() => f.reset()}>
            <RotateCcw size={14} />
          </IconButton>
        )}
      </div>
      <>
      {!simple && (
        <FilterGroup id="target" title={t("st.target.title")}>
          <TargetPicker />
        </FilterGroup>
      )}
      <FilterGroup id="source" title={t("discover.source")}>
        {sourcePicker}
      </FilterGroup>
      <FilterGroup id="version" title={t("discover.filter.version")} count={f.version ? 1 : 0}>
        <div>
          <Select
            size="sm"
            className="px-2"
            value={f.version ?? ALL}
            onChange={(v) => f.set({ version: v === ALL ? null : v })}
            options={[{ value: ALL, label: t("discover.filter.all_versions") }, ...versions.map((v) => ({ value: v, label: v }))]}
          />
        </div>
      </FilterGroup>
      {loaderApplies && (
        <FilterGroup id="loader" title={t("discover.filter.loader")} count={f.loader ? 1 : 0}>
          <div className="flex flex-col gap-px" role="radiogroup" aria-label={t("discover.filter.loader")}>
            {LOADERS.map((l) => (
              <CheckRow key={l} radio on={f.loader === l} icon={<LoaderIcon loader={l} size={14} />} label={formatLoader({ kind: l, version: null })} onClick={() => f.set({ loader: f.loader === l ? null : l })} />
            ))}
          </div>
        </FilterGroup>
      )}
      </>
      <FilterGroup
        id="categories"
        title={t("discover.filter.categories")}
        count={f.categories.length}
        right={
          f.categories.length > 0 && (
            <button
              className="h-7 shrink-0 rounded-ctl px-2 text-caption font-medium text-dim transition-colors hover:bg-white/[.06] hover:text-text"
              onClick={() => f.set({ categories: [] })}
            >
              {t("discover.filter.clear")}
            </button>
          )
        }
      >
        {cats.isPending ? (
          <div className="flex flex-col gap-2 px-2 py-1">
            {[70, 90, 60, 84, 66, 78].map((w, i) => (
              <Skeleton key={i} className="h-4" style={{ width: `${w}%` }} />
            ))}
          </div>
        ) : cats.isError ? (
          <button className="px-2 text-left text-[12px] text-dim hover:text-text" onClick={() => cats.refetch()}>
            {t("discover.filter.cats_error")}
          </button>
        ) : (
          <div className="flex flex-col gap-px">
            {(cats.data ?? []).map((c) => {
              const on = f.categories.includes(c.id);
              return (
                <CheckRow
                  key={c.id}
                  on={on}
                  icon={<CategoryIcon id={catIconKey(c)} size={14} />}
                  label={catLabel(c)}
                  onClick={() => f.set({ categories: on ? f.categories.filter((x) => x !== c.id) : [...f.categories, c.id] })}
                />
              );
            })}
          </div>
        )}
      </FilterGroup>
    </aside>
  );
}
