// Datei-Bereich einer Instanz bzw. eines lokalen Servers: oben die „Häufig“-Leiste, links Dateibaum (oder
// Namens-/Volltextsuche), rechts Editor/Vorschau. Dateiaktionen über Kontextmenü, Werkzeugleiste und Tastenkürzel;
// Dateien lassen sich aus dem Explorer hineinziehen. Ungespeicherte Änderungen werden vor jedem Wechsel abgefragt.
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
import { ChevronsDownUp, FilePlus, FileText, FolderInput, FolderPlus, FolderTree, RefreshCw, Upload } from "lucide-react";
import { api } from "@/lib/api";
import type { FileContent, FileEntry, FileScope, FileSearchHit, FileValidationError } from "@/lib/types";
import {
  Button,
  ContextMenu,
  Dialog,
  DropdownItem,
  DropdownMenu,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  SearchInput,
  Segmented,
  Skeleton,
  Tooltip,
  cn,
  confirm,
  toast,
} from "@/components/ui";
import { registerDropTarget, useDragState } from "@/components/content/dragdrop";
import { useT } from "@/i18n";
import type { CodeEditorHandle } from "./CodeEditor";
import { CHECKED, FilePane } from "./FilePane";
import { FileTree, RootMenu, buildRows, targetDir, type FileActions, type FileTreeHandle } from "./FileTree";
import { FileIcon, ancestors, baseName, copyText, dirName, fkeys, isInside } from "./util";
import { PageTools } from "@/features/instances/toolbar";

export interface QuickItem {
  path: string;
  /** Anzeigename (Standard: Dateiname, Ordner mit „/“) */
  label?: string;
}

export interface FilesBrowserProps {
  scope: FileScope;
  /** Spiel bzw. Server läuft gerade -> Warnung im Editor */
  running: boolean;
  runningText: string;
  /** Schnelleinstiege; nur vorhandene werden gezeigt */
  quick: QuickItem[];
  /** Beim ersten Öffnen aufgeklappte Ordner */
  initialExpanded?: string[];
}

type NameDialog = { kind: "file" | "folder"; dir: string } | { kind: "rename"; entry: FileEntry } | null;

// ------------------------------------------------------------------ Kleinteile

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
      <mark key={n++} className="bg-warn/25 text-text">
        {text.slice(j, j + q.length)}
      </mark>,
    );
    i = j + q.length;
  }
  return <>{out}</>;
}

function ListSkeleton({ n = 8 }: { n?: number }) {
  return (
    <div className="flex flex-col gap-2 px-3 py-3">
      {Array.from({ length: n }, (_, i) => (
        <Skeleton key={i} className="h-4" style={{ width: `${45 + ((i * 23) % 45)}%`, marginLeft: (i % 3) * 14 }} />
      ))}
    </div>
  );
}

/** Namenssuche: flache Trefferliste mit Ordnerpfad. */
function FindResults({ scope, query, selected, onPick }: { scope: FileScope; query: string; selected: string | null; onPick: (e: FileEntry) => void }) {
  const t = useT();
  const q = query.trim();
  const res = useQuery({ queryKey: fkeys.find(scope, q), queryFn: () => api.filesFind(scope, q), enabled: q.length >= 2, staleTime: 5_000 });
  if (q.length < 2) return <p className="px-3 py-4 text-[12px] text-dim">{t("files.find_hint")}</p>;
  if (res.isError) return <ErrorState error={res.error} onRetry={() => res.refetch()} />;
  if (!res.data) return <ListSkeleton n={6} />;
  const lq = q.toLowerCase();
  return (
    <div className={cn("flex flex-col pb-3 transition-opacity duration-150", res.isFetching && "opacity-60")}>
      <div className="px-3 py-2 text-[11px] text-dim">
        {res.data.truncated ? t("files.found_max", { n: res.data.entries.length }) : res.data.entries.length ? t("files.found", { n: res.data.entries.length }) : t("files.no_hits")}
      </div>
      {res.data.entries.map((e) => (
        <button
          key={e.path}
          onClick={() => onPick(e)}
          title={e.path}
          className={cn("flex h-8 w-full items-center gap-2 px-3 text-left text-[13px]", selected === e.path ? "bg-surface3 text-text" : "hover:bg-white/[.04]")}
        >
          <FileIcon entry={e} />
          <span className="shrink-0 truncate text-text">
            <Highlight text={e.name} q={lq} />
          </span>
          <span className="min-w-0 flex-1 truncate text-right font-mono text-[11px] text-dim">{dirName(e.path) || "/"}</span>
        </button>
      ))}
    </div>
  );
}

