// OWNER: Content-Agent. Mod-Sets: Übersicht aller Sets (Bibliothek → Mod-Sets) und Editor eines Sets
// (`/modsets?set=<id>`): Inhalte, Hinzufügen (Suche / Liste einfügen / aus Instanz), Kompatibilität, Teilen.
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  Check,
  ClipboardPaste,
  Copy,
  FileDown,
  FolderInput,
  Layers,
  Link2,
  MoreHorizontal,
  PackageOpen,
  Pencil,
  Plus,
  Search,
  Share2,
  Trash2,
  Users,
} from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from "react";
import { ProjectIcon } from "@/components/content/ProjectIcon";
import { InstanceBadge } from "@/components/content/InstanceBadge";
import {
  Button,
  Checkbox,
  ChoiceCard,
  DropdownItem,
  DropdownLabel,
  DropdownMenu,
  DropdownSeparator,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  Page,
  PageToolbar,
  SearchInput,
  Segmented,
  Select,
  Skeleton,
  Tabs,
  ToolbarButton,
  Tooltip,
  cn,
  confirm,
  toast,
} from "@/components/ui";
import { useT } from "@/i18n";
import { api } from "@/lib/api";
import { formatCount, loaderNames } from "@/lib/format";
import { useInstances } from "@/lib/queries";
import type { ProjectType, Source } from "@/lib/types";
import { entryKey, invalidateSets, setsApi, useSets, type ModSetInfo, type SetCompat, type SetEntry } from "./api";
import { addToSet, InstanceCandidatesList, InstancePicker, PasteList } from "./dialogs";
import { SetCover, copyText, countLabel, openApplySets, openCreateSet, openImportSet, openSetFromInstance, typeSummary } from "./shared";

const route = getRouteApi("/modsets");

export function ModSetsPage() {
  const { set } = route.useSearch();
  return set ? <SetEditor key={set} id={set} /> : <SetsOverview />;
}

// ------------------------------------------------------------------ Anwenden-Menü (Instanz wählen)

function ApplyMenu({ setIds, trigger }: { setIds: string[]; trigger: ReactNode }) {
  const t = useT();
  const instances = useInstances().data ?? [];
  const sorted = [...instances].sort((a, b) => (b.last_played ?? 0) - (a.last_played ?? 0));
  return (
    <DropdownMenu trigger={trigger}>
      <DropdownLabel>{t("sets.apply_pick")}</DropdownLabel>
      <div className="scroll max-h-[340px]">
        {sorted.map((i) => (
          <DropdownItem key={i.id} icon={<InstanceBadge instance={i} size={18} />} shortcut={`${i.mc_version} · ${loaderNames[i.loader.kind]}`} onSelect={() => openApplySets(i.id, setIds)}>
            <span className="max-w-[200px] truncate">{i.name}</span>
          </DropdownItem>
        ))}
      </div>
    </DropdownMenu>
  );
}

