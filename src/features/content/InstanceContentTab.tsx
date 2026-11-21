// OWNER: Frontend-Agent B. Inhalte einer Instanz – aufgebaut wie die Modrinth App:
//   1. Suche über alles + „Dateien hinzufügen“ + Hauptknopf „Inhalte hinzufügen“
//   2. Sortierung, Filter-Chips (Alle / Mods / Resourcepacks / Shader · Updates / Aktiv / Deaktiviert), Seite (Mods),
//      rechts „Alle aktualisieren“, „Neu prüfen“ (F5), Mod-Sets und das Werkzeuge-Menü (Performance-Mods, Ordner)
//   3. Tabelle mit Spaltenköpfen (Auswahl, Name, Version, Aktionen) – Klick auf Name/Version sortiert –, virtualisiert
//      für 300+ Einträge. Mehrfachauswahl mit schwebender Sammelaktionsleiste, Kontextmenü, optimistisches Aktivieren,
//      Drag & Drop (.jar -> Mods, .zip -> Resourcepacks bzw. Shader im Shader-Filter).
// Hinweise (Modpack-Update, Abhängigkeiten, manuelle Downloads) zeigt die Hinweiszeile der Instanzseite.
import { useQueries, useQuery } from "@tanstack/react-query";
import { discoverSearchFor } from "@/app/router";
import { useNavigate } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowDownUp,
  ChevronDown,
  ChevronUp,
  FilePlus2,
  FolderOpen,
  Gauge,
  PackagePlus,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  SearchX,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import {
  Button,
  DropdownCheckItem,
  DropdownItem,
  DropdownLabel,
  DropdownMenu,
  DropdownSeparator,
  EmptyState,
  ErrorState,
  IconButton,
  SearchInput,
  Spinner,
  confirm,
  cn,
  toast,
} from "@/components/ui";
import { SIDE_FILTERS, sideMatches, type SideFilter } from "@/components/content/sides";
import { ModSetsMenu } from "./ModSetsMenu";
import { PerfDialog } from "./PerfDialog";
import { setContentFilter, setContentSort, setUpdateTask, useContentView, type ContentFilter, type ContentSort } from "./contentView";
import { useT, t as tt } from "@/i18n";
import { api, errorMessage, isCancelled } from "@/lib/api";
import { qk, queryClient, useTask, waitForTask } from "@/lib/queries";
import type { ContentItem, ContentKind, ContentUpdate, Instance } from "@/lib/types";
import { registerDropTarget, useDragState } from "@/components/content/dragdrop";
import { contentKey, fileExt, kindExtensions, kindFolder } from "@/components/content/util";
import { ContentRow, GRID, ROW_H, RowSkeleton, SelectBox, SimpleContentRow, type RowActions } from "./ContentRow";
import { useSimple } from "@/lib/mode";
import { startManualDownload } from "@/components/content/install";
import { RefreshButton } from "@/features/instances/RefreshButton";

export type TypeFilter = "all" | ContentKind;
const STATUS: ContentFilter[] = ["updates", "enabled", "disabled"];
const SORTS: ContentSort[] = ["name", "version", "recent", "size"];

const discoverType: Record<ContentKind, string> = { mod: "mod", resourcepack: "resourcepack", shader: "shader", datapack: "datapack" };

/** Eindeutiger Schlüssel über alle Arten (gleiche Dateinamen in mods/ und resourcepacks/ sind möglich). */
const itemKey = (kind: ContentKind, file: string) => `${kind}:${contentKey(file)}`;
const keyOf = (c: Pick<ContentItem, "kind" | "file_name">) => itemKey(c.kind, c.file_name);

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

