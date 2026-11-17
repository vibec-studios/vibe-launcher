// Tab „Configs“ einer Instanz: links Dateibaum (config/, defaultconfigs/, options*.txt) mit Namensfilter und
// Volltextsuche, rechts der CodeMirror-Editor (lazy geladen) mit Prüfung, Speichern (Strg+S), Verwerfen
// und Zurücksetzen auf die letzte Sicherung. Ungespeicherte Änderungen werden vor dem Wechsel abgefragt.
import { Suspense, lazy, memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useBlocker } from "@tanstack/react-router";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ChevronsDownUp,
  File,
  FileBraces,
  FileCode,
  FileText,
  Folder,
  FolderOpen,
  History,
  RefreshCw,
  Save,
  Undo2,
} from "lucide-react";
import { api } from "@/lib/api";
import type { ConfigEntry, ConfigFile, ConfigSearchHit, ConfigValidationError, Instance } from "@/lib/types";
import { formatBytes, formatRelative } from "@/lib/format";
import { Button, EmptyState, ErrorState, IconButton, SearchInput, Segmented, Skeleton, Spinner, Tag, Tooltip, cn, confirm, toast } from "@/components/ui";
import { useT } from "@/i18n";
import type { ConfigEditorHandle } from "./ConfigEditor";

const ConfigEditor = lazy(() => import("./ConfigEditor"));

const ROW_H = 28;
const CHECKED = new Set(["json", "json5", "toml"]);
const treeKey = (id: string) => ["config-tree", id] as const;

const baseName = (p: string) => p.slice(p.lastIndexOf("/") + 1);
const dirName = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
function ancestors(p: string): string[] {
  const out: string[] = [];
  let d = dirName(p);
  while (d) {
    out.push(d);
    d = dirName(d);
  }
  return out;
}

function FileIcon({ entry, open }: { entry: ConfigEntry; open?: boolean }) {
  if (entry.is_dir) return open ? <FolderOpen size={14} className="shrink-0 text-muted" /> : <Folder size={14} className="shrink-0 text-muted" />;
  const ext = entry.path.slice(entry.path.lastIndexOf(".") + 1).toLowerCase();
  if (ext === "json" || ext === "json5" || ext === "mcmeta") return <FileBraces size={14} className="shrink-0 text-[#ffb547]" />;
  if (ext === "toml" || ext === "yaml" || ext === "yml" || ext === "ini" || ext === "properties" || ext === "cfg" || ext === "conf")
    return <FileCode size={14} className="shrink-0 text-[#8fb4ff]" />;
  if (entry.binary) return <File size={14} className="shrink-0 text-dim" />;
  return <FileText size={14} className="shrink-0 text-muted" />;
}

interface Row {
  entry: ConfigEntry;
  depth: number;
  open: boolean;
}

/** Sichtbare Zeilen des Baums (Ordner zuerst, dann alphabetisch). Mit Filter: Treffer + ihre Ordner, alles offen. */
function buildRows(entries: ConfigEntry[], expanded: Set<string>, filter: string): Row[] {
  const children = new Map<string, ConfigEntry[]>();
  for (const e of entries) {
    const p = dirName(e.path);
    let l = children.get(p);
    if (!l) children.set(p, (l = []));
    l.push(e);
  }
  for (const l of children.values())
    l.sort((a, b) => (a.is_dir === b.is_dir ? baseName(a.path).localeCompare(baseName(b.path), undefined, { sensitivity: "base" }) : a.is_dir ? -1 : 1));
  let keep: Set<string> | null = null;
  if (filter) {
    keep = new Set();
    for (const e of entries) {
      if (!e.is_dir && baseName(e.path).toLowerCase().includes(filter)) {
        keep.add(e.path);
        for (const a of ancestors(e.path)) keep.add(a);
      }
    }
  }
  const rows: Row[] = [];
  const walk = (dir: string, depth: number) => {
    for (const e of children.get(dir) ?? []) {
      if (keep && !keep.has(e.path)) continue;
      const open = e.is_dir && (keep ? true : expanded.has(e.path));
      rows.push({ entry: e, depth, open });
      if (open) walk(e.path, depth + 1);
    }
  };
  walk("", 0);
  return rows;
}