/** Volltextsuche: Treffer nach Datei gruppiert. */
function SearchResults({ scope, query, onOpen }: { scope: FileScope; query: string; onOpen: (path: string, line: number) => void }) {
  const t = useT();
  const q = query.trim();
  const res = useQuery({ queryKey: fkeys.search(scope, q), queryFn: () => api.filesSearch(scope, q), enabled: q.length >= 2, staleTime: 5_000 });
  const groups = useMemo(() => {
    const m = new Map<string, FileSearchHit[]>();
    for (const h of res.data?.hits ?? []) {
      let l = m.get(h.path);
      if (!l) m.set(h.path, (l = []));
      l.push(h);
    }
    return [...m.entries()];
  }, [res.data]);
  if (q.length < 2) return <p className="px-3 py-4 text-[12px] text-dim">{t("files.search_hint")}</p>;
  if (res.isError) return <ErrorState error={res.error} onRetry={() => res.refetch()} />;
  if (!res.data) return <ListSkeleton n={5} />;
  const d = res.data;
  const lq = q.toLowerCase();
  return (
    <div className={cn("flex flex-col pb-3 transition-opacity duration-150", res.isFetching && "opacity-60")}>
      <div className="flex flex-col gap-0.5 px-3 py-2 text-[11px] text-dim">
        <span>
          {d.hits.length >= 200 ? t("files.hits_max", { n: 200 }) : d.hits.length ? t("files.hits", { n: d.hits.length, files: groups.length }) : t("files.no_hits")}
        </span>
        <span>
          {t("files.search_stats", { n: d.files_scanned })}
          {d.files_skipped > 0 && ` · ${t("files.search_skipped", { n: d.files_skipped })}`}
          {d.truncated && d.hits.length < 200 && ` · ${t("files.search_truncated")}`}
        </span>
      </div>
      {groups.map(([path, hits]) => (
        <div key={path} className="mb-1">
          <div className="flex items-center gap-1.5 px-3 py-1 text-[12px] font-semibold text-text" title={path}>
            <FileText size={12} className="shrink-0 text-dim" />
            <span className="truncate">{path}</span>
          </div>
          {hits.map((h) => (
            <button key={h.line} onClick={() => onOpen(h.path, h.line)} className="flex w-full items-baseline gap-2 px-3 py-0.5 text-left hover:bg-white/[.04]">
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

function NameDialogView({ state, onClose, onSubmit }: { state: NameDialog; onClose: () => void; onSubmit: (name: string) => Promise<void> }) {
  const t = useT();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const initial = state?.kind === "rename" ? state.entry.name : "";
  useEffect(() => {
    if (!state) return;
    setName(initial);
    setError(null);
    setBusy(false);
    // Beim Umbenennen nur den Namensteil vor der Endung markieren
    const id = setTimeout(() => {
      const el = input.current;
      if (!el) return;
      el.focus();
      const dot = state.kind === "rename" && !state.entry.is_dir ? initial.lastIndexOf(".") : -1;
      el.setSelectionRange(0, dot > 0 ? dot : initial.length);
    }, 30);
    return () => clearTimeout(id);
  }, [state, initial]);
  const dir = !state ? "" : state.kind === "rename" ? dirName(state.entry.path) : state.dir;
  const title = !state ? "" : state.kind === "file" ? t("files.new_file.title") : state.kind === "folder" ? t("files.new_folder.title") : t("files.rename.title");
  const submit = async () => {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(n);
    } catch (e) {
      // „Ungültige Eingabe: …“ aus dem Backend – hier reicht die eigentliche Meldung
      setError(((e as { message?: string })?.message ?? String(e)).replace(/^Ungültige Eingabe: /, ""));
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={!!state}
      onOpenChange={(o) => !o && onClose()}
      title={title}
      description={t("files.in", { path: dir ? `${dir}/` : t("files.root") })}
      size="sm"
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="accent" loading={busy} disabled={!name.trim() || (state?.kind === "rename" && name.trim() === initial)} onClick={() => void submit()}>
            {state?.kind === "rename" ? t("files.act.rename") : t("files.create")}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label={t("files.name")} error={error}>
          <Input ref={input} value={name} invalid={!!error} onChange={(e) => setName(e.target.value)} placeholder={state?.kind === "folder" ? "neuer-ordner" : "datei.json"} />
        </Field>
      </form>
    </Dialog>
  );
}

// ------------------------------------------------------------------ Hauptkomponente

export function FilesBrowser({ scope, running, runningText, quick, initialExpanded = [] }: FilesBrowserProps) {
  const t = useT();
  const qc = useQueryClient();
  const tree = useRef<FileTreeHandle>(null);
  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: fkeys.all(scope) }), [qc, scope]);

  // ---------------------------------------------------------------- Baum
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(initialExpanded));
  const [selected, setSelected] = useState<string | null>(null);
  const dirList = useMemo(() => ["", ...expanded], [expanded]);
  const dirQueries = useQueries({
    queries: dirList.map((dir) => ({
      queryKey: fkeys.dir(scope, dir),
      queryFn: () => api.filesList(scope, dir),
      staleTime: 15_000,
      retry: dir ? 0 : 1,
    })),
  });
  // Nur neu aufbauen, wenn sich Daten wirklich geändert haben (Liste der Ordner oder ein Abruf)
  const dataKey = dirQueries.map((q) => q.dataUpdatedAt).join(",");
  const dirs = useMemo(() => {
    const m = new Map<string, FileEntry[] | undefined>();
    dirList.forEach((d, i) => m.set(d, dirQueries[i]?.data));
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirList, dataKey]);
  const rootQ = dirQueries[0];
  const rows = useMemo(() => buildRows(dirs, expanded, t("files.empty_dir")), [dirs, expanded, t]);
  const entryByPath = useMemo(() => {
    const m = new Map<string, FileEntry>();
    for (const l of dirs.values()) for (const e of l ?? []) m.set(e.path, e);
    return m;
  }, [dirs]);
  const selEntry = selected ? (entryByPath.get(selected) ?? null) : null;
  const anyFetching = dirQueries.some((q) => q.isFetching);

  const toggle = useCallback((path: string, open?: boolean) => {
    setExpanded((s) => {
      const isOpen = s.has(path);
      const want = open ?? !isOpen;
      if (want === isOpen) return s;
      const n = new Set(s);
      if (want) n.add(path);
      else for (const p of s) if (isInside(p, path)) n.delete(p);
      return n;
    });
  }, []);
  const expandTo = useCallback((path: string, self: boolean) => {
    setExpanded((s) => {
      const want = [...ancestors(path), ...(self ? [path] : [])].filter((p) => !s.has(p));
      return want.length ? new Set([...s, ...want]) : s;
    });
  }, []);
  /** Eintrag im Baum zeigen (Ordner aufklappen, markieren, hinscrollen) */
  const revealInTree = useCallback(
    (path: string, openSelf = false) => {
      expandTo(path, openSelf);
      setSelected(path);
      requestAnimationFrame(() => tree.current?.scrollTo(path));
    },
    [expandTo],
  );

  // ---------------------------------------------------------------- Suche
  const [mode, setMode] = useState<"name" | "content">("name");
  const [filter, setFilter] = useState("");
  const [query, setQuery] = useState("");
  const [dFilter, setDFilter] = useState("");
  const [dQuery, setDQuery] = useState("");
  useEffect(() => {
    const h = setTimeout(() => setDFilter(filter), 200);
    return () => clearTimeout(h);
  }, [filter]);
  useEffect(() => {
    const h = setTimeout(() => setDQuery(query), 300);
    return () => clearTimeout(h);
  }, [query]);
  const searchBox = useRef<HTMLDivElement>(null);
  const firstMode = useRef(true);
  useEffect(() => {
    if (firstMode.current) {
      firstMode.current = false;
      return;
    }
    searchBox.current?.querySelector("input")?.focus();
  }, [mode]);
  const showFind = mode === "name" && dFilter.trim().length > 0;

  // ---------------------------------------------------------------- Geöffnete Datei
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [file, setFile] = useState<FileContent | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<FileValidationError[]>([]);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const [initialLine, setInitialLine] = useState<number | null>(null);
  const [autoFocus, setAutoFocus] = useState(false);
  const editor = useRef<CodeEditorHandle>(null);
  const loadSeq = useRef(0);
  const checkSeq = useRef(0);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const fileRef = useRef<FileContent | null>(null);
  fileRef.current = file;
  const openRef = useRef<string | null>(null);
  openRef.current = openPath;

  const askDiscard = useCallback(
    (path: string) =>
      confirm({ title: t("files.unsaved.title"), text: t("files.unsaved.text", { name: baseName(path) }), confirmLabel: t("files.unsaved.confirm"), danger: true }),
    [t],
  );

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
      .filesValidate(path, content)
      .then((e) => seq === checkSeq.current && setErrors(e))
      .catch(() => seq === checkSeq.current && setErrors([]))
      .finally(() => seq === checkSeq.current && setChecking(false));
  }, []);

  const showFile = useCallback(
    (f: FileContent, line: number | null) => {
      setFile(f);
      setDirty(false);
      setErrors([]);
      setInitialLine(line);
      setEditorKey((k) => k + 1);
      if (!f.readonly && f.kind === "text") validate(f.path, f.language, f.content);
      else setChecking(false);
    },
    [validate],
  );

  const load = useCallback(
    async (path: string, line: number | null) => {
      const seq = ++loadSeq.current;
      setOpenPath(path);
      setLoading(true);
      setLoadError(null);
      try {
        const f = await api.filesRead(scope, path);
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
    [scope, showFile],
  );

  const closeFile = useCallback(() => {
    loadSeq.current++;
    setOpenPath(null);
    setFile(null);
    setDirty(false);
    setErrors([]);
    setLoadError(null);
    setLoading(false);
  }, []);

  const openFile = useCallback(
    async (path: string, line: number | null = null, focus = false) => {
      const cur = fileRef.current;
      if (cur && cur.path === path) {
        if (line) editor.current?.gotoLine(line);
        return;
      }
      if (dirtyRef.current && cur && !(await askDiscard(cur.path))) return;
      setAutoFocus(focus);
      expandTo(path, false);
      setSelected(path);
      requestAnimationFrame(() => tree.current?.scrollTo(path));
      void load(path, line);
    },
    [askDiscard, expandTo, load],
  );

  const save = useCallback(async () => {
    const f = fileRef.current;
    if (!f || f.readonly || !editor.current || saving) return;
    const content = editor.current.getValue();
    if (CHECKED.has(f.language)) {
      const errs = await api.filesValidate(f.path, content).catch(() => [] as FileValidationError[]);
      setErrors(errs);
      if (
        errs.length &&
        !(await confirm({ title: t("files.invalid.title"), text: t("files.invalid.text", { n: errs.length }), confirmLabel: t("files.invalid.confirm"), danger: true }))
      ) {
        // Zurück in den Editor, damit man gleich weiter korrigieren kann
        requestAnimationFrame(() => editor.current?.focus());
        return;
      }
    }
    setSaving(true);
    try {
      const nf = await api.filesWrite(scope, f.path, content);
      setFile(nf);
      editor.current?.markClean();
      setDirty(false);
      toast.success(t("files.saved"), nf.path);
      void refresh();
    } catch (e) {
      toast.error(e, t("files.save_failed"));
    } finally {
      setSaving(false);
    }
  }, [refresh, saving, scope, t]);

  const discard = useCallback(() => {
    const f = fileRef.current;
    if (f) showFile(f, null);
  }, [showFile]);

  const reloadFile = useCallback(async () => {
    const f = fileRef.current;
    if (!f) return;
    if (dirtyRef.current && !(await askDiscard(f.path))) return;
    loadSeq.current++;
    void load(f.path, null);
  }, [askDiscard, load]);

  const restore = useCallback(async () => {
    const f = fileRef.current;
    if (!f) return;
    const ok = await confirm({
      title: t("files.restore.title"),
      text: (
        <>
          {t("files.restore.text", { name: baseName(f.path) })}
          {dirtyRef.current && <span className="mt-2 block text-warn">{t("files.restore.text_dirty")}</span>}
        </>
      ),
      confirmLabel: t("files.restore"),
    });
    if (!ok) return;
    try {
      const nf = await api.filesRestore(scope, f.path);
      showFile(nf, null);
      toast.success(t("files.restored"), nf.path);
      void refresh();
    } catch (e) {
      toast.error(e, t("files.restore_failed"));
    }
  }, [refresh, scope, showFile, t]);

  const onContent = useCallback(
    (content: string) => {
      const f = fileRef.current;
      if (f) validate(f.path, f.language, content);
    },
    [validate],
  );

  // ---------------------------------------------------------------- Dateiaktionen
  const [nameDialog, setNameDialog] = useState<NameDialog>(null);

  const importPaths = useCallback(
    async (dir: string, paths: string[]) => {
      if (!paths.length) return;
      try {
        const out = await api.filesImport(scope, dir, paths);
        const where = dir ? `${dir}/` : t("files.root");
        toast.success(out.length === 1 ? t("files.imported_one", { name: baseName(out[0]), dir: where }) : t("files.imported", { n: out.length, dir: where }));
        if (dir) expandTo(dir, true);
        await refresh();
        if (out.length === 1) revealInTree(out[0]);
      } catch (e) {
        toast.error(e, t("files.import_failed"));
      }
    },
    [expandTo, refresh, revealInTree, scope, t],
  );

  const actions: FileActions = useMemo(
    () => ({
      open: (e) => {
        if (e.is_dir) revealInTree(e.path, true);
        else void openFile(e.path);
      },
      newItem: (kind, dir) => setNameDialog({ kind, dir }),
      rename: (entry) => setNameDialog({ kind: "rename", entry }),
      importInto: async (dir, folder) => {
        const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
        const picked = await openDialog({ multiple: true, directory: folder }).catch(() => null);
        const list = picked === null ? [] : Array.isArray(picked) ? picked : [picked];
        await importPaths(dir, list);
      },
      duplicate: async (e) => {
        try {
          const p = await api.filesDuplicate(scope, e.path);
          toast.success(t("files.duplicated", { name: baseName(p) }));
          await refresh();
          revealInTree(p);
        } catch (err) {
          toast.error(err, t("files.action_failed"));
        }
      },
      remove: async (e) => {
        const open = openRef.current;
        const affectsOpen = !!open && isInside(open, e.path);
        if (e.is_dir && (e.children ?? 0) > 0) {
          const ok = await confirm({
            title: t("files.delete_dir.title"),
            text: (
              <>
                {t("files.delete_dir.text", { name: e.name, n: e.children ?? 0 })}
                {affectsOpen && dirtyRef.current && <span className="mt-2 block text-warn">{t("files.delete_open.text")}</span>}
              </>
            ),
            confirmLabel: t("files.delete_dir.confirm"),
            danger: true,
          });
          if (!ok) return;
        } else if (affectsOpen && dirtyRef.current && !(await askDiscard(open!))) return;
        try {
          let out = await api.filesDelete(scope, [e.path]);
          if (out.trash_error && !out.deleted) {
            const ok = await confirm({
              title: t("files.delete_perm.title"),
              text: t("files.delete_perm.text", { name: e.name, reason: out.trash_error }),
              confirmLabel: t("files.delete_perm.confirm"),
              danger: true,
            });
            if (!ok) return;
            out = await api.filesDelete(scope, [e.path], true);
          }
          if (affectsOpen) closeFile();
          setSelected((s) => (s && isInside(s, e.path) ? dirName(e.path) || null : s));
          toast.success(out.trashed ? t("files.trashed") : t("files.deleted"), e.path);
          await refresh();
        } catch (err) {
          toast.error(err, t("files.action_failed"));
        }
      },
      reveal: (path) => void api.filesReveal(scope, path).catch((e) => toast.error(e)),
      copyPath: async (path, relative) => {
        try {
          await copyText(relative ? path || "." : await api.filesAbsPath(scope, path));
          toast.success(t("files.copied"), relative ? path : undefined);
        } catch (e) {
          toast.error(e);
        }
      },
    }),
    [askDiscard, closeFile, importPaths, openFile, refresh, revealInTree, scope, t],
  );

  const submitName = useCallback(
    async (name: string) => {
      const st = nameDialog;
      if (!st) return;
      if (st.kind === "rename") {
        const old = st.entry.path;
        const np = await api.filesRename(scope, old, name);
        setNameDialog(null);
        // Aufgeklappte Ordner, Markierung und geöffnete Datei mitnehmen
        const move = (p: string) => (isInside(p, old) ? np + p.slice(old.length) : p);
        setExpanded((s) => new Set([...s].map(move)));
        setSelected((s) => (s ? move(s) : s));
        const open = openRef.current;
        if (open && isInside(open, old)) {
          setOpenPath(move(open));
          setFile((f) => (f ? { ...f, path: move(f.path) } : f));
        }
        toast.success(t("files.renamed", { name: baseName(np) }));
        await refresh();
        revealInTree(np);
        return;
      }
      const p = await api.filesCreate(scope, st.dir, name, st.kind === "folder");
      setNameDialog(null);
      toast.success(t("files.created", { name: baseName(p) }));
      if (st.dir) expandTo(st.dir, true);
      await refresh();
      if (st.kind === "file") void openFile(p, null, true);
      else revealInTree(p);
    },
    [expandTo, nameDialog, openFile, refresh, revealInTree, scope, t],
  );

  // ---------------------------------------------------------------- Tastenkürzel
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (dirtyRef.current) void saveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const treeKey = useCallback(
    (e: KeyboardEvent<HTMLDivElement>, entry: FileEntry | null) => {
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const run = (f: () => void) => {
        e.preventDefault();
        f();
        return true;
      };
      if (mod && k === "n") return run(() => actions.newItem(e.shiftKey ? "folder" : "file", targetDir(entry)));
      if (!entry) return false;
      if (e.key === "F2") return run(() => actions.rename(entry));
      if (e.key === "Delete") return run(() => actions.remove(entry));
      if (mod && !e.shiftKey && k === "d") return run(() => actions.duplicate(entry));
      if (mod && e.shiftKey && k === "c") return run(() => actions.copyPath(entry.path, false));
      return false;
    },
    [actions],
  );

  // ---------------------------------------------------------------- Drag & Drop aus dem Explorer
  const dropId = useId();
  const rootEl = useRef<HTMLDivElement>(null);
  const dragPos = useDragState((s) => (s.over === dropId ? s.pos : null));
  const dropDirAt = useCallback((pos: { x: number; y: number }) => {
    const el = document.elementFromPoint(pos.x, pos.y) as HTMLElement | null;
    return el?.closest<HTMLElement>("[data-drop-dir]")?.dataset.dropDir ?? "";
  }, []);
  const dropDir = dragPos ? dropDirAt(dragPos) : null;
  const importRef = useRef(importPaths);
  importRef.current = importPaths;
  useEffect(() => {
    const el = rootEl.current;
    if (!el) return;
    return registerDropTarget({ id: dropId, el, accepts: (paths) => paths.length > 0, onDrop: (paths, pos) => void importRef.current(dropDirAt(pos), paths) });
  }, [dropId, dropDirAt]);

  // ---------------------------------------------------------------- Häufig
  const quickQ = useQuery({
    queryKey: [...fkeys.quick(scope), quick.map((q) => q.path).join("|")],
    queryFn: async () => {
      const res = await Promise.allSettled(quick.map((q) => api.filesStat(scope, q.path)));
      return res.flatMap((r, i) => (r.status === "fulfilled" ? [{ item: quick[i], entry: r.value }] : []));
    },
    staleTime: 30_000,
  });

  const rootEntries = dirs.get("");
  const rootCount = rootEntries?.length ?? 0;
  const openEntry = openPath ? (entryByPath.get(openPath) ?? null) : null;

  return (
    <div ref={rootEl} className="relative flex h-full min-h-0 flex-col">
      {/* ------------------------------------------------------------ Häufig */}
      {(quickQ.data?.length ?? 0) > 0 && (
        <PageTools>
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]" aria-label={t("files.quick")}>
          {quickQ.data!.map(({ item, entry }) => (
            <button
              key={item.path}
              onClick={() => (entry.is_dir ? revealInTree(entry.path, true) : void openFile(entry.path, null, true))}
              title={entry.path}
              className={cn(
                "flex h-7 shrink-0 items-center gap-1.5 rounded-ctl px-2 text-[12.5px] font-medium transition-colors duration-100",
                (entry.is_dir ? selected === entry.path : openPath === entry.path)
                  ? "bg-surface3 text-text"
                  : "text-muted hover:bg-white/[.06] hover:text-text",
              )}
            >
              <FileIcon entry={entry} size={13} />
              {item.label ?? (entry.is_dir ? `${entry.path}/` : entry.path)}
            </button>
          ))}
        </div>
        </PageTools>
      )}
      <div className="flex min-h-0 flex-1">
        {/* ------------------------------------------------------------ Baum */}
        <aside className="flex w-[340px] shrink-0 flex-col border-r border-line max-[1100px]:w-[290px]">
          <div ref={searchBox} className="flex shrink-0 flex-col gap-2 border-b border-line p-3">
            <div className="flex items-center gap-1">
              <Segmented
                value={mode}
                onChange={setMode}
                items={[
                  { value: "name", label: t("files.mode.name") },
                  { value: "content", label: t("files.mode.content") },
                ]}
              />
              <div className="flex-1" />
              <Tooltip content={t("files.act.new_file")}>
                <IconButton label={t("files.act.new_file")} size="sm" className="border-transparent" onClick={() => actions.newItem("file", targetDir(selEntry))}>
                  <FilePlus size={14} />
                </IconButton>
              </Tooltip>
              <Tooltip content={t("files.act.new_folder")}>
                <IconButton label={t("files.act.new_folder")} size="sm" className="border-transparent" onClick={() => actions.newItem("folder", targetDir(selEntry))}>
                  <FolderPlus size={14} />
                </IconButton>
              </Tooltip>
              <DropdownMenu
                trigger={
                  <IconButton label={t("files.act.import")} size="sm" className="border-transparent">
                    <FolderInput size={14} />
                  </IconButton>
                }
              >
                <DropdownItem icon={<Upload size={14} />} onSelect={() => actions.importInto(targetDir(selEntry), false)}>
                  {t("files.act.import_files")}
                </DropdownItem>
                <DropdownItem icon={<FolderInput size={14} />} onSelect={() => actions.importInto(targetDir(selEntry), true)}>
                  {t("files.act.import_folder")}
                </DropdownItem>
              </DropdownMenu>
              <Tooltip content={t("files.collapse_all")}>
                <IconButton label={t("files.collapse_all")} size="sm" className="border-transparent" onClick={() => setExpanded(new Set())}>
                  <ChevronsDownUp size={14} />
                </IconButton>
              </Tooltip>
              <Tooltip content={t("files.reload")}>
                <IconButton label={t("files.reload")} size="sm" className="border-transparent" onClick={() => void refresh()}>
                  <RefreshCw size={14} className={cn(anyFetching && "animate-spin")} />
                </IconButton>
              </Tooltip>
            </div>
            {mode === "name" ? (
              <SearchInput value={filter} onChange={setFilter} placeholder={t("files.filter")} className="[&_input]:h-8 [&_input]:text-[13px]" />
            ) : (
              <SearchInput value={query} onChange={setQuery} placeholder={t("files.search")} className="[&_input]:h-8 [&_input]:text-[13px]" />
            )}
          </div>
          <div className="min-h-0 flex-1">
            {mode === "content" ? (
              <div className="scroll h-full">
                <SearchResults scope={scope} query={dQuery} onOpen={(p, l) => void openFile(p, l)} />
              </div>
            ) : showFind ? (
              <div className="scroll h-full">
                <FindResults scope={scope} query={dFilter} selected={selected} onPick={(e) => (e.is_dir ? (setFilter(""), revealInTree(e.path, true)) : void openFile(e.path))} />
              </div>
            ) : rootQ.isError && !rootQ.data ? (
              <ErrorState error={rootQ.error} onRetry={() => rootQ.refetch()} />
            ) : !rootQ.data ? (
              <ListSkeleton n={10} />
            ) : (
              <ContextMenu content={<RootMenu actions={actions} />}>
                <div className="h-full" data-drop-dir="">
                  {!rootCount ? (
                    <EmptyState icon={<FolderTree size={28} />} title={t("files.empty.title")} text={t("files.empty.text")} className="py-10" />
                  ) : (
                    <FileTree
                      ref={tree}
                      rows={rows}
                      selected={selected}
                      openPath={openPath}
                      dirty={dirty}
                      dropDir={dropDir}
                      actions={actions}
                      onSelect={setSelected}
                      onToggle={toggle}
                      onKey={treeKey}
                    />
                  )}
                </div>
              </ContextMenu>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-1.5 text-[11px] text-dim">
            <span>{rootCount === 1 ? t("files.entries_one") : t("files.entries", { n: rootCount })}</span>
            <span className="flex-1" />
            <span className="truncate">{t("files.drop_hint")}</span>
          </div>
        </aside>

        {/* ------------------------------------------------------------ Editor */}
        <section className="flex min-w-0 flex-1 flex-col" data-drop-dir={openPath ? dirName(openPath) : ""}>
          <FilePane
            scope={scope}
            path={openPath}
            file={file}
            entry={openEntry}
            loading={loading}
            loadError={loadError}
            onRetry={() => openPath && void load(openPath, null)}
            dirty={dirty}
            errors={errors}
            checking={checking}
            saving={saving}
            editorKey={editorKey}
            initialLine={initialLine}
            autoFocus={autoFocus}
            editorRef={editor}
            onDirty={setDirty}
            onContent={onContent}
            onJump={(e) => editor.current?.gotoLine(e.line, e.column)}
            onSave={() => void save()}
            onDiscard={discard}
            onRestore={() => void restore()}
            onReloadFile={() => void reloadFile()}
            running={running}
            runningText={runningText}
            actions={actions}
            empty={<EmptyState icon={<FileText size={30} />} title={t("files.pick.title")} text={t("files.pick.text")} className="flex-1" />}
          />
        </section>
      </div>

      {dragPos && (
        <div className="pointer-events-none absolute inset-0 z-10 border-2 border-dashed border-accent/70 bg-black/20">
          <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-card bg-overlay px-4 py-2 text-[13px] font-semibold text-text shadow-e2">
            <Upload size={15} className="text-accent" />
            {t("files.drop_into", { name: dropDir ? `${dropDir}/` : t("files.root") })}
          </div>
        </div>
      )}
      <NameDialogView state={nameDialog} onClose={() => setNameDialog(null)} onSubmit={submitName} />
    </div>
  );
}
