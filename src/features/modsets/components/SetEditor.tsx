import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Layers, MoreHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import { Button, Checkbox, DropdownMenu, EmptyState, ErrorState, IconButton, Page, Skeleton, Tabs, cn, toast } from "@/components/ui";
import { useT } from "@/i18n";
import type { ProjectType } from "@/lib/types";
import { entryKey, invalidateSets, setsApi, useSets, type SetEntry } from "../api";
import { route } from "../route";
import { SetCover } from "../shared";
import { AddPanel, TYPES } from "./AddPanel";
import { CompatPanel } from "./CompatPanel";
import { EntryRow, NameEditor, compatLine } from "./EntryRow";
import { ApplyMenu, SetMenuItems } from "./SetMenus";

export function SetEditor({ id }: { id: string }) {
  const t = useT();
  const nav = useNavigate();
  const search = route.useSearch();
  const { data, isLoading, isError, error, refetch } = useSets();
  const set = data?.find((s) => s.id === id);
  const [tab, setTab] = useState<"content" | "compat">("content");
  const [filter, setFilter] = useState<ProjectType | "all">("all");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const compat = useQuery({ queryKey: ["mod-sets", "compat", id, set?.updated], queryFn: () => setsApi.compat(id), staleTime: 10 * 60_000, enabled: !!set?.entries.length });
  const compatByKey = useMemo(() => new Map((compat.data?.entries ?? []).map((e) => [e.key, e])), [compat.data]);

  if (isError && !data) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (isLoading || !data)
    return (
      <div className="flex flex-col gap-4 px-6 pt-4">
        <Skeleton className="h-16 w-[420px]" />
        <Skeleton className="h-[300px]" />
      </div>
    );
  if (!set) return <EmptyState className="mt-10" title={t("sets.empty.title")} action={<Button onClick={() => nav({ to: "/modsets", search: {} })}>{t("sets.back")}</Button>} />;

  const types = TYPES.filter((k) => set.entries.some((e) => e.project_type === k));
  const shown = set.entries.filter((e) => filter === "all" || e.project_type === filter);
  const setTemplate = async (enabled: boolean) => {
    setSavingTemplate(true);
    try {
      await setsApi.setApplyOnCreate(set.id, enabled);
      await invalidateSets();
    } catch (e) {
      toast.error(e);
    } finally {
      setSavingTemplate(false);
    }
  };
  const remove = async (e: SetEntry) => {
    try {
      await setsApi.removeEntries(set.id, [entryKey(e)]);
      await invalidateSets();
      toast.info(t("sets.removed_entry", { name: e.title }), undefined, {
        label: t("sets.undo"),
        onClick: () => void setsApi.addEntries(set.id, [e]).then(() => invalidateSets()),
      });
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <Page className="@container">
        <button onClick={() => nav({ to: "/modsets", search: {} })} className="flex w-fit items-center gap-1.5 text-[12.5px] font-semibold text-muted hover:text-text">
          <ArrowLeft size={14} />
          {t("sets.back")}
        </button>
        <div className="flex items-start gap-4">
          <SetCover set={set} size={64} />
          <NameEditor set={set} />
          <div className="flex shrink-0 items-center gap-1.5">
            <ApplyMenu
              setIds={[set.id]}
              trigger={
                <Button variant="primary" icon={<Layers size={15} />} disabled={!set.entries.length}>
                  {t("sets.apply_to")}
                </Button>
              }
            />
            <DropdownMenu
              trigger={
                <IconButton label={t("common.more")} tip variant="ghost" className="data-[state=open]:bg-white/[.07] data-[state=open]:text-text">
                  <MoreHorizontal size={17} />
                </IconButton>
              }
            >
              <SetMenuItems set={set} onDeleted={() => nav({ to: "/modsets", search: {} })} />
            </DropdownMenu>
          </div>
        </div>
        <div className="flex w-fit items-center gap-2 text-[13px] text-text">
          <Checkbox checked={set.apply_on_create} disabled={savingTemplate} onChange={setTemplate} label={t("sets.template")} />
          {t("sets.template")}
        </div>
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: "content", label: t("sets.tab.content"), badge: set.entries.length },
            { value: "compat", label: t("sets.tab.compat") },
          ]}
        />
        {tab === "compat" ? (
          <CompatPanel set={set} />
        ) : (
          <div className="grid grid-cols-[minmax(0,1fr)_400px] items-start gap-6 @max-[980px]:grid-cols-1">
            <div className="flex min-w-0 flex-col gap-2">
              {types.length > 1 && (
                <div className="flex flex-wrap gap-1.5">
                  {(["all", ...types] as const).map((k) => (
                    <button
                      key={k}
                      onClick={() => setFilter(k)}
                      className={cn(
                        "flex h-7 items-center gap-1.5 rounded-pill px-3 text-[12.5px] font-semibold transition-colors",
                        filter === k ? "bg-surface3 text-text" : "text-muted hover:bg-white/[.05] hover:text-text",
                      )}
                    >
                      {k === "all" ? t("sets.filter.all") : t(`sets.type.${k}`)}
                      <span className="tabular-nums text-dim">{k === "all" ? set.entries.length : set.entries.filter((e) => e.project_type === k).length}</span>
                    </button>
                  ))}
                </div>
              )}
              {set.entries.length === 0 ? (
                <EmptyState className="rounded-panel border border-dashed border-line2 py-14" icon="layers" title={t("sets.content_empty")} text={t("sets.content_empty_text")} />
              ) : (
                <div className="-mx-3 flex flex-col">
                  {shown.map((e) => (
                    <EntryRow key={entryKey(e)} e={e} compat={compatLine(t, compatByKey.get(entryKey(e)))} onRemove={() => void remove(e)} />
                  ))}
                </div>
              )}
            </div>
            <AddPanel set={set} initial={search.add ?? "search"} />
          </div>
        )}
    </Page>
  );
}