const TreeRow = memo(function TreeRow({
  row,
  active,
  dirty,
  onClick,
}: {
  row: Row;
  active: boolean;
  dirty: boolean;
  onClick: (row: Row) => void;
}) {
  const e = row.entry;
  return (
    <button
      onClick={() => onClick(row)}
      title={e.path}
      className={cn(
        "flex h-full w-full items-center gap-1.5 pr-2 text-left text-[13px] transition-colors duration-100",
        active ? "bg-surface3 text-white shadow-[inset_2px_0_0_var(--accent)]" : "text-text hover:bg-white/[.04]",
        e.binary && "text-dim",
      )}
      style={{ paddingLeft: 8 + row.depth * 14 }}
    >
      {e.is_dir ? (
        <ChevronRight size={13} className={cn("shrink-0 text-dim transition-transform duration-100", row.open && "rotate-90")} />
      ) : (
        <span className="w-[13px] shrink-0" />
      )}
      <FileIcon entry={e} open={row.open} />
      <span className="min-w-0 flex-1 truncate">{baseName(e.path)}</span>
      {dirty && <span className="h-1.5 w-1.5 shrink-0 bg-warn" />}
      {!e.is_dir && e.has_backup && <History size={11} className="shrink-0 text-dim" />}
    </button>
  );
});

function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const lower = text.toLowerCase();
  const out: ReactNode[] = [];
  let i = 0;
  let n = 0;
  while (i < text.length) {
    const j = lower.indexOf(q, i);
    if (j < 0) {
      out.push(text.slice(i));
      break;
    }
    if (j > i) out.push(text.slice(i, j));
    out.push(
      <mark key={n++} className="bg-warn/25 text-white">
        {text.slice(j, j + q.length)}
      </mark>,
    );
    i = j + q.length;
  }
  return <>{out}</>;
}

