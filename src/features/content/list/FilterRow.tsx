import { ArrowDownUp, ChevronDown, X } from "lucide-react";
import type { ReactNode } from "react";
import { DropdownCheckItem, DropdownLabel, DropdownMenu, DropdownSeparator, IconButton, cn } from "@/components/ui";
import { SIDE_FILTERS } from "@/components/content/sides";
import { useT } from "@/i18n";
import type { ContentKind } from "@/lib/types";
import { setContentSort } from "../contentView";
import { orgActive, resetOrgFilter } from "../organize/filter";
import { OrgFilterBar } from "../organize/OrgFilterBar";
import { SORTS, STATUS, q } from "./keys";
import { FilterChip } from "./parts";
import type { ContentFilters } from "./useContentFilters";

interface Props {
  id: string;
  kinds: ContentKind[];
  known: boolean;
  total: number;
  f: ContentFilters;
  children: ReactNode;
}

export function FilterRow({ id, kinds, known, total, f, children }: Props) {
  const t = useT();
  const { sort, desc, setDesc, type, setType, status, setStatus, counts, sideFilter, setSideFilter, orgQ, orgFilter } = f;
  const activeFilters = (status !== "all" ? 1 : 0) + (sideFilter !== "all" ? 1 : 0) + orgActive(orgFilter);
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-2">
      <DropdownMenu
        align="start"
        trigger={
          // Name/Version zeigt schon der Spaltenkopf (mit Pfeil) – dann reicht hier das Symbol
          <button
            title={`${t("ipage.sort")}: ${t(`ipage.sort.${sort}`)}`}
            aria-label={`${t("ipage.sort")}: ${t(`ipage.sort.${sort}`)}`}
            className="flex h-8 items-center gap-1.5 rounded-ctl px-2 text-[13px] font-semibold text-muted transition-colors hover:bg-white/[.06] hover:text-text data-[state=open]:bg-white/[.06]"
          >
            <ArrowDownUp size={14} />
            {sort !== "name" && sort !== "version" && (
              <>
                {t(`ipage.sort.${sort}`)}
                {desc && <ChevronDown size={13} />}
              </>
            )}
          </button>
        }
      >
        <DropdownLabel>{t("ipage.sort")}</DropdownLabel>
        {SORTS.map((s) => (
          <DropdownCheckItem
            key={s}
            checked={sort === s}
            onCheckedChange={() => {
              setContentSort(s);
              setDesc(false);
            }}
          >
            {t(`ipage.sort.${s}`)}
          </DropdownCheckItem>
        ))}
        <DropdownSeparator />
        <DropdownCheckItem checked={desc} onCheckedChange={setDesc}>
          {t("ipage.ct.desc")}
        </DropdownCheckItem>
      </DropdownMenu>
      <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label={t("ipage.ct.type")}>
        <FilterChip active={type === "all"} onClick={() => setType("all")} count={counts.all}>
          {t("ipage.ct.type.all")}
        </FilterChip>
        {kinds.map((k) => (
          <FilterChip key={k} active={type === k} onClick={() => setType(k)} count={counts.kind[k] ?? 0}>
            {t(`content.kind.${k}`)}
          </FilterChip>
        ))}
      </div>
      <span className="h-5 w-px bg-line2" />
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t("ipage.filter.status")}>
        {STATUS.filter((s) => s !== "updates" || known).map((s) => (
          <FilterChip
            key={s}
            active={status === s}
            tone={s === "updates" ? "accent" : undefined}
            onClick={() => setStatus(status === s ? "all" : s)}
            count={q(counts, s)}
          >
            {s === "updates" ? t("ipage.ct.updates") : t(`content.filter.${s}`)}
          </FilterChip>
        ))}
      </div>
      {type === "mod" && (
        <DropdownMenu
          align="start"
          trigger={
            <button
              className={cn(
                "flex h-8 items-center gap-1 rounded-ctl px-2 text-[13px] font-semibold transition-colors hover:bg-white/[.06] data-[state=open]:bg-white/[.06]",
                sideFilter !== "all" ? "text-text" : "text-muted hover:text-text",
              )}
            >
              {t(`side.filter.${sideFilter}`)}
              <ChevronDown size={13} className="text-dim" />
            </button>
          }
        >
          <DropdownLabel>{t("side.filter")}</DropdownLabel>
          {SIDE_FILTERS.map((s) => (
            <DropdownCheckItem key={s} checked={sideFilter === s} onCheckedChange={() => setSideFilter(s)}>
              {t(`side.filter.${s}`)}
            </DropdownCheckItem>
          ))}
        </DropdownMenu>
      )}
      <OrgFilterBar instanceId={id} data={orgQ.data} total={total} />
      {activeFilters > 0 && (
        // Nur ein „×“ (mit Tooltip): sonst bricht die Zeile genau dann um, wenn ein Filter aktiv ist
        <IconButton
          label={t("ipage.filter.reset")}
          tip
          size="sm"
          variant="ghost"
          onClick={() => {
            setStatus("all");
            setSideFilter("all");
            resetOrgFilter(id);
          }}
        >
          <X size={14} />
        </IconButton>
      )}
      {children}
    </div>
  );
}
