// OWNER: Frontend-Agent B. Wird von Agent A (Instanz-Kontextmenü / Instanzseite) geöffnet.
// Format wählen, Metadaten, Dateibaum (exportEntries) mit Checkboxen, Speicherort, Fortschritt, "Im Ordner zeigen".
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AlertTriangle, Check, CheckCircle2, ChevronRight, File, Folder, FolderOpen, Minus, PackageOpen } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Dialog, Field, Input, Progress, Skeleton, Textarea, cn, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { useAccounts, useTask } from "@/lib/queries";
import type { ExportEntry, Instance, PackFormat } from "@/lib/types";
import { dirName } from "@/components/content/util";

type Fmt = Extract<PackFormat, "mrpack" | "curseforge" | "vlpack">;
const FORMATS: { value: Fmt; ext: string }[] = [
  { value: "mrpack", ext: "mrpack" },
  { value: "curseforge", ext: "zip" },
  { value: "vlpack", ext: "vlpack" },
];

// ------------------------------------------------------------------ Dateibaum

interface Node {
  path: string;
  name: string;
  isDir: boolean;
  size: number;
  depth: number;
  children: Node[];
  /** Alle Datei-Pfade unterhalb (für Ordner) bzw. der eigene Pfad */
  leaves: string[];
}

function buildTree(entries: ExportEntry[]): Node[] {
  const root: Node = { path: "", name: "", isDir: true, size: 0, depth: -1, children: [], leaves: [] };
  const byPath = new Map<string, Node>([["", root]]);
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path));
  const ensure = (path: string): Node => {
    const hit = byPath.get(path);
    if (hit) return hit;
    const i = path.lastIndexOf("/");
    const parent = ensure(i === -1 ? "" : path.slice(0, i));
    const n: Node = { path, name: path.slice(i + 1), isDir: true, size: 0, depth: parent.depth + 1, children: [], leaves: [] };
    parent.children.push(n);
    byPath.set(path, n);
    return n;
  };
  for (const e of sorted) {
    const p = e.path.replace(/\\/g, "/").replace(/\/$/, "");
    if (e.is_dir) {
      const n = ensure(p);
      n.size = Math.max(n.size, e.size);
    } else {
      const i = p.lastIndexOf("/");
      const parent = ensure(i === -1 ? "" : p.slice(0, i));
      const n: Node = { path: p, name: p.slice(i + 1), isDir: false, size: e.size, depth: parent.depth + 1, children: [], leaves: [p] };
      parent.children.push(n);
      byPath.set(p, n);
    }
  }
  const finish = (n: Node) => {
    n.children.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));
    if (n.isDir) {
      let sum = 0;
      const leaves: string[] = [];
      for (const c of n.children) {
        finish(c);
        sum += c.size;
        leaves.push(...c.leaves);
      }
      // Ordner ohne aufgelistete Kinder zählt als ein Eintrag
      n.leaves = n.children.length ? leaves : [n.path];
      n.size = Math.max(n.size, sum);
    }
  };
  finish(root);
  return root.children;
}

/** Ausgewählte Blätter -> kompakte Include-Liste (ganze Ordner, wenn vollständig). */
function compactInclude(nodes: Node[], sel: Set<string>): string[] {
  const out: string[] = [];
  const walk = (n: Node) => {
    const on = n.leaves.filter((l) => sel.has(l)).length;
    if (!on) return;
    if (on === n.leaves.length) out.push(n.path);
    else n.children.forEach(walk);
  };
  nodes.forEach(walk);
  return out;
}