function SearchResults({
  instanceId,
  query,
  onOpen,
}: {
  instanceId: string;
  query: string;
  onOpen: (path: string, line: number) => void;
}) {
  const t = useT();
  const q = query.trim();
  const res = useQuery({
    queryKey: ["config-search", instanceId, q],
    queryFn: () => api.configSearch(instanceId, q),
    enabled: q.length >= 2,
    staleTime: 5_000,
  });
  const groups = useMemo(() => {
    const m = new Map<string, ConfigSearchHit[]>();
    for (const h of res.data ?? []) {
      let l = m.get(h.path);
      if (!l) m.set(h.path, (l = []));
      l.push(h);
    }
    return [...m.entries()];
  }, [res.data]);
  if (q.length < 2) return <p className="px-3 py-4 text-[12px] text-dim">{t("configs.search_hint")}</p>;
  if (res.isError) return <ErrorState error={res.error} onRetry={() => res.refetch()} />;
  if (!res.data)
    return (
      <div className="flex flex-col gap-2 px-3 py-3">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-4" style={{ width: `${60 + ((i * 17) % 35)}%` }} />
        ))}
      </div>
    );
  const lq = q.toLowerCase();
  return (
    <div className={cn("flex flex-col pb-3 transition-opacity duration-150", res.isFetching && "opacity-60")}>
      <div className="px-3 py-2 text-[11px] text-dim">
        {res.data.length >= 200 ? t("configs.hits_max", { n: 200 }) : res.data.length ? t("configs.hits", { n: res.data.length }) : t("configs.no_hits")}
      </div>
      {groups.map(([path, hits]) => (
        <div key={path} className="mb-1">
          <div className="flex items-center gap-1.5 px-3 py-1 text-[12px] font-semibold text-white" title={path}>
            <FileText size={12} className="shrink-0 text-dim" />
            <span className="truncate">{path}</span>
          </div>
          {hits.map((h) => (
            <button
              key={h.line}
              onClick={() => onOpen(h.path, h.line)}
              className="flex w-full items-baseline gap-2 px-3 py-0.5 text-left hover:bg-white/[.04]"
            >
              <span className="w-8 shrink-0 text-right font-mono text-[11px] tabular-nums text-dim">{h.line}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-muted">
                <Highlight text={h.text} q={lq} />
              </span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

function FileTree({
  entries,
  selected,
  dirty,
  expanded,
  filter,
  onToggle,
  onOpen,
}: {
  entries: ConfigEntry[];
  selected: string | null;
  dirty: boolean;
  expanded: Set<string>;
  filter: string;
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
}) {
  const t = useT();
  const scroller = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => buildRows(entries, expanded, filter), [entries, expanded, filter]);
  const v = useVirtualizer({ count: rows.length, getScrollElement: () => scroller.current, estimateSize: () => ROW_H, overscan: 16 });
  const onClick = useCallback((r: Row) => (r.entry.is_dir ? onToggle(r.entry.path) : onOpen(r.entry.path)), [onToggle, onOpen]);
  if (!rows.length) return <p className="px-3 py-4 text-[12px] text-dim">{t("configs.no_match")}</p>;
  return (
    <div ref={scroller} className="scroll h-full">
      <div className="relative w-full" style={{ height: v.getTotalSize() }}>
        {v.getVirtualItems().map((it) => {
          const r = rows[it.index];
          return (
            <div key={r.entry.path} className="absolute left-0 top-0 w-full" style={{ height: ROW_H, transform: `translateY(${it.start}px)` }}>
              <TreeRow row={r} active={r.entry.path === selected} dirty={dirty && r.entry.path === selected} onClick={onClick} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EditorFallback() {
  const t = useT();
  return (
    <div className="flex h-full items-center justify-center gap-2 text-[13px] text-dim">
      <Spinner size={14} /> {t("configs.loading_editor")}
    </div>
  );
}

function StatusBar({
  file,
  errors,
  checking,
  onJump,
}: {
  file: ConfigFile;
  errors: ConfigValidationError[];
  checking: boolean;
  onJump: (e: ConfigValidationError) => void;
}) {
  const t = useT();
  const checked = CHECKED.has(file.language) && !file.readonly;
  return (
    <div className="shrink-0 border-t border-line bg-surface">
      {errors.length > 0 && (
        <div className="scroll max-h-[92px] border-b border-line py-1">
          {errors.map((e, i) => (
            <button
              key={i}
              onClick={() => onJump(e)}
              className="flex w-full items-baseline gap-3 px-4 py-0.5 text-left text-[12px] hover:bg-white/[.04]"
            >
              <AlertTriangle size={12} className="shrink-0 translate-y-[2px] text-danger" />
              <span className="shrink-0 font-mono text-[11px] text-danger">{t("configs.error_at", { line: e.line, col: e.column })}</span>
              <span className="min-w-0 flex-1 truncate text-text">{e.message}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex h-8 items-center gap-3 px-4 text-[12px]">
        {!checked ? (
          <span className="text-dim">{t("configs.no_check")}</span>
        ) : checking && !errors.length ? (
          <span className="flex items-center gap-1.5 text-dim">
            <Spinner size={11} /> {t("configs.checking")}
          </span>
        ) : errors.length ? (
          <span className="flex items-center gap-1.5 font-semibold text-danger">
            <AlertTriangle size={13} /> {t("configs.errors", { n: errors.length })}
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-ok">
            <CheckCircle2 size={13} /> {t("configs.ok")}
          </span>
        )}
        <div className="flex-1" />
        <span className="text-dim">{t("configs.shortcuts")}</span>
      </div>
    </div>
  );
}

export function ConfigsTab({ instance }: { instance: Instance }) {
  const t = useT();
  const qc = useQueryClient();
  const id = instance.id;
  const tree = useQuery({ queryKey: treeKey(id), queryFn: () => api.configTree(id) });

  const [mode, setMode] = useState<"name" | "content">("name");
  const [filter, setFilter] = useState("");
  const [query, setQuery] = useState("");
  const dFilter = useDeferredValue(filter.trim().toLowerCase());
  // Volltextsuche entprellt – nicht bei jedem Tastendruck das Backend fragen
  const [dQuery, setDQuery] = useState("");
  useEffect(() => {
    const h = setTimeout(() => setDQuery(query), 250);
    return () => clearTimeout(h);
  }, [query]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["config", "defaultconfigs"]));
  // Beim Umschalten Name/Inhalt das passende Suchfeld fokussieren
  const searchBox = useRef<HTMLDivElement>(null);
  const firstMode = useRef(true);
  useEffect(() => {
    if (firstMode.current) {
      firstMode.current = false;
      return;
    }
    searchBox.current?.querySelector("input")?.focus();
  }, [mode]);

  const [selected, setSelected] = useState<string | null>(null);
  const [file, setFile] = useState<ConfigFile | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<ConfigValidationError[]>([]);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const [initialLine, setInitialLine] = useState<number | null>(null);
  const editor = useRef<ConfigEditorHandle>(null);
  const loadSeq = useRef(0);
  const checkSeq = useRef(0);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const fileRef = useRef<ConfigFile | null>(null);
  fileRef.current = file;

  const askDiscard = useCallback(
    (path: string) =>
      confirm({
        title: t("configs.unsaved.title"),
        text: t("configs.unsaved.text", { name: baseName(path) }),
        confirmLabel: t("configs.unsaved.confirm"),
        danger: true,
      }),
    [t],
  );

  // Tab-/Seitenwechsel mit ungespeicherten Änderungen abfragen
  useBlocker({
    shouldBlockFn: async () => {
      const f = fileRef.current;
      if (!dirtyRef.current || !f) return false;
      return !(await askDiscard(f.path));
    },
    disabled: !dirty,
    enableBeforeUnload: false,
  });

  const validate = useCallback((path: string, language: string, content: string) => {
    const seq = ++checkSeq.current;
    if (!CHECKED.has(language)) {
      setErrors([]);
      setChecking(false);
      return;
    }
    setChecking(true);
    api
      .configValidate(path, content)
      .then((e) => seq === checkSeq.current && setErrors(e))
      .catch(() => seq === checkSeq.current && setErrors([]))
      .finally(() => seq === checkSeq.current && setChecking(false));
  }, []);

  const showFile = useCallback(
    (f: ConfigFile, line: number | null) => {
      setFile(f);
      setDirty(false);
      setErrors([]);
      setInitialLine(line);
      setEditorKey((k) => k + 1);
      if (!f.readonly) validate(f.path, f.language, f.content);
      else setChecking(false);
    },
    [validate],
  );

  const load = useCallback(
    async (path: string, line: number | null) => {
      const seq = ++loadSeq.current;
      setSelected(path);
      setLoading(true);
      setLoadError(null);
      try {
        const f = await api.configRead(id, path);
        if (seq !== loadSeq.current) return;
        showFile(f, line);
      } catch (e) {
        if (seq !== loadSeq.current) return;
        setFile(null);
        setDirty(false);
        setLoadError(e);
      } finally {
        if (seq === loadSeq.current) setLoading(false);
      }
    },
    [id, showFile],
  );

  const open = useCallback(
    async (path: string, line: number | null = null) => {
      const cur = fileRef.current;
      if (cur && cur.path === path) {
        if (line) editor.current?.gotoLine(line);
        return;
      }
      if (dirtyRef.current && cur && !(await askDiscard(cur.path))) return;
      setExpanded((s) => {
        const a = ancestors(path).filter((p) => !s.has(p));
        return a.length ? new Set([...s, ...a]) : s;
      });
      void load(path, line);
    },
    [askDiscard, load],
  );

  const openFile = useCallback((path: string) => void open(path), [open]);
  const toggle = useCallback(
    (path: string) =>
      setExpanded((s) => {
        const n = new Set(s);
        if (n.has(path)) n.delete(path);
        else n.add(path);
        return n;
      }),
    [],
  );

  const save = useCallback(async () => {
    const f = fileRef.current;
    if (!f || f.readonly || !editor.current || saving) return;
    const content = editor.current.getValue();
    if (CHECKED.has(f.language)) {
      const errs = await api.configValidate(f.path, content).catch(() => [] as ConfigValidationError[]);
      setErrors(errs);
      if (
        errs.length &&
        !(await confirm({
          title: t("configs.invalid.title"),
          text: t("configs.invalid.text", { n: errs.length }),
          confirmLabel: t("configs.invalid.confirm"),
          danger: true,
        }))
      )
        return;
    }
    setSaving(true);
    try {
      const nf = await api.configWrite(id, f.path, content);
      // Editor bleibt stehen (Cursor, Verlauf) – nur die Basis für „geändert“ wird neu gesetzt
      setFile(nf);
      editor.current?.markClean();
      setDirty(false);
      toast.success(t("configs.saved"), nf.path);
      void qc.invalidateQueries({ queryKey: treeKey(id) });
      void qc.invalidateQueries({ queryKey: ["config-search", id] });
    } catch (e) {
      toast.error(e, t("configs.save_failed"));
    } finally {
      setSaving(false);
    }
  }, [id, qc, saving, t]);

  const discard = useCallback(() => {
    const f = fileRef.current;
    if (f) showFile(f, null);
  }, [showFile]);

  const restore = useCallback(async () => {
    const f = fileRef.current;
    if (!f) return;
    const ok = await confirm({
      title: t("configs.restore.title"),
      text: (
        <>
          {t("configs.restore.text", { name: baseName(f.path) })}
          {dirtyRef.current && <span className="mt-2 block text-warn">{t("configs.restore.text_dirty")}</span>}
        </>
      ),
      confirmLabel: t("configs.restore"),
    });
    if (!ok) return;
    try {
      const nf = await api.configRestore(id, f.path);
      showFile(nf, null);
      toast.success(t("configs.restored"), nf.path);
      void qc.invalidateQueries({ queryKey: treeKey(id) });
      void qc.invalidateQueries({ queryKey: ["config-search", id] });
    } catch (e) {
      toast.error(e, t("configs.restore_failed"));
    }
  }, [id, qc, showFile, t]);

  // Strg+S (im Editor und außerhalb). app/guards.ts verhindert vorher schon den Browser-Dialog
  // (preventDefault), deshalb sieht CodeMirror die Taste nicht – gespeichert wird nur hier.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (dirtyRef.current) void saveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onContent = useCallback((content: string) => {
    const f = fileRef.current;
    if (f) validate(f.path, f.language, content);
  }, [validate]);

  const entries = tree.data ?? [];
  const fileCount = useMemo(() => entries.filter((e) => !e.is_dir).length, [entries]);
  const reason = file?.readonly_reason ?? null;

  return (
    <div className="flex h-full min-h-0">
      {/* ------------------------------------------------------------ Dateibaum */}
      <aside className="flex w-[300px] shrink-0 flex-col border-r border-line">
        <div ref={searchBox} className="flex shrink-0 flex-col gap-2 border-b border-line p-3">
          <div className="flex items-center gap-2">
            <Segmented
              value={mode}
              onChange={setMode}
              items={[
                { value: "name", label: t("configs.mode.name") },
                { value: "content", label: t("configs.mode.content") },
              ]}
            />
            <div className="flex-1" />
            <Tooltip content={t("configs.collapse_all")}>
              <IconButton label={t("configs.collapse_all")} size="sm" className="border-transparent" onClick={() => setExpanded(new Set(["config", "defaultconfigs"]))}>
                <ChevronsDownUp size={14} />
              </IconButton>
            </Tooltip>
            <Tooltip content={t("configs.reload")}>
              <IconButton label={t("configs.reload")} size="sm" className="border-transparent" onClick={() => tree.refetch()}>
                <RefreshCw size={14} className={cn(tree.isFetching && "animate-spin")} />
              </IconButton>
            </Tooltip>
          </div>
          {mode === "name" ? (
            <SearchInput value={filter} onChange={setFilter} placeholder={t("configs.filter")} className="[&_input]:h-8 [&_input]:text-[13px]" />
          ) : (
            <SearchInput value={query} onChange={setQuery} placeholder={t("configs.search")} className="[&_input]:h-8 [&_input]:text-[13px]" />
          )}
        </div>
        <div className="min-h-0 flex-1">
          {mode === "content" ? (
            <div className="scroll h-full">
              <SearchResults instanceId={id} query={dQuery} onOpen={(p, l) => void open(p, l)} />
            </div>
          ) : tree.isError && !tree.data ? (
            <ErrorState error={tree.error} onRetry={() => tree.refetch()} />
          ) : !tree.data ? (
            <div className="flex flex-col gap-2 p-3">
              {Array.from({ length: 10 }, (_, i) => (
                <Skeleton key={i} className="h-4" style={{ width: `${45 + ((i * 23) % 45)}%`, marginLeft: (i % 3) * 14 }} />
              ))}
            </div>
          ) : !entries.length ? (
            <EmptyState icon={<Folder size={28} />} title={t("configs.empty.title")} text={t("configs.empty.text")} className="py-10" />
          ) : (
            <FileTree entries={entries} selected={selected} dirty={dirty} expanded={expanded} filter={dFilter} onToggle={toggle} onOpen={openFile} />
          )}
        </div>
        {mode === "name" && tree.data && entries.length > 0 && (
          <div className="shrink-0 border-t border-line px-3 py-1.5 text-[11px] text-dim">{t("configs.files", { n: fileCount })}</div>
        )}
      </aside>

      {/* ------------------------------------------------------------ Editor */}
      <section className="flex min-w-0 flex-1 flex-col">
        {!selected ? (
          <EmptyState icon={<FileText size={30} />} title={t("configs.pick.title")} text={t("configs.pick.text")} className="flex-1" />
        ) : loadError && !loading ? (
          <ErrorState error={loadError} onRetry={() => void load(selected, null)} className="flex-1" />
        ) : !file ? (
          <div className="flex flex-1 flex-col">
            <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-4">
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-4 w-72" />
                <Skeleton className="h-3 w-40" />
              </div>
            </div>
            <EditorFallback />
          </div>
        ) : (
          <>
            <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-mono text-[13px] font-medium text-white" title={file.path}>
                    {file.path}
                  </span>
                  {dirty && <Tag color="#ffb547">{t("configs.dirty")}</Tag>}
                  {loading && <Spinner size={12} className="text-dim" />}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[11.5px] text-dim">
                  <span className="uppercase tracking-[.06em]">{file.language}</span>
                  <span>·</span>
                  <span>{formatBytes(file.size)}</span>
                  <span>·</span>
                  <span>
                    {t("configs.modified")} {formatRelative(file.modified)}
                  </span>
                  {file.has_backup && (
                    <>
                      <span>·</span>
                      <span className="flex items-center gap-1">
                        <History size={11} /> {t("configs.has_backup")}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <Tooltip content={file.has_backup ? t("configs.restore.tip") : t("configs.restore.none")}>
                <span>
                  <Button size="sm" variant="subtle" icon={<History size={13} />} disabled={!file.has_backup || reason === "binary" || reason === "too_large"} onClick={restore}>
                    {t("configs.restore")}
                  </Button>
                </span>
              </Tooltip>
              <Button size="sm" icon={<Undo2 size={13} />} disabled={!dirty} onClick={discard}>
                {t("configs.discard")}
              </Button>
              <Button size="sm" variant="accent" icon={<Save size={13} />} disabled={!dirty || file.readonly} loading={saving} onClick={() => void save()}>
                {t("configs.save")}
              </Button>
            </div>
            {reason && (
              <div className="flex shrink-0 items-center gap-3 border-b border-warn/25 bg-warn/[.07] px-4 py-2 text-[12.5px] text-text">
                <AlertTriangle size={14} className="shrink-0 text-warn" />
                <span className="min-w-0 flex-1">{t(`configs.readonly.${reason}`)}</span>
                <Button size="sm" variant="ghost" icon={<FolderOpen size={13} />} onClick={() => api.instanceOpenFolder(id, dirName(file.path) || null).catch((e) => toast.error(e))}>
                  {t("configs.open_folder")}
                </Button>
              </div>
            )}
            <div className="relative min-h-0 flex-1">
              {reason === "binary" || reason === "too_large" ? (
                <EmptyState icon={<File size={30} />} title={baseName(file.path)} text={formatBytes(file.size)} className="h-full" />
              ) : (
                <Suspense fallback={<EditorFallback />}>
                  <ConfigEditor
                    key={editorKey}
                    ref={editor}
                    initial={file.content}
                    language={file.language}
                    readOnly={file.readonly}
                    initialLine={initialLine}
                    errors={errors}
                    onDirty={setDirty}
                    onContent={onContent}
                  />
                </Suspense>
              )}
            </div>
            {reason !== "binary" && reason !== "too_large" && (
              <StatusBar file={file} errors={errors} checking={checking} onJump={(e) => editor.current?.gotoLine(e.line, e.column)} />
            )}
          </>
        )}
      </section>
    </div>
  );
}