function SetMenuItems({ set, onDeleted }: { set: ModSetInfo; onDeleted?: () => void }) {
  const t = useT();
  const nav = useNavigate();
  const del = async () => {
    if (!(await confirm({ title: t("sets.delete_confirm", { name: set.name }), text: t("sets.delete_text"), danger: true, confirmLabel: t("sets.delete") }))) return;
    try {
      await setsApi.remove(set.id);
      await invalidateSets();
      toast.success(t("sets.deleted", { name: set.name }));
      onDeleted?.();
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <>
      <DropdownItem icon={<Pencil size={14} />} onSelect={() => nav({ to: "/modsets", search: { set: set.id } })}>
        {t("sets.edit")}
      </DropdownItem>
      <DropdownItem
        icon={<Copy size={14} />}
        onSelect={async () => {
          try {
            const s = await setsApi.duplicate(set.id);
            await invalidateSets();
            toast.success(t("sets.duplicated"));
            nav({ to: "/modsets", search: { set: s.id } });
          } catch (e) {
            toast.error(e);
          }
        }}
      >
        {t("sets.duplicate")}
      </DropdownItem>
      <ShareItems set={set} />
      <DropdownSeparator />
      <DropdownItem icon={<Trash2 size={14} />} danger onSelect={() => void del()}>
        {t("sets.delete")}
      </DropdownItem>
    </>
  );
}

function ShareItems({ set }: { set: ModSetInfo }) {
  const t = useT();
  return (
    <>
      <DropdownSeparator />
      <DropdownLabel>{t("sets.share")}</DropdownLabel>
      <DropdownItem
        icon={<Share2 size={14} />}
        disabled={!set.entries.length}
        onSelect={async () => {
          try {
            await copyText(await setsApi.exportCode(set.id));
            toast.success(t("sets.share.code_copied"));
          } catch (e) {
            toast.error(e);
          }
        }}
      >
        {t("sets.share.code")}
      </DropdownItem>
      <DropdownItem
        icon={<FileDown size={14} />}
        disabled={!set.entries.length}
        onSelect={async () => {
          try {
            const { save } = await import("@tauri-apps/plugin-dialog");
            const path = await save({ defaultPath: `${set.name.replace(/[\\/:*?"<>|]+/g, "_")}.vibeset.json`, filters: [{ name: t("import.file_filter"), extensions: ["json"] }] });
            if (!path) return;
            await setsApi.exportFile(set.id, path);
            toast.success(t("sets.share.file_saved"));
          } catch (e) {
            toast.error(e);
          }
        }}
      >
        {t("sets.share.file")}
      </DropdownItem>
      <DropdownItem
        icon={<Link2 size={14} />}
        disabled={!set.entries.length}
        onSelect={async () => {
          try {
            await copyText(await setsApi.exportLinks(set.id));
            toast.success(t("sets.share.links_copied"));
          } catch (e) {
            toast.error(e);
          }
        }}
      >
        {t("sets.share.links")}
      </DropdownItem>
    </>
  );
}

// ------------------------------------------------------------------ Übersicht

function SetRow({ set }: { set: ModSetInfo }) {
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

function Ways() {
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

function SetsOverview() {
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

// ------------------------------------------------------------------ Editor

type AddMode = "search" | "paste" | "instance";

function compatLine(t: ReturnType<typeof useT>, c: SetCompat["entries"][number] | undefined): string | null {
  if (!c) return null;
  if (c.error) return t("sets.compat.unknown");
  if (!c.mc_max) return t("sets.compat.none");
  const range = c.mc_min && c.mc_min !== c.mc_max ? `${c.mc_min} – ${c.mc_max}` : c.mc_max;
  const loaders = c.loaders.filter((l) => l !== "vanilla").map((l) => loaderNames[l]);
  return loaders.length ? t("sets.compat.entry", { loaders: loaders.join(", "), range }) : range;
}

function EntryRow({ e, compat, onRemove }: { e: SetEntry; compat: string | null; onRemove: () => void }) {
  const t = useT();
  const nav = useNavigate();
  return (
    <div className="group flex items-center gap-3 rounded-ctl px-3 py-2 transition-colors duration-100 hover:bg-white/[.03]">
      <ProjectIcon src={e.icon_url} size={36} />
      <button className="min-w-0 flex-1 text-left" onClick={() => nav({ to: "/discover", search: { p: `${e.source}:${e.project_id}`, source: e.source === "modrinth" ? undefined : e.source } })}>
        <div className="truncate text-[13.5px] font-semibold text-text group-hover:underline">{e.title}</div>
        <div className="truncate text-meta text-muted">
          {t(`sets.type.${e.project_type}`)} · {t(`sets.source.${e.source === "curseforge" ? "curseforge" : "modrinth"}`)}
          {compat && <span className="text-dim"> · {compat}</span>}
        </div>
      </button>
      <IconButton label={t("sets.remove_entry")} tip size="sm" variant="ghost" className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100" onClick={onRemove}>
        <Trash2 size={14} />
      </IconButton>
    </div>
  );
}

function NameEditor({ set }: { set: ModSetInfo }) {
  const t = useT();
  const [edit, setEdit] = useState<null | { name: string; description: string }>(null);
  const save = async () => {
    if (!edit || !edit.name.trim()) return;
    try {
      await setsApi.update(set.id, { name: edit.name, description: edit.description });
      await invalidateSets();
      setEdit(null);
    } catch (e) {
      toast.error(e);
    }
  };
  if (edit)
    return (
      <div className="flex min-w-0 flex-1 flex-col gap-1.5" onKeyDown={(e) => (e.key === "Enter" ? void save() : e.key === "Escape" && setEdit(null))}>
        <Input autoFocus value={edit.name} maxLength={60} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className="font-semibold" aria-label={t("sets.name")} />
        <Input value={edit.description} maxLength={400} placeholder={t("sets.description_placeholder")} onChange={(e) => setEdit({ ...edit, description: e.target.value })} aria-label={t("sets.description")} />
        <div className="flex gap-2">
          <Button size="sm" variant="primary" icon={<Check size={14} />} disabled={!edit.name.trim()} onClick={() => void save()}>
            {t("common.save")}
          </Button>
          <Button size="sm" variant="subtle" onClick={() => setEdit(null)}>
            {t("common.cancel")}
          </Button>
        </div>
      </div>
    );
  return (
    <div className="min-w-0 flex-1">
      <button className="group flex max-w-full items-center gap-2 text-left" onClick={() => setEdit({ name: set.name, description: set.description ?? "" })} title={t("sets.rename")}>
        <h1 className="truncate text-title text-text">{set.name}</h1>
        <Pencil size={14} className="shrink-0 text-dim opacity-0 transition-opacity group-hover:opacity-100" />
      </button>
      {set.description && <div className="mt-0.5 truncate text-[13px] text-muted">{set.description}</div>}
      <div className="mt-1 text-meta text-dim">
        {[countLabel(t, set.entries.length), typeSummary(t, set.entries), set.used_by.length ? (set.used_by.length === 1 ? t("sets.used_by_1") : t("sets.used_by", { n: set.used_by.length })) : null]
          .filter(Boolean)
          .join(" · ")}
      </div>
    </div>
  );
}

const TYPES: ProjectType[] = ["mod", "shader", "resourcepack", "datapack"];

function SearchAdd({ set }: { set: ModSetInfo }) {
  const t = useT();
  const cf = useQuery({ queryKey: ["curseforge-available"], queryFn: api.curseforgeAvailable, staleTime: 5 * 60_000 }).data ?? false;
  const [source, setSource] = useState<Source>("modrinth");
  const [type, setType] = useState<ProjectType>("mod");
  const [text, setText] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const h = setTimeout(() => setDebounced(text.trim()), 300);
    return () => clearTimeout(h);
  }, [text]);
  const q = useQuery({
    queryKey: ["mod-sets", "search", source, type, debounced],
    queryFn: () =>
      api.contentSearch({ source, query: debounced, project_type: type, game_version: null, loader: null, categories: [], sort: debounced ? "relevance" : "downloads", offset: 0, limit: 20 }),
    staleTime: 60_000,
  });
  const keys = useMemo(() => new Set(set.entries.map(entryKey)), [set.entries]);
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <SearchInput value={text} onChange={setText} placeholder={t("sets.add.search_placeholder")} autoFocus />
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <Select<ProjectType> size="sm" variant="ghost" value={type} onChange={setType} options={TYPES.map((k) => ({ value: k, label: t(`sets.type.${k}`) }))} />
        </div>
        {cf && (
          <Segmented<Source>
            value={source}
            onChange={setSource}
            items={[
              { value: "modrinth", label: "Modrinth" },
              { value: "curseforge", label: "CurseForge" },
            ]}
          />
        )}
      </div>
      <div className="scroll -mx-2 max-h-[460px] min-h-[200px]">
        {q.isPending ? (
          <div className="flex flex-col gap-1.5 px-2">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-11" />
            ))}
          </div>
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data.hits.length ? (
          <div className="py-8 text-center text-[13px] text-muted">{t("sets.add.no_results")}</div>
        ) : (
          q.data.hits.map((h) => {
            const inSet = keys.has(`${h.source}:${h.id}`);
            const entry: SetEntry = { source: h.source, project_id: h.id, slug: h.slug || null, title: h.title, icon_url: h.icon_url, project_type: h.project_type, added: 0 };
            return (
              <div key={h.id} className="flex items-center gap-3 rounded-ctl px-2 py-1.5 hover:bg-white/[.03]">
                <ProjectIcon src={h.icon_url} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-text">{h.title}</div>
                  <div className="truncate text-[12px] text-dim">
                    {h.author} · {formatCount(h.downloads)} ↓
                  </div>
                </div>
                {inSet ? (
                  <span className="flex shrink-0 items-center gap-1 text-[12px] text-ok">
                    <Check size={13} />
                    {t("sets.add.in_set")}
                  </span>
                ) : (
                  <IconButton label={t("sets.add")} tip size="sm" variant="ghost" onClick={() => void addToSet(t, set.id, [entry], set.entries.length)}>
                    <Plus size={15} />
                  </IconButton>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function InstanceAdd({ set }: { set: ModSetInfo }) {
  const t = useT();
  const [instanceId, setInstanceId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const keys = useMemo(() => new Set(set.entries.map(entryKey)), [set.entries]);
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <InstancePicker value={instanceId} onChange={setInstanceId} />
      {instanceId && (
        <InstanceCandidatesList
          key={instanceId}
          instanceId={instanceId}
          existing={keys}
          busy={busy}
          submitLabel={(n) => t("frominst.add_n", { n })}
          onSubmit={async (entries) => {
            setBusy(true);
            await addToSet(t, set.id, entries, set.entries.length);
            setBusy(false);
            setInstanceId(null);
          }}
        />
      )}
    </div>
  );
}

function AddPanel({ set, initial }: { set: ModSetInfo; initial: AddMode }) {
  const t = useT();
  const [mode, setMode] = useState<AddMode>(initial);
  const keys = useMemo(() => new Set(set.entries.map(entryKey)), [set.entries]);
  return (
    <div className="flex flex-col gap-3 rounded-panel bg-surface p-4">
      <span className="text-[14px] font-semibold text-text">{t("sets.add")}</span>
      <Segmented<AddMode>
          className="flex w-full [&>button]:flex-1 [&>button]:whitespace-nowrap [&>button]:px-2"
          value={mode}
          onChange={setMode}
          items={[
            { value: "search", label: t("sets.add.search") },
            { value: "paste", label: t("sets.add.paste") },
            { value: "instance", label: t("sets.add.instance") },
          ]}
        />
      {mode === "search" ? (
        <SearchAdd set={set} />
      ) : mode === "paste" ? (
        <PasteList compact existing={keys} onAdd={(entries) => addToSet(t, set.id, entries, set.entries.length)} />
      ) : (
        <InstanceAdd set={set} />
      )}
    </div>
  );
}

function cellTone(n: number, total: number) {
  if (!total || n === 0) return "bg-white/[.03] text-dim";
  if (n === total) return "bg-ok/20 text-ok";
  if (n / total >= 0.75) return "bg-ok/10 text-text";
  return "bg-warn/10 text-muted";
}

function CompatPanel({ set }: { set: ModSetInfo }) {
  const t = useT();
  const q = useQuery({ queryKey: ["mod-sets", "compat", set.id, set.updated], queryFn: () => setsApi.compat(set.id), staleTime: 10 * 60_000 });
  if (!set.entries.length) return <div className="py-10 text-center text-[13px] text-muted">{t("sets.content_empty")}</div>;
  if (q.isPending)
    return (
      <div className="flex flex-col gap-2">
        <div className="text-[13px] text-muted">{t("sets.compat.loading")}</div>
        <Skeleton className="h-[180px]" />
      </div>
    );
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const c = q.data;
  const cell = (mc: string, l: string) => c.cells.find((x) => x.mc === mc && x.loader === l)?.available ?? 0;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="text-[14px] font-semibold text-text">{t("sets.compat.title")}</div>
        <div className="mt-0.5 text-[13px] text-muted">{t("sets.compat.text")}</div>
      </div>
      {c.best && (
        <div className="flex items-center gap-2 rounded-card bg-ok/[.08] px-3 py-2.5 text-[13px] text-text">
          <Check size={15} className="shrink-0 text-ok" />
          {c.best.available === c.total
            ? t("sets.compat.best_all", { mc: c.best.mc, loader: loaderNames[c.best.loader] })
            : t("sets.compat.best", { mc: c.best.mc, loader: loaderNames[c.best.loader], n: c.best.available, total: c.total })}
        </div>
      )}
      <div className="scroll overflow-x-auto">
        <table className="w-full border-separate border-spacing-1 text-[12.5px]">
          <thead>
            <tr>
              <th className="w-[96px]" />
              {c.mc_versions.map((mc) => (
                <th key={mc} className="px-1 pb-1 text-center font-semibold tabular-nums text-muted">
                  {mc}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {c.loaders.map((l) => (
              <tr key={l}>
                <td className="pr-2 font-semibold text-text">{l === "vanilla" ? t("sets.compat.loaderless") : loaderNames[l]}</td>
                {c.mc_versions.map((mc) => {
                  const n = cell(mc, l);
                  return (
                    <td key={mc} className="p-0">
                      <Tooltip content={t("sets.compat.cell", { n, total: c.total, mc, loader: l === "vanilla" ? t("sets.compat.loaderless") : loaderNames[l] })}>
                        <div className={cn("grid h-9 place-items-center rounded-xs font-semibold tabular-nums", cellTone(n, c.total))}>
                          {n === c.total ? <Check size={14} /> : `${n}/${c.total}`}
                        </div>
                      </Tooltip>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SetEditor({ id }: { id: string }) {
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

