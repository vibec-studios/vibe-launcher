// OWNER: Frontend-Agent B. Wird von InstancePage (Agent A) für die Tabs Mods/Resourcepacks/Shader eingebunden.
// Virtualisierte Liste (300+ Einträge flüssig), Suche/Filter, Mehrfachauswahl mit Sammelaktionen, Kontextmenü,
// optimistisches Aktivieren, Updates, Dateien hinzufügen (Dialog + Drag & Drop), Banner für fehlende CurseForge-Dateien.
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, FilePlus2, FolderOpen, PackagePlus, Plus, Power, PowerOff, RefreshCw, SearchX, Trash2, Upload, X } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type MouseEvent } from "react";
import { create } from "zustand";
import { Button, EmptyState, ErrorState, IconButton, SearchInput, Spinner, Tooltip, confirm, cn, toast } from "@/components/ui";
import { useT, t as tt } from "@/i18n";
import { api, errorMessage, isCancelled } from "@/lib/api";
import { qk, queryClient, useTask, waitForTask } from "@/lib/queries";
import type { ContentItem, ContentKind, ContentUpdate, Instance } from "@/lib/types";
import { registerDropTarget, useDragState } from "@/components/content/dragdrop";
import { contentKey, fileExt, kindExtensions, kindFolder } from "@/components/content/util";
import { ContentRow, GRID, ROW_H, RowSkeleton, SelectBox, type RowActions } from "./ContentRow";
import { MissingBanner } from "./MissingBanner";

type Filter = "all" | "enabled" | "disabled" | "updates";

/** Wurde für die Instanz schon nach Updates gesucht? (bleibt beim Tab-Wechsel erhalten) */
const useUpdateChecks = create<{ checked: Record<string, boolean>; tasks: Record<string, string> }>(() => ({ checked: {}, tasks: {} }));

const discoverType: Record<ContentKind, string> = { mod: "mod", resourcepack: "resourcepack", shader: "shader", datapack: "datapack" };

/** Dateien zu einer Instanz hinzufügen (Dialog, Drag & Drop, globale Ablage). */
export async function addContentFiles(instanceId: string, kind: ContentKind, paths: string[]) {
  if (!paths.length) return;
  try {
    const added = await api.contentAddFiles(instanceId, kind, paths);
    queryClient.invalidateQueries({ queryKey: ["content", instanceId] });
    toast.success(tt("content.added", { n: added.length || paths.length }));
  } catch (e) {
    toast.error(e, tt("content.add_failed"));
  }
}