export function InstanceContentTab({ instance, initialType = "all" }: { instance: Instance; initialType?: TypeFilter }) {
  const t = useT();
  const navigate = useNavigate();
  const id = instance.id;
  const vanilla = instance.loader.kind === "vanilla";
  // Simple-Modus: einfache Liste (an/aus, entfernen, aktualisieren), Updates werden automatisch gesucht
  const simple = useSimple();
  const kinds = useMemo<ContentKind[]>(() => (vanilla ? ["resourcepack", "shader"] : ["mod", "resourcepack", "shader"]), [vanilla]);

  // ---------------------------------------------------------------- Daten (alle Arten)
  const lists = useQueries({
    queries: kinds.map((k) => ({ queryKey: qk.content(id, k), queryFn: () => api.contentList(id, k), staleTime: 60_000 })),
  });
  const pending = lists.some((l) => l.isPending);
  const failed = lists.find((l) => l.isError && !l.data);
  const all = useMemo(() => lists.flatMap((l) => l.data ?? []), [lists]);

  // ---------------------------------------------------------------- Updates
  const checked = useContentView((s) => !!s.checked[id]);
  const updTaskId = useContentView((s) => s.tasks[id]);
  const updTask = useTask(updTaskId);
  const updatesQ = useQuery({
    queryKey: qk.contentUpdates(id),
    queryFn: () => api.contentCheckUpdates(id),
    enabled: checked || simple,
    staleTime: 10 * 60_000,
  });
  const updates = useMemo(() => {
    const m = new Map<string, ContentUpdate>();
    for (const u of updatesQ.data ?? []) m.set(itemKey(u.kind, u.file_name), u);
    return m;
  }, [updatesQ.data]);
  // CurseForge-Projekte ohne Freigabe für andere Launcher (Markierung in der Tabelle)
  const manualQ = useQuery({ queryKey: ["content", id, "manual-projects"], queryFn: () => api.contentManualProjects(id), staleTime: 30 * 60_000, retry: 0 });
  const manualProjects = useMemo(() => new Set(manualQ.data ?? []), [manualQ.data]);
  // Updates prüfen: „Neu prüfen“ in der Werkzeugleiste (RefreshButton) – prüft zugleich Ordner und Probleme

  // ---------------------------------------------------------------- Suche / Filter / Sortierung
  const [text, setText] = useState("");
  const [type, setType] = useState<TypeFilter>(() => (initialType !== "all" && !kinds.includes(initialType) ? "all" : initialType));
  useEffect(() => setType(initialType !== "all" && !kinds.includes(initialType) ? "all" : initialType), [initialType, kinds]);
  const storedFilter = useContentView((s) => s.filter[id] ?? "all");
  // „Updates“ erst, wenn Update-Daten da sind (eigene Prüfung oder bereits geladen, z. B. von der Startseite)
  const known = checked || !!updatesQ.data;
  const status: ContentFilter = storedFilter === "updates" && !known ? "all" : storedFilter;
  const setStatus = (f: ContentFilter) => setContentFilter(id, f);
  const sort = useContentView((s) => s.sort);
  const [desc, setDesc] = useState(false);
  const [sideFilter, setSideFilter] = useState<SideFilter>("all");
  // Der Seiten-Filter gilt nur für Mods und erscheint nur im Mods-Filter
  useEffect(() => {
    if (type !== "mod") setSideFilter("all");
  }, [type]);
  const [perfOpen, setPerfOpen] = useState(false);

  const sorted = useMemo(() => {
    const byName = (a: ContentItem, b: ContentItem) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    const cmp =
      sort === "recent"
        ? (a: ContentItem, b: ContentItem) => b.modified - a.modified || byName(a, b)
        : sort === "size"
          ? (a: ContentItem, b: ContentItem) => b.size - a.size || byName(a, b)
          : sort === "version"
            ? (a: ContentItem, b: ContentItem) => (a.version ?? "").localeCompare(b.version ?? "", undefined, { numeric: true }) || byName(a, b)
            : byName;
    const list = [...all].sort(cmp);
    return desc ? list.reverse() : list;
  }, [all, sort, desc]);
  const typed = useMemo(() => (type === "all" ? sorted : sorted.filter((c) => c.kind === type)), [sorted, type]);
  const counts = useMemo(() => {
    const byKind: Record<string, number> = {};
    for (const c of all) byKind[c.kind] = (byKind[c.kind] ?? 0) + 1;
    let on = 0;
    for (const c of typed) if (c.enabled) on++;
    return {
      all: all.length,
      kind: byKind,
      enabled: on,
      disabled: typed.length - on,
      updates: typed.filter((c) => updates.has(keyOf(c))).length,
      updatesAll: all.filter((c) => updates.has(keyOf(c))).length,
    };
  }, [all, typed, updates]);
  const visible = useMemo(() => {
    const needle = text.trim().toLowerCase();
    return typed.filter((c) => {
      if (status === "enabled" && !c.enabled) return false;
      if (status === "disabled" && c.enabled) return false;
      if (status === "updates" && !updates.has(keyOf(c))) return false;
      if (c.kind === "mod" && !sideMatches(sideFilter, c.side)) return false;
      if (!needle) return true;
      return c.name.toLowerCase().includes(needle) || c.file_name.toLowerCase().includes(needle) || c.authors.some((a) => a.toLowerCase().includes(needle));
    });
  }, [typed, text, status, updates, sideFilter]);

  /** Spaltenkopf: gleicher Schlüssel -> Richtung umkehren, sonst aufsteigend sortieren. */
  const sortBy = (s: ContentSort) => {
    if (s === sort) setDesc((d) => !d);
    else {
      setContentSort(s);
      setDesc(false);
    }
  };

  // ---------------------------------------------------------------- Auswahl
  const [selection, setSelection] = useState<Set<string>>(() => new Set());
  const anchor = useRef<string | null>(null);
  // Auswahl auf vorhandene Einträge beschränken
  useEffect(() => {
    if (!selection.size) return;
    const keys = new Set(all.map(keyOf));
    let changed = false;
    const next = new Set<string>();
    for (const k of selection) (keys.has(k) ? next.add(k) : (changed = true));
    if (changed) setSelection(next);
  }, [all, selection]);

  const state = useRef({ visible, selection, all, updates });
  state.current = { visible, selection, all, updates };

  const byKeys = (keys: Iterable<string>) => {
    const set = new Set(keys);
    return state.current.all.filter((c) => set.has(keyOf(c)));
  };

  // ---------------------------------------------------------------- Aktionen (je Eintrag nach Art)
  const setEnabled = useCallback(
    async (items: ContentItem[], enabled: boolean) => {
      const targets = items.filter((i) => i.enabled !== enabled);
      if (!targets.length) return;
      const keys = new Set(targets.map(keyOf));
      for (const k of new Set(targets.map((i) => i.kind))) {
        await queryClient.cancelQueries({ queryKey: qk.content(id, k) });
        queryClient.setQueryData<ContentItem[]>(qk.content(id, k), (l) => l?.map((c) => (keys.has(keyOf(c)) ? { ...c, enabled } : c)));
      }
      let failedN = 0;
      let lastErr: unknown;
      for (let i = 0; i < targets.length; i += 8) {
        await Promise.all(
          targets.slice(i, i + 8).map((it) =>
            api
              .contentSetEnabled(id, it.kind, it.file_name, enabled)
              .then((r) => queryClient.setQueryData<ContentItem[]>(qk.content(id, it.kind), (l) => l?.map((c) => (keyOf(c) === keyOf(it) ? r : c))))
              .catch((e) => {
                failedN++;
                lastErr = e;
              }),
          ),
        );
      }
      if (failedN) {
        toast.error(lastErr, tt("content.toggle_failed", { n: failedN }));
        queryClient.invalidateQueries({ queryKey: ["content", id] });
      }
    },
    [id],
  );

  const setPinned = useCallback(
    async (items: ContentItem[], pinned: boolean) => {
      const targets = items.filter((i) => i.pinned !== pinned);
      if (!targets.length) return;
      const keys = new Set(targets.map(keyOf));
      for (const k of new Set(targets.map((i) => i.kind)))
        queryClient.setQueryData<ContentItem[]>(qk.content(id, k), (l) => l?.map((c) => (keys.has(keyOf(c)) ? { ...c, pinned } : c)));
      try {
        for (const it of targets) await api.contentSetPinned(id, it.kind, it.file_name, pinned);
      } catch (e) {
        toast.error(e);
      }
      queryClient.invalidateQueries({ queryKey: ["content", id] });
      queryClient.invalidateQueries({ queryKey: qk.contentUpdates(id) });
    },
    [id],
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
      const keys = new Set(items.map(keyOf));
      setSelection((s) => new Set([...s].filter((k) => !keys.has(k))));
      for (const k of new Set(items.map((i) => i.kind))) {
        queryClient.setQueryData<ContentItem[]>(qk.content(id, k), (l) => l?.filter((c) => !keys.has(keyOf(c))));
        try {
          await api.contentRemove(
            id,
            k,
            items.filter((i) => i.kind === k).map((i) => i.file_name),
          );
        } catch (e) {
          toast.error(e, tt("content.remove_failed"));
        }
      }
      queryClient.invalidateQueries({ queryKey: ["content", id] });
    },
    [id],
  );

  const update = useCallback(
    async (all: ContentItem[]) => {
      if (!all.length) return;
      // Gesperrte CurseForge-Downloads nie automatisch – überspringen und danach nennen
      const isManual = (i: ContentItem) => !!state.current.updates.get(keyOf(i))?.manual;
      const items = all.filter((i) => !isManual(i));
      const manualN = all.length - items.length;
      const skipped = manualN ? (manualN === 1 ? tt("manual.updates_skipped_1") : tt("manual.updates_skipped", { n: manualN })) : null;
      const showManual = { label: tt("manual.show"), onClick: () => setContentFilter(id, "updates") };
      if (!items.length) {
        toast.info(skipped, tt("manual.updates_skipped_text"), showManual, 8000);
        return;
      }
      try {
        const taskId = await api.contentUpdate(
          id,
          items.map((i) => i.file_name),
        );
        setUpdateTask(id, taskId);
        waitForTask(taskId)
          .then(() => {
            if (skipped) toast.success(tt("content.updated", { n: items.length }), skipped, showManual);
            else toast.success(tt("content.updated", { n: items.length }));
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

  const openFolder = useCallback(
    (kind: ContentKind) => {
      api.instanceOpenFolder(id, kindFolder[kind]).catch((e) => toast.error(e));
    },
    [id],
  );

  const addFiles = async (kind: ContentKind) => {
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
          const a = vis.findIndex((c) => keyOf(c) === anchor.current);
          const b = vis.findIndex((c) => keyOf(c) === key);
          if (a !== -1 && b !== -1) {
            const [lo, hi] = a < b ? [a, b] : [b, a];
            const next = e.ctrlKey || e.metaKey ? new Set(sel) : new Set<string>();
            for (let i = lo; i <= hi; i++) next.add(keyOf(vis[i]));
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
      setPinned: (items, v) => void setPinned(items, v),
      update: (items) => void update(items),
      manualUpdate: (item) => {
        const u = state.current.updates.get(keyOf(item));
        if (!u) return;
        startManualDownload(id, { source: u.source, id: u.project_id, title: item.name }, u.new_version.id).catch(() => {});
      },
      remove: (items) => void remove(items),
      openProject: (item) =>
        item.source && item.project_id && navigate({ to: "/discover", search: discoverSearchFor(item.source, item.project_id, id, item.kind === "resourcepack" ? "resourcepack" : item.kind === "shader" ? "shader" : item.kind === "datapack" ? "datapack" : "mod") }),
      openFolder,
      hasUpdate: (item) => state.current.updates.has(keyOf(item)),
      isManualUpdate: (item) => !!state.current.updates.get(keyOf(item))?.manual,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setEnabled, setPinned, update, remove, openFolder, navigate, id],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "a") {
      e.preventDefault();
      setSelection(new Set(visible.map(keyOf)));
    } else if (e.key === "Escape" && selection.size) {
      setSelection(new Set());
    } else if (e.key === "Delete" && selection.size) {
      e.preventDefault();
      void remove(byKeys(selection));
    }
  };

  // ---------------------------------------------------------------- Drag & Drop auf die Liste
  const zipKind: ContentKind = type === "shader" ? "shader" : "resourcepack";
  const dropKinds = useMemo<ContentKind[]>(() => (type === "all" ? (vanilla ? ["resourcepack"] : ["mod", "resourcepack"]) : [type]), [type, vanilla]);
  const dropId = useId();
  const dropRef = useRef<HTMLDivElement>(null);
  const over = useDragState((s) => s.over === dropId);
  useEffect(() => {
    const el = dropRef.current;
    if (!el) return;
    const kindFor = (p: string): ContentKind | null => {
      const ext = fileExt(p);
      if (ext === "jar") return dropKinds.includes("mod") ? "mod" : null;
      if (ext === "zip") return dropKinds.includes(zipKind) || type === "all" ? zipKind : null;
      return null;
    };
    return registerDropTarget({
      id: dropId,
      el,
      accepts: (paths) => paths.some((p) => kindFor(p) !== null),
      onDrop: (paths) => {
        for (const k of ["mod", "resourcepack", "shader"] as ContentKind[]) {
          const mine = paths.filter((p) => kindFor(p) === k);
          if (mine.length) void addContentFiles(id, k, mine);
        }
      },
    });
  }, [dropId, id, dropKinds, zipKind, type]);

  // ---------------------------------------------------------------- Liste
  const scrollRef = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({
    count: pending ? 0 : visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 10,
  });

  const selItems = selection.size ? byKeys(selection) : [];
  const selUpdates = selItems.filter((c) => updates.has(keyOf(c)));
  const updatesRunning = updTask?.status === "running";
  const empty = !pending && all.length === 0;
  const addKind: ContentKind = type === "all" ? (vanilla ? "resourcepack" : "mod") : type;
  const toDiscover = () => navigate({ to: "/discover", search: { instance: id, type: discoverType[addKind] as never } });

  const allVisibleSelected = visible.length > 0 && visible.every((c) => selection.has(keyOf(c)));
  const headState: "on" | "off" | "mixed" = selection.size === 0 ? "off" : allVisibleSelected ? "on" : "mixed";
  const total = type === "all" ? counts.all : (counts.kind[type] ?? 0);
  const activeFilters = (status !== "all" ? 1 : 0) + (sideFilter !== "all" ? 1 : 0);

  const addFilesMenu = (
    <>
      {kinds.map((k) => (
        <DropdownItem key={k} icon={<FilePlus2 size={14} />} onSelect={() => void addFiles(k)}>
          {t(`content.add_files.${k}`)} …
        </DropdownItem>
      ))}
    </>
  );

  return (
    <div className="@container flex h-full min-h-0 flex-col gap-3 px-6 pb-4 pt-4 outline-none" tabIndex={-1} onKeyDown={onKeyDown}>
      {/* 1. Suche + Hinzufügen (leer: alles steht im Leerzustand, keine „0 Inhalte durchsuchen“-Suche) */}
      {!empty && (
      <div className="flex shrink-0 items-center gap-2">
        <SearchInput
          value={text}
          onChange={setText}
          placeholder={t("ipage.ct.search", { n: total })}
          className="min-w-[160px] flex-1"
        />
        {!simple && (
          <DropdownMenu
            trigger={
              <Button variant="ghost" data-tour="content-add-files" icon={<FilePlus2 size={15} />} className="data-[state=open]:bg-surface3">
                <span className="hidden @min-[760px]:inline">{t("content.add_files_short")}</span>
                <ChevronDown size={14} className="text-dim" />
              </Button>
            }
          >
            {addFilesMenu}
          </DropdownMenu>
        )}
        <Button variant="accent" data-tour="content-add" icon={<Plus size={16} />} onClick={toDiscover}>
          {t("content.add")}
        </Button>
      </div>
      )}

      {/* 2. Sortierung, Filter-Chips, Aktionen */}
      {!empty && (
        <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-2">
          {!simple && (
            <>
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
            </>
          )}
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
          {!simple && (
            <>
          <span className="h-5 w-px bg-line2" />
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t("ipage.filter.status")}>
            {STATUS.filter((f) => f !== "updates" || known).map((f) => (
              <FilterChip
                key={f}
                active={status === f}
                tone={f === "updates" ? "accent" : undefined}
                onClick={() => setStatus(status === f ? "all" : f)}
                count={q(counts, f)}
              >
                {f === "updates" ? t("ipage.ct.updates") : t(`content.filter.${f}`)}
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
              {SIDE_FILTERS.map((f) => (
                <DropdownCheckItem key={f} checked={sideFilter === f} onCheckedChange={() => setSideFilter(f)}>
                  {t(`side.filter.${f}`)}
                </DropdownCheckItem>
              ))}
            </DropdownMenu>
          )}
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
              }}
            >
              <X size={14} />
            </IconButton>
          )}
            </>
          )}
          {/* Rechte Gruppe bleibt zusammen und rechtsbündig, auch wenn die Zeile umbricht */}
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {counts.updatesAll > 0 && (
            <Button
              size="sm"
              variant="subtle"
              data-tour="content-update"
              className="px-2.5 text-accent hover:bg-accent hover:text-[var(--on-accent)]"
              icon={updatesRunning ? <Spinner size={12} /> : <RefreshCw size={14} />}
              disabled={updatesRunning}
              onClick={() => update(all.filter((c) => updates.has(keyOf(c))))}
            >
              {updatesRunning && updTask?.progress != null ? `${Math.round(updTask.progress * 100)}%` : t(simple ? "ipage.ct.update_all" : "ipage.update_n", { n: counts.updatesAll })}
            </Button>
          )}
          {/* Neu prüfen: Ordner neu einlesen, Updates ohne Cache, Probleme (auch Loader) – auch per F5. Behält seinen Text;
              Mod-Sets/Werkzeuge zeigen ihren erst ab 1240px, damit die Leiste bei 1280er-Fenstern einzeilig bleibt */}
          <RefreshButton instanceId={id} />
          {!simple && <ModSetsMenu instanceId={id} labelClassName="hidden @min-[1240px]:inline" />}
          {!simple && (
          <DropdownMenu
            trigger={
              <Button size="sm" variant="subtle" icon={<SlidersHorizontal size={14} />} title={t("ipage.tools")} className="px-2.5 data-[state=open]:bg-white/[.07] data-[state=open]:text-text">
                <span className="hidden @min-[1240px]:inline">{t("ipage.tools")}</span>
              </Button>
            }
          >
            {!vanilla && (
              <>
                <DropdownItem icon={<Gauge size={14} />} onSelect={() => setPerfOpen(true)}>
                  {t("perf.title")} …
                </DropdownItem>
                <DropdownSeparator />
              </>
            )}
            {addFilesMenu}
            <DropdownSeparator />
            {kinds.map((k) => (
              <DropdownItem key={k} icon={<FolderOpen size={14} />} onSelect={() => openFolder(k)}>
                {t("ipage.ct.open_folder", { folder: kindFolder[k] })}
              </DropdownItem>
            ))}
          </DropdownMenu>
          )}
          </div>
        </div>
      )}
      {perfOpen && <PerfDialog instance={instance} onClose={() => setPerfOpen(false)} />}

      {/* 3. Tabelle */}
      {/* Außen: Ablagefläche über die ganze Höhe; innen: Tabelle nur so hoch wie ihre Zeilen (keine leere Riesenbox
          unter drei Shadern). Leer: gestrichelter Rahmen = „hier ablegen“. */}
      <div ref={dropRef} className="relative flex min-h-0 flex-1 flex-col">
      <div
        data-tour="content-list"
        className={cn(
          "flex min-h-0 flex-col overflow-hidden rounded-card border bg-panel",
          empty ? "flex-1 border-dashed border-line2" : failed || pending || visible.length === 0 ? "flex-1 border-line" : "flex-initial border-line",
        )}
      >
        {failed ? (
          <ErrorState error={failed.error} onRetry={() => lists.forEach((l) => l.refetch())} />
        ) : empty ? (
          <EmptyState
            icon={<PackagePlus size={30} />}
            title={t("ipage.ct.empty")}
            text={t(vanilla ? "ipage.ct.empty.resourcepack" : "ipage.ct.empty.mod")}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="accent" data-tour="content-add" icon={<Plus size={15} />} onClick={toDiscover}>
                  {t("content.add")}
                </Button>
                {!simple && (
                <>
                <DropdownMenu
                  trigger={
                    <Button variant="ghost" data-tour="content-add-files" icon={<FilePlus2 size={15} />}>
                      {t("content.add_files_short")}
                    </Button>
                  }
                >
                  {addFilesMenu}
                </DropdownMenu>
                {!vanilla && (
                  <Button variant="ghost" icon={<Gauge size={15} />} onClick={() => setPerfOpen(true)}>
                    {t("perf.title")}
                  </Button>
                )}
                <Button variant="subtle" icon={<FolderOpen size={15} />} onClick={() => openFolder(addKind)}>
                  {t("common.open_folder")}
                </Button>
                </>
                )}
                {/* Dateien von Hand in den Ordner gelegt? -> neu einlesen */}
                <RefreshButton instanceId={id} variant="empty" />
              </div>
            }
          />
        ) : (
          <>
            {/* Spaltenköpfe (Simple: keine) */}
            {!simple && (
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
            )}

            {pending ? (
              <div className="min-h-0 flex-1 overflow-hidden">
                {Array.from({ length: 10 }, (_, i) => (
                  <RowSkeleton key={i} />
                ))}
              </div>
            ) : visible.length === 0 ? (
              <EmptyState
                className="border-t border-line"
                icon={<SearchX size={28} />}
                title={t("content.no_match")}
                text={t("content.no_match_text")}
                action={
                  <Button
                    size="sm"
                    onClick={() => {
                      setText("");
                      setStatus("all");
                      setSideFilter("all");
                      setType("all");
                    }}
                  >
                    {t("ipage.filter.reset")}
                  </Button>
                }
              />
            ) : (
              <div ref={scrollRef} className="scroll min-h-0 flex-1" role="grid" aria-multiselectable>
                <div className="relative" style={{ height: v.getTotalSize() }}>
                  {v.getVirtualItems().map((it) => {
                    const item = visible[it.index];
                    const key = keyOf(item);
                    return (
                      <div key={key} className="absolute inset-x-0" style={{ top: it.start, height: ROW_H }}>
                        {simple ? (
                          <SimpleContentRow item={item} update={updates.get(key)} actions={actions} />
                        ) : (
                        <ContentRow
                          item={item}
                          itemKey={key}
                          selected={selection.has(key)}
                          update={updates.get(key)}
                          manual={item.source === "curseforge" && !!item.project_id && (manualProjects.has(item.project_id) || !!updates.get(key)?.manual)}
                          actions={actions}
                          showKind={type === "all"}
                        />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>

        {/* Sammelaktionen: schwebende Leiste bei Auswahl */}
        {selection.size > 0 && (
          <div className="absolute inset-x-0 bottom-3 z-10 flex justify-center px-3">
            <div className="flex items-center gap-0.5 rounded-card bg-overlay p-1 pl-3 shadow-e2 animate-slide-up">
              <span className="mr-2 text-[13px] font-semibold text-text">{t("content.selected", { n: selection.size })}</span>
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
              <span className="mx-1 h-5 w-px bg-line2" />
              <IconButton label={t("content.clear_selection")} tip variant="ghost" size="sm" onClick={() => setSelection(new Set())}>
                <X size={14} />
              </IconButton>
            </div>
          </div>
        )}

        {over && (
          <div className="pointer-events-none absolute inset-2 z-20 flex flex-col items-center justify-center gap-2.5 border-2 border-dashed border-accent bg-black/80 animate-fade-in">
            <Upload size={26} className="text-accent" />
            <div className="text-[16px] font-semibold text-text">{t("ipage.ct.drop")}</div>
            <div className="text-[13px] text-muted">
              {dropKinds.map((k) => t(`content.kind.${k === "resourcepack" || k === "shader" ? zipKind : k}`)).filter((x, i, a) => a.indexOf(x) === i).join(" · ")} · {instance.name}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Zähler eines Status-Filters (für den Chip). */
function q(c: { enabled: number; disabled: number; updates: number }, f: ContentFilter): number {
  return f === "enabled" ? c.enabled : f === "disabled" ? c.disabled : f === "updates" ? c.updates : 0;
}

function FilterChip({ active, onClick, count, tone, children }: { active: boolean; onClick: () => void; count?: number; tone?: "accent"; children: ReactNode }) {
  return (
    <button
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "flex h-8 items-center gap-1.5 rounded-pill px-2.5 text-[13px] font-semibold transition-colors duration-100",
        active ? (tone === "accent" ? "bg-accent text-[var(--on-accent)]" : "bg-surface3 text-text") : "bg-surface text-muted hover:bg-surface2 hover:text-text",
      )}
    >
      {children}
      {count !== undefined && (
        <span className={cn("text-[12px] font-medium tabular-nums", active ? "opacity-70" : tone === "accent" && count ? "text-accent" : "text-dim")}>{count}</span>
      )}
    </button>
  );
}

function ColumnHead({ active, desc, onClick, children }: { active: boolean; desc: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      role="columnheader"
      aria-sort={active ? (desc ? "descending" : "ascending") : "none"}
      onClick={onClick}
      className={cn("flex min-w-0 items-center gap-1 justify-self-start text-left transition-colors hover:text-text", active && "text-text")}
    >
      {children}
      {active && (desc ? <ChevronDown size={14} /> : <ChevronUp size={14} />)}
    </button>
  );
}

function BarButton({ icon, children, onClick, disabled, danger }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-8 items-center gap-1.5 rounded-ctl px-2.5 text-[13px] font-medium transition-colors duration-100 disabled:pointer-events-none disabled:opacity-35",
        danger ? "text-danger hover:bg-danger/10" : "text-text hover:bg-white/[.07]",
      )}
    >
      {icon}
      {children}
    </button>
  );
}
