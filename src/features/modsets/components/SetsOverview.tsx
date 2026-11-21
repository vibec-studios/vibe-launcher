import { useNavigate } from "@tanstack/react-router";
import { ClipboardPaste, FolderInput, MoreHorizontal, PackageOpen, Plus, Search, Users } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { Button, ChoiceCard, DropdownMenu, EmptyState, ErrorState, IconButton, Page, PageToolbar, SearchInput, Skeleton, ToolbarButton, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { invalidateSets, setsApi, useSets, type ModSetInfo } from "../api";
import { SetCover, countLabel, openCreateSet, openImportSet, openSetFromInstance, typeSummary } from "../shared";
import { ApplyMenu, SetMenuItems } from "./SetMenus";

// ------------------------------------------------------------------ Übersicht

export function SetRow({ set }: { set: ModSetInfo }) {
  const t = useT();
  const nav = useNavigate();
  const open = () => nav({ to: "/modsets", search: { set: set.id } });
  const meta = [countLabel(t, set.entries.length), typeSummary(t, set.entries)].filter(Boolean);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && open()}
      className="group grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-card px-3 py-2.5 outline-none transition-colors duration-100 hover:bg-white/[.03] focus-visible:bg-white/[.04]"
    >
      <div className="flex min-w-0 items-center gap-3.5">
        <SetCover set={set} size={46} />
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold text-text">{set.name}</div>
          <div className="truncate text-meta text-muted">
            {set.description ? <span className="text-text/80">{set.description} · </span> : null}
            {meta.join(" · ")}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        {set.used_by.length > 0 && (
          <span className="mr-2 flex items-center gap-1.5 text-[12px] text-dim">
            <Users size={13} />
            {set.used_by.length === 1 ? t("sets.used_by_1") : t("sets.used_by", { n: set.used_by.length })}
          </span>
        )}
        <ApplyMenu
          setIds={[set.id]}
          trigger={
            <Button size="sm" variant="ghost" disabled={!set.entries.length} className="data-[state=open]:bg-surface3">
              {t("sets.apply")}
            </Button>
          }
        />
        <DropdownMenu
          trigger={
            <IconButton label={t("common.more")} tip variant="ghost" size="sm" className="data-[state=open]:bg-white/[.07] data-[state=open]:text-text">
              <MoreHorizontal size={16} />
            </IconButton>
          }
        >
          <SetMenuItems set={set} />
        </DropdownMenu>
      </div>
    </div>
  );
}

export function Ways() {
  const t = useT();
  const nav = useNavigate();
  const pasteNew = async () => {
    try {
      const s = await setsApi.create(t("sets.way.paste"), []);
      await invalidateSets();
      nav({ to: "/modsets", search: { set: s.id, add: "paste" } });
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <div className="grid grid-cols-2 gap-3 @min-[1100px]:grid-cols-4">
      <ChoiceCard arrow icon={<Search size={18} />} title={t("sets.way.search")} text={t("sets.way.search_text")} onClick={openCreateSet} />
      <ChoiceCard arrow icon={<ClipboardPaste size={18} />} title={t("sets.way.paste")} text={t("sets.way.paste_text")} onClick={() => void pasteNew()} />
      <ChoiceCard arrow icon={<FolderInput size={18} />} title={t("sets.way.instance")} text={t("sets.way.instance_text")} onClick={() => openSetFromInstance(null)} />
      <ChoiceCard arrow icon={<PackageOpen size={18} />} title={t("sets.way.import")} text={t("sets.way.import_text")} onClick={openImportSet} />
    </div>
  );
}

export function SetsOverview() {
  const t = useT();
  const { data, isLoading, isError, error, refetch } = useSets();
  const [query, setQuery] = useState("");
  const q = useDeferredValue(query.trim().toLowerCase());
  const list = data ?? [];
  const shown = [...list]
    .filter((s) => !q || s.name.toLowerCase().includes(q) || s.entries.some((e) => e.title.toLowerCase().includes(q)))
    .sort((a, b) => b.updated - a.updated);
  return (
    <Page className="@container">
        <PageToolbar
          actions={
            <>
              <ToolbarButton variant="subtle" data-tour="modsets-import" icon={<PackageOpen size={15} />} label={t("sets.import")} onClick={openImportSet} />
              {list.length > 0 && <ToolbarButton variant="subtle" icon={<FolderInput size={15} />} label={t("sets.way.instance")} onClick={() => openSetFromInstance(null)} />}
              <Button variant="primary" data-tour="modsets-new" icon={<Plus size={16} />} onClick={openCreateSet}>
                {t("sets.new")}
              </Button>
            </>
          }
        >
          {list.length > 0 && <SearchInput value={query} onChange={setQuery} placeholder={t("sets.search")} className="min-w-[160px] max-w-[320px] flex-1 basis-[240px]" />}
        </PageToolbar>
        {isError && !data ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : isLoading && !data ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-[62px]" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <div className="flex flex-col gap-4">
            <EmptyState
              className="rounded-panel bg-surface py-12"
              icon="layers"
              title={t("sets.empty.title")}
              text={<span className="mx-auto block max-w-[520px]">{t("sets.empty.text")}</span>}
            />
            <Ways />
          </div>
        ) : (
          <>
            <p className="max-w-[760px] text-[13px] text-muted">{t("sets.intro")}</p>
            {shown.length === 0 ? (
              <EmptyState
                icon="search_none"
                title={t("sets.no_match", { q: query })}
                action={
                  <Button size="sm" onClick={() => setQuery("")}>
                    {t("layout.search.reset")}
                  </Button>
                }
              />
            ) : (
              <div data-tour="modsets-list" className="-mx-3 flex flex-col">
                {shown.map((s) => (
                  <SetRow key={s.id} set={s} />
                ))}
              </div>
            )}
          </>
        )}
    </Page>
  );
}