export function InstanceContentTab({ instance, kind }: { instance: Instance; kind: ContentKind }) {
  const t = useT();
  const navigate = useNavigate();
  const id = instance.id;
  const listKey = qk.content(id, kind);
  const q = useQuery({ queryKey: listKey, queryFn: () => api.contentList(id, kind), staleTime: 60_000 });

  // ---------------------------------------------------------------- Updates
  const checked = useUpdateChecks((s) => !!s.checked[id]);
  const updTaskId = useUpdateChecks((s) => s.tasks[id]);
  const updTask = useTask(updTaskId);
  const updatesQ = useQuery({
    queryKey: qk.contentUpdates(id),
    queryFn: () => api.contentCheckUpdates(id),
    enabled: checked,
    staleTime: 10 * 60_000,
  });
  const updates = useMemo(() => {
    const m = new Map<string, ContentUpdate>();
    for (const u of updatesQ.data ?? []) if (u.kind === kind) m.set(contentKey(u.file_name), u);
    return m;
  }, [updatesQ.data, kind]);
  const checkUpdates = () => {
    if (!checked) useUpdateChecks.setState((s) => ({ checked: { ...s.checked, [id]: true } }));
    else void updatesQ.refetch();
  };

  // ---------------------------------------------------------------- Suche / Filter
  const [text, setText] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const all = q.data ?? [];
  const sorted = useMemo(() => [...all].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })), [all]);
  const counts = useMemo(() => {
    let on = 0;
    for (const c of all) if (c.enabled) on++;
    return { all: all.length, enabled: on, disabled: all.length - on, updates: all.filter((c) => updates.has(contentKey(c.file_name))).length };
  }, [all, updates]);
  const visible = useMemo(() => {
    const needle = text.trim().toLowerCase();
    return sorted.filter((c) => {
      if (filter === "enabled" && !c.enabled) return false;
      if (filter === "disabled" && c.enabled) return false;
      if (filter === "updates" && !updates.has(contentKey(c.file_name))) return false;
      if (!needle) return true;
      return c.name.toLowerCase().includes(needle) || c.file_name.toLowerCase().includes(needle) || c.authors.some((a) => a.toLowerCase().includes(needle));
    });
  }, [sorted, text, filter, updates]);

  // ---------------------------------------------------------------- Auswahl
  const [selection, setSelection] = useState<Set<string>>(() => new Set());
  const anchor = useRef<string | null>(null);
  // Auswahl auf vorhandene Einträge beschränken
  useEffect(() => {
    if (!selection.size) return;
    const keys = new Set(all.map((c) => contentKey(c.file_name)));
    let changed = false;
    const next = new Set<string>();
    for (const k of selection) (keys.has(k) ? next.add(k) : (changed = true));
    if (changed) setSelection(next);
  }, [all, selection]);

  const state = useRef({ visible, selection, all, updates });
  state.current = { visible, selection, all, updates };

  const byKeys = (keys: Iterable<string>) => {
    const set = new Set(keys);
    return state.current.all.filter((c) => set.has(contentKey(c.file_name)));
  };

  // ---------------------------------------------------------------- Aktionen
  const setEnabled = useCallback(
    async (items: ContentItem[], enabled: boolean) => {
      const targets = items.filter((i) => i.enabled !== enabled);
      if (!targets.length) return;
      const keys = new Set(targets.map((i) => contentKey(i.file_name)));
      await queryClient.cancelQueries({ queryKey: listKey });
      queryClient.setQueryData<ContentItem[]>(listKey, (l) => l?.map((c) => (keys.has(contentKey(c.file_name)) ? { ...c, enabled } : c)));
      let failed = 0;
      let lastErr: unknown;
      for (let i = 0; i < targets.length; i += 8) {
        await Promise.all(
          targets.slice(i, i + 8).map((it) =>
            api
              .contentSetEnabled(id, kind, it.file_name, enabled)
              .then((r) => queryClient.setQueryData<ContentItem[]>(listKey, (l) => l?.map((c) => (contentKey(c.file_name) === contentKey(it.file_name) ? r : c))))
              .catch((e) => {
                failed++;
                lastErr = e;
              }),
          ),
        );
      }
      if (failed) {
        toast.error(lastErr, tt("content.toggle_failed", { n: failed }));
        queryClient.invalidateQueries({ queryKey: listKey });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, kind],
  );

  const remove = useCallback(
    async (items: ContentItem[]) => {
      if (!items.length) return;
      const ok = await confirm({
        title: items.length > 1 ? tt("content.remove_title_n", { n: items.length }) : tt("content.remove_title", { name: items[0].name }),
        text: tt("content.remove_text"),
        confirmLabel: tt("common.remove"),
        danger: true,
      });
      if (!ok) return;
      const files = items.map((i) => i.file_name);
      const keys = new Set(files.map(contentKey));
      queryClient.setQueryData<ContentItem[]>(listKey, (l) => l?.filter((c) => !keys.has(contentKey(c.file_name))));
      setSelection((s) => new Set([...s].filter((k) => !keys.has(k))));
      try {
        await api.contentRemove(id, kind, files);
      } catch (e) {
        toast.error(e, tt("content.remove_failed"));
      }
      queryClient.invalidateQueries({ queryKey: listKey });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, kind],
  );

  const update = useCallback(
    async (items: ContentItem[]) => {
      if (!items.length) return;
      try {
        const taskId = await api.contentUpdate(
          id,
          items.map((i) => i.file_name),
        );
        useUpdateChecks.setState((s) => ({ tasks: { ...s.tasks, [id]: taskId } }));
        waitForTask(taskId)
          .then(() => {
            toast.success(tt("content.updated", { n: items.length }));
            queryClient.invalidateQueries({ queryKey: ["content", id] });
            queryClient.invalidateQueries({ queryKey: qk.contentUpdates(id) });
          })
          .catch((e) => !isCancelled(e) && toast.error(tt("content.update_failed"), errorMessage(e)));
      } catch (e) {
        toast.error(e, tt("content.update_failed"));
      }
    },
    [id],
  );

  const openFolder = useCallback(() => {
    api.instanceOpenFolder(id, kindFolder[kind]).catch((e) => toast.error(e));
  }, [id, kind]);

  const addFiles = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const res = await open({
        multiple: true,
        title: t(`content.add_files.${kind}`),
        filters: [{ name: t(`content.kind.${kind}`), extensions: kindExtensions[kind] }],
      });
      const paths = Array.isArray(res) ? res : res ? [res] : [];
      await addContentFiles(id, kind, paths);
    } catch (e) {
      toast.error(e);
    }
  };

  const actions = useMemo<RowActions>(
    () => ({
      click: (key: string, e: MouseEvent) => {
        const { visible: vis, selection: sel } = state.current;
        if (e.shiftKey && anchor.current) {
          const a = vis.findIndex((c) => contentKey(c.file_name) === anchor.current);
          const b = vis.findIndex((c) => contentKey(c.file_name) === key);
          if (a !== -1 && b !== -1) {
            const [lo, hi] = a < b ? [a, b] : [b, a];
            const next = e.ctrlKey || e.metaKey ? new Set(sel) : new Set<string>();
            for (let i = lo; i <= hi; i++) next.add(contentKey(vis[i].file_name));
            setSelection(next);
            return;
          }
        }
        anchor.current = key;
        if (e.ctrlKey || e.metaKey) {
          const next = new Set(sel);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          setSelection(next);
        } else {
          setSelection(sel.size === 1 && sel.has(key) ? new Set() : new Set([key]));
        }
      },
      toggle: (key: string) => {
        anchor.current = key;
        const next = new Set(state.current.selection);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        setSelection(next);
      },
      context: (key: string) => {
        if (!state.current.selection.has(key)) {
          anchor.current = key;
          setSelection(new Set([key]));
        }
      },
      menuTargets: (key: string) => {
        const sel = state.current.selection;
        return sel.has(key) ? byKeys(sel) : byKeys([key]);
      },
      setEnabled: (items, v) => void setEnabled(items, v),
      update: (items) => void update(items),
      remove: (items) => void remove(items),
      openProject: (item) =>
        item.source && item.project_id && navigate({ to: "/project/$source/$id", params: { source: item.source, id: item.project_id }, search: { instance: id } }),
      openFolder,
      hasUpdate: (item) => state.current.updates.has(contentKey(item.file_name)),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setEnabled, update, remove, openFolder, navigate, id],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "a") {
      e.preventDefault();
      setSelection(new Set(visible.map((c) => contentKey(c.file_name))));
    } else if (e.key === "Escape" && selection.size) {
      setSelection(new Set());
    } else if (e.key === "Delete" && selection.size) {
      e.preventDefault();
      void remove(byKeys(selection));
    }
  };

  // ---------------------------------------------------------------- Drag & Drop auf die Liste
  const dropId = useId();
  const dropRef = useRef<HTMLDivElement>(null);
  const over = useDragState((s) => s.over === dropId);
  useEffect(() => {
    const el = dropRef.current;
    if (!el) return;
    return registerDropTarget({
      id: dropId,
      el,
      accepts: (paths) => paths.some((p) => kindExtensions[kind].includes(fileExt(p))),
      onDrop: (paths) => void addContentFiles(id, kind, paths.filter((p) => kindExtensions[kind].includes(fileExt(p)))),
    });
  }, [dropId, id, kind]);

  // ---------------------------------------------------------------- Liste
  const scrollRef = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({
    count: q.isPending ? 0 : visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 10,
  });

  const selItems = selection.size ? byKeys(selection) : [];
  const selUpdates = selItems.filter((c) => updates.has(contentKey(c.file_name)));
  const updatesRunning = updTask?.status === "running";
  const empty = q.isSuccess && all.length === 0;

  const toDiscover = () => navigate({ to: "/discover", search: { instance: id, type: discoverType[kind] as never } });

  const allVisibleSelected = visible.length > 0 && visible.every((c) => selection.has(contentKey(c.file_name)));
  const headState: "on" | "off" | "mixed" = selection.size === 0 ? "off" : allVisibleSelected ? "on" : "mixed";

  return (
    <div className="@container flex h-full min-h-0 flex-col outline-none" tabIndex={-1} onKeyDown={onKeyDown}>
      {/* Werkzeugleiste */}
      <div className="flex h-14 shrink-0 items-center gap-2 px-4">
        <SearchInput
          value={text}
          onChange={setText}
          placeholder={t(`content.search.${kind}`)}
          className="w-[200px] min-w-0 shrink @min-[900px]:w-[260px]"
          disabled={empty}
        />
        {!empty && (
          <div className="flex items-center gap-1">
            {(["all", "enabled", "disabled", "updates"] as Filter[]).map((f) =>
              f === "updates" && !checked ? null : (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    "flex h-8 items-center gap-1.5 px-2.5 text-[13px] font-medium transition-colors duration-100",
                    filter === f ? "bg-surface3 text-white" : "text-muted hover:bg-white/[.04] hover:text-white",
                  )}
                >
                  {t(`content.filter.${f}`)}
                  <span className="text-[12px] text-dim">{q.isSuccess ? counts[f] : ""}</span>
                </button>
              ),
            )}
          </div>
        )}
        <div className="flex-1" />
        <Tooltip content={t(`content.add_files.${kind}`)}>
          <IconButton label={t(`content.add_files.${kind}`)} size="sm" onClick={addFiles}>
            <FilePlus2 size={15} />
          </IconButton>
        </Tooltip>
        <Tooltip content={t("common.open_folder")}>
          <IconButton label={t("common.open_folder")} size="sm" onClick={openFolder}>
            <FolderOpen size={15} />
          </IconButton>
        </Tooltip>
        <Button size="sm" variant="accent" icon={<Plus size={15} />} onClick={toDiscover}>
          {t("content.add")}
        </Button>
      </div>

      <MissingBanner instanceId={id} kind={kind} />

      {/* Tabellenkopf bzw. Auswahlleiste (gleiche Höhe -> kein Springen) */}
      {!empty && (
        <div className={cn(GRID, "h-10 shrink-0 border-y border-line bg-surface text-[12.5px] font-medium text-muted")}>
          <SelectBox
            state={headState}
            label={t("common.select_all")}
            onClick={() => setSelection(headState === "off" ? new Set(visible.map((c) => contentKey(c.file_name))) : new Set())}
          />
          {selection.size > 0 ? (
            <div className="col-span-3 flex min-w-0 items-center gap-0.5 animate-fade-in">
              <span className="mr-2 text-[13px] font-semibold text-white">{t("content.selected", { n: selection.size })}</span>
              <BarButton icon={<Power size={14} />} onClick={() => setEnabled(selItems, true)} disabled={!selItems.some((c) => !c.enabled)}>
                {t("content.menu.enable")}
              </BarButton>
              <BarButton icon={<PowerOff size={14} />} onClick={() => setEnabled(selItems, false)} disabled={!selItems.some((c) => c.enabled)}>
                {t("content.menu.disable")}
              </BarButton>
              <BarButton icon={<RefreshCw size={14} />} onClick={() => update(selUpdates)} disabled={!selUpdates.length || updatesRunning}>
                {t("common.update")}
                {selUpdates.length > 0 && ` (${selUpdates.length})`}
              </BarButton>
              <BarButton icon={<Trash2 size={14} />} onClick={() => remove(selItems)} danger>
                {t("common.remove")}
              </BarButton>
              <div className="flex-1" />
              <Tooltip content={t("content.clear_selection")}>
                <button aria-label={t("content.clear_selection")} className="grid h-7 w-7 place-items-center text-dim hover:text-white" onClick={() => setSelection(new Set())}>
                  <X size={14} />
                </button>
              </Tooltip>
            </div>
          ) : (
            <>
              <span>{t("content.col.name")}</span>
              <span>{t("content.col.version")}</span>
              <div className="flex items-center justify-end">
                {updatesRunning ? (
                  <span className="flex items-center gap-1.5 text-[12px] text-muted">
                    <Spinner size={11} className="text-brand" />
                    {updTask?.progress != null ? `${Math.round(updTask.progress * 100)}%` : ""}
                  </span>
                ) : counts.updates > 0 ? (
                  <Tooltip content={t("content.update_all", { n: counts.updates })}>
                    <button
                      onClick={() => update(all.filter((c) => updates.has(contentKey(c.file_name))))}
                      className="flex h-7 items-center gap-1 px-1.5 text-[12.5px] font-semibold text-accent hover:bg-white/[.06]"
                    >
                      <RefreshCw size={13} />
                      {counts.updates}
                    </button>
                  </Tooltip>
                ) : (
                  <Tooltip content={checked && updatesQ.isSuccess ? t("content.no_updates") : t("content.check_updates")}>
                    <button
                      aria-label={t("content.check_updates")}
                      onClick={checkUpdates}
                      disabled={updatesQ.isFetching}
                      className="grid h-7 w-7 place-items-center text-dim transition-colors hover:bg-white/[.06] hover:text-white disabled:opacity-60"
                    >
                      {updatesQ.isFetching ? <Spinner size={11} className="text-brand" /> : checked && updatesQ.isSuccess ? <Check size={14} className="text-ok" /> : <RefreshCw size={14} />}
                    </button>
                  </Tooltip>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Liste */}
      <div ref={dropRef} className="relative min-h-0 flex-1">
        {q.isError && !q.data ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : q.isPending ? (
          <div className="h-full overflow-hidden">
            {Array.from({ length: 10 }, (_, i) => (
              <RowSkeleton key={i} />
            ))}
          </div>
        ) : empty ? (
          <EmptyState
            icon={<PackagePlus size={30} />}
            title={t(`content.empty.${kind}`)}
            text={t(`content.empty_text.${kind}`)}
            action={
              <div className="flex gap-2">
                <Button variant="accent" icon={<Plus size={15} />} onClick={toDiscover}>
                  {t("content.add")}
                </Button>
                <Button variant="ghost" icon={<FilePlus2 size={15} />} onClick={addFiles}>
                  {t("content.add_files_short")}
                </Button>
              </div>
            }
          />
        ) : visible.length === 0 ? (
          <EmptyState icon={<SearchX size={28} />} title={t("content.no_match")} text={t("content.no_match_text")} />
        ) : (
          <div ref={scrollRef} className="scroll h-full" role="grid" aria-multiselectable>
            <div className="relative" style={{ height: v.getTotalSize() }}>
              {v.getVirtualItems().map((it) => {
                const item = visible[it.index];
                const key = contentKey(item.file_name);
                return (
                  <div key={key} className="absolute inset-x-0" style={{ top: it.start, height: ROW_H }}>
                    <ContentRow item={item} itemKey={key} selected={selection.has(key)} update={updates.get(key)} actions={actions} />
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {over && (
          <div className="pointer-events-none absolute inset-2 z-10 flex flex-col items-center justify-center gap-2.5 border-2 border-dashed border-accent bg-black/80 animate-fade-in">
            <Upload size={26} className="text-accent" />
            <div className="text-[16px] font-semibold text-white">{t(`content.drop.${kind}`)}</div>
            <div className="text-[13px] text-muted">{instance.name}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function BarButton({ icon, children, onClick, disabled, danger }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-7 items-center gap-1.5 px-2 text-[13px] font-medium transition-colors duration-100 disabled:pointer-events-none disabled:opacity-35",
        danger ? "text-danger hover:bg-danger/10" : "text-text hover:bg-white/[.07]",
      )}
    >
      {icon}
      {children}
    </button>
  );
}