export function ExportDialog({ instance, open, onOpenChange }: { instance: Instance; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT();
  const { data: accounts } = useAccounts();
  const [format, setFormat] = useState<Fmt>("mrpack");
  const [name, setName] = useState(instance.name);
  const [version, setVersion] = useState("1.0.0");
  const [author, setAuthor] = useState("");
  const [description, setDescription] = useState("");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [dest, setDest] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Beim Öffnen zurücksetzen
  useEffect(() => {
    if (!open) return;
    setName(instance.source?.name ?? instance.name);
    setVersion(instance.source?.version_name ?? "1.0.0");
    setAuthor((a) => a || (accounts?.find((x) => x.active)?.username ?? ""));
    setTaskId(null);
    setDest(null);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, instance.id]);

  const entriesQ = useQuery({
    queryKey: ["export-entries", instance.id],
    queryFn: () => api.exportEntries(instance.id),
    enabled: open,
    staleTime: 0,
    placeholderData: undefined,
  });
  const tree = useMemo(() => buildTree(entriesQ.data ?? []), [entriesQ.data]);
  const [sel, setSel] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (!entriesQ.data) return;
    const s = new Set<string>();
    const defaults = entriesQ.data.filter((e) => e.default_selected).map((e) => e.path.replace(/\\/g, "/").replace(/\/$/, ""));
    const walk = (n: Node, inherited: boolean) => {
      const on = inherited || defaults.includes(n.path);
      if (!n.isDir || !n.children.length) {
        if (on) s.add(n.path);
      } else n.children.forEach((c) => walk(c, on));
    };
    tree.forEach((n) => walk(n, false));
    setSel(s);
  }, [entriesQ.data, tree]);

  const task = useTask(taskId);
  const running = busy || task?.status === "running";
  const done = task?.status === "done";
  const failed = task?.status === "failed" || task?.status === "cancelled";

  const allLeaves = useMemo(() => tree.flatMap((n) => n.leaves), [tree]);
  const sizeOf = useMemo(() => {
    const m = new Map<string, number>();
    const walk = (n: Node) => (n.isDir ? n.children.forEach(walk) : m.set(n.path, n.size));
    tree.forEach(walk);
    return m;
  }, [tree]);
  const selSize = [...sel].reduce((a, p) => a + (sizeOf.get(p) ?? 0), 0);

  const start = async () => {
    setError(null);
    const ext = FORMATS.find((f) => f.value === format)!.ext;
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const safe = (name.trim() || instance.name).replace(/[\\/:*?"<>|]+/g, "_");
      const target = await save({
        title: t("export.save_title"),
        defaultPath: `${safe}-${version.trim() || "1.0.0"}.${ext}`,
        filters: [{ name: t(`export.format.${format}`), extensions: [ext] }],
      });
      if (!target) return;
      setBusy(true);
      const id = await api.exportInstance(instance.id, {
        format,
        dest: target,
        name: name.trim() || instance.name,
        version: version.trim() || "1.0.0",
        author: author.trim() || null,
        description: description.trim() || null,
        include: compactInclude(tree, sel),
      });
      setDest(target);
      setTaskId(id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("export.title")}
      description={t("export.description", { name: instance.name })}
      size="lg"
      footer={
        done ? (
          <>
            <Button variant="ghost" icon={<FolderOpen size={14} />} onClick={() => dest && api.openPath(dirName(dest)).catch((e) => toast.error(e))}>
              {t("export.show_folder")}
            </Button>
            <Button variant="accent" onClick={() => onOpenChange(false)} autoFocus>
              {t("common.done")}
            </Button>
          </>
        ) : running ? (
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("install.background")}
          </Button>
        ) : (
          <>
            <Button variant="subtle" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="accent" icon={<PackageOpen size={14} />} onClick={start} disabled={!name.trim() || !entriesQ.data || sel.size === 0}>
              {failed ? t("common.retry") : t("export.start")}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t("export.format")}>
          {FORMATS.map((f) => {
            const on = f.value === format;
            return (
              <button
                key={f.value}
                role="radio"
                aria-checked={on}
                disabled={running || done}
                onClick={() => setFormat(f.value)}
                className={cn(
                  "flex flex-col items-start gap-1 border border-t-2 px-3.5 py-3 text-left transition-colors duration-150 disabled:opacity-60",
                  on ? "border-line2 border-t-accent bg-white/[.03]" : "border-line border-t-line hover:border-line2",
                )}
              >
                <span className="flex w-full items-center justify-between">
                  <span className="text-[13.5px] font-semibold text-white">{t(`export.format.${f.value}`)}</span>
                  <span className="font-mono text-[10.5px] text-dim">.{f.ext}</span>
                </span>
                <span className="text-[12px] leading-snug text-muted">{t(`export.format_text.${f.value}`)}</span>
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_140px] gap-3">
          <Field label={t("export.name")}>
            <Input value={name} onChange={(e) => setName(e.target.value)} disabled={running || done} />
          </Field>
          <Field label={t("export.version")}>
            <Input value={version} onChange={(e) => setVersion(e.target.value)} disabled={running || done} />
          </Field>
          <Field label={t("export.author")} className="col-span-2">
            <Input value={author} onChange={(e) => setAuthor(e.target.value)} disabled={running || done} placeholder={t("export.optional")} />
          </Field>
          <Field label={t("export.desc")} className="col-span-2">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} disabled={running || done} placeholder={t("export.optional")} />
          </Field>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="label">{t("export.files")}</span>
            <span className="font-mono text-[11px] text-dim">
              {entriesQ.data && t("export.selected", { n: sel.size, total: allLeaves.length, size: formatBytes(selSize) })}
            </span>
          </div>
          {entriesQ.isPending ? (
            <div className="flex h-[248px] flex-col gap-1 border border-line p-2">
              {Array.from({ length: 7 }, (_, i) => (
                <Skeleton key={i} className="h-7" style={{ width: `${90 - (i % 3) * 15}%` }} />
              ))}
            </div>
          ) : entriesQ.isError ? (
            <div className="flex h-[120px] flex-col items-center justify-center gap-2 border border-line text-center">
              <span className="text-[12.5px] text-danger">{errorMessage(entriesQ.error)}</span>
              <Button size="sm" onClick={() => entriesQ.refetch()}>
                {t("common.retry")}
              </Button>
            </div>
          ) : (
            <FileTree tree={tree} sel={sel} setSel={setSel} disabled={running || done} />
          )}
        </div>

        {(task || error) && (
          <div className="flex flex-col gap-2 animate-fade-in">
            {task && !done && (
              <>
                <div className="flex justify-between">
                  <span className="label">{failed ? t("export.failed") : t("export.running")}</span>
                  <span className="font-mono text-[11px] text-muted">{task.progress != null ? `${Math.round(task.progress * 100)} %` : ""}</span>
                </div>
                <Progress value={task.progress} tone={failed ? "danger" : "accent"} />
                <div className="selectable min-h-5 break-words text-[12px] text-dim">{failed ? task.error : task.message}</div>
              </>
            )}
            {done && (
              <div className="flex items-center gap-3 border border-ok/30 bg-ok/[.06] px-4 py-3">
                <CheckCircle2 size={18} className="shrink-0 text-ok" />
                <div className="min-w-0">
                  <div className="text-[13px] text-white">{t("export.done")}</div>
                  <div className="selectable truncate font-mono text-[11px] text-dim">{dest}</div>
                </div>
              </div>
            )}
            {error && (
              <div className="flex items-start gap-2 text-[12.5px] text-danger">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span className="selectable break-words">{error}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}

function FileTree({ tree, sel, setSel, disabled }: { tree: Node[]; sel: Set<string>; setSel: (s: Set<string>) => void; disabled: boolean }) {
  const t = useT();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const rows = useMemo(() => {
    const out: Node[] = [];
    const walk = (n: Node) => {
      out.push(n);
      if (n.isDir && expanded.has(n.path)) n.children.forEach(walk);
    };
    tree.forEach(walk);
    return out;
  }, [tree, expanded]);
  const ref = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({ count: rows.length, getScrollElement: () => ref.current, estimateSize: () => 30, overscan: 12 });

  const toggle = (n: Node) => {
    const next = new Set(sel);
    const all = n.leaves.every((l) => next.has(l));
    for (const l of n.leaves) all ? next.delete(l) : next.add(l);
    setSel(next);
  };

  if (!tree.length) return <div className="flex h-[80px] items-center justify-center border border-line text-[12.5px] text-dim">{t("export.no_files")}</div>;

  return (
    <div ref={ref} className="scroll h-[248px] border border-line bg-black/30">
      <div className="relative" style={{ height: v.getTotalSize() }}>
        {v.getVirtualItems().map((it) => {
          const n = rows[it.index];
          const on = n.leaves.filter((l) => sel.has(l)).length;
          const state = on === 0 ? "off" : on === n.leaves.length ? "on" : "mixed";
          const isOpen = expanded.has(n.path);
          return (
            <div
              key={n.path}
              className="absolute inset-x-0 flex h-[30px] items-center gap-1.5 pr-3 text-[12.5px] hover:bg-white/[.03]"
              style={{ top: it.start, paddingLeft: 8 + n.depth * 18 }}
            >
              {n.isDir && n.children.length > 0 ? (
                <button
                  aria-label={isOpen ? t("export.collapse") : t("export.expand")}
                  className="grid h-5 w-5 place-items-center text-dim hover:text-white"
                  onClick={() => {
                    const next = new Set(expanded);
                    if (isOpen) next.delete(n.path);
                    else next.add(n.path);
                    setExpanded(next);
                  }}
                >
                  <ChevronRight size={13} className={cn("transition-transform duration-150", isOpen && "rotate-90")} />
                </button>
              ) : (
                <span className="w-5" />
              )}
              <button
                role="checkbox"
                aria-checked={state === "mixed" ? "mixed" : state === "on"}
                disabled={disabled}
                onClick={() => toggle(n)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:opacity-60"
              >
                <span
                  className={cn(
                    "grid h-4 w-4 shrink-0 place-items-center border transition-colors duration-100",
                    state === "off" ? "border-line2" : "border-accent bg-accent text-[var(--on-accent)]",
                  )}
                >
                  {state === "on" ? <Check size={11} strokeWidth={3} /> : state === "mixed" ? <Minus size={11} strokeWidth={3} /> : null}
                </span>
                {n.isDir ? <Folder size={14} className="shrink-0 text-muted" /> : <File size={14} className="shrink-0 text-dim" />}
                <span className={cn("truncate", state === "off" ? "text-muted" : "text-white")}>{n.name}</span>
              </button>
              <span className="shrink-0 font-mono text-[11px] text-dim">{formatBytes(n.size)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
