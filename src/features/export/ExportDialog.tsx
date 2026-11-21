// OWNER: Frontend-Agent B. Wird von Agent A (Instanz-Kontextmenü / Instanzseite) geöffnet.
// Format wählen, Metadaten, Dateibaum (exportEntries) mit Checkboxen, Speicherort, Fortschritt, "Im Ordner zeigen".
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronRight, File, Folder, FolderOpen, Minus, PackageOpen } from "lucide-react";
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
  const [step, setStep] = useState<"format" | "review">("format");
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
    setStep("format");
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
  const running = busy || (!!taskId && (!task || task.status === "running"));
  const done = task?.status === "done";
  const failed = task?.status === "failed" || task?.status === "cancelled";

  const allLeaves = useMemo(() => tree.flatMap((n) => n.leaves), [tree]);
  const sizeOf = useMemo(() => {
    const m = new Map<string, number>();
    const walk = (n: Node) => (n.isDir && n.children.length ? n.children.forEach(walk) : m.set(n.path, n.size));
    tree.forEach(walk);
    return m;
  }, [tree]);
  const selSize = [...sel].reduce((a, p) => a + (sizeOf.get(p) ?? 0), 0);

  const start = async () => {
    setError(null);
    setBusy(true);
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

  const reviewing = step === "review" && !running && !done;
  const choosing = step === "format" && !running && !done;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("export.title")}
      description={t("export.description", { name: instance.name })}
      size="xl"
      className="[&_.vl-dialog-foot]:flex-wrap"
      footer={
        done ? (
          <>
            <Button variant="ghost" icon={<FolderOpen size={14} />} onClick={() => dest && api.openPath(dirName(dest)).catch((e) => toast.error(e))}>
              {t("export.show_folder")}
            </Button>
            <Button variant="primary" onClick={() => onOpenChange(false)} autoFocus>
              {t("common.done")}
            </Button>
          </>
        ) : running ? (
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("install.background")}
          </Button>
        ) : choosing ? (
          <>
            <Button variant="subtle" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
            <Button variant="primary" icon={<ArrowRight size={16} />} onClick={() => setStep("review")}>{t("export.next")}</Button>
          </>
        ) : (
          <>
            <Button variant="subtle" className="mr-auto" icon={<ArrowLeft size={16} />} onClick={() => setStep("format")}>{t("common.back")}</Button>
            <Button variant="primary" icon={<PackageOpen size={16} />} onClick={start} disabled={!name.trim() || !entriesQ.data || sel.size === 0}>
              {failed ? t("common.retry") : t("export.start")}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-5">
        {choosing && (
          <div className="grid gap-3" role="group" aria-label={t("export.format")}>
            {FORMATS.map((f) => (
              <button
                key={f.value}
                type="button"
                aria-pressed={format === f.value}
                onClick={() => setFormat(f.value)}
                className={cn(
                  "flex min-w-0 items-center gap-4 rounded-card border p-4 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
                  format === f.value ? "border-accent bg-accent/[.08]" : "border-line bg-surface hover:bg-surface2",
                )}
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-ctl bg-surface3 text-accent"><PackageOpen size={20} /></span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-[16px] font-semibold text-text">{t(`export.format.${f.value}`)}</span>
                    <span className="text-[13px] text-muted">.{f.ext}</span>
                  </span>
                  <span className="mt-0.5 block text-[14px] text-muted">{t(`export.format_text.${f.value}`)}</span>
                </span>
                <span className="w-5 shrink-0 text-accent">{format === f.value && <Check size={20} />}</span>
              </button>
            ))}
          </div>
        )}
        {reviewing && (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[17px] font-semibold text-text">{t("export.review")}</h2>
              <span className="text-[14px] text-muted">{t(`export.format.${format}`)}</span>
            </div>
            <Field label={t("export.name")}>
              <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </Field>
            <details className="rounded-card border border-line bg-surface">
              <summary className="cursor-pointer px-4 py-3 text-[14px] font-medium text-text">{t("export.metadata")}</summary>
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3 px-4 pb-4">
                <Field label={t("export.version")}>
                  <Input value={version} onChange={(e) => setVersion(e.target.value)} />
                </Field>
                <Field label={t("export.author")}>
                  <Input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder={t("export.optional")} />
                </Field>
                <Field label={t("export.desc")} className="col-span-2">
                  <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("export.optional")} />
                </Field>
              </div>
            </details>
            {entriesQ.isPending ? (
              <Skeleton className="h-12" />
            ) : entriesQ.isError ? (
              <div role="alert" className="flex flex-wrap items-center gap-3 rounded-card bg-danger/[.08] p-4">
                <span className="min-w-0 flex-1 break-words text-[14px] text-danger">{errorMessage(entriesQ.error)}</span>
                <Button onClick={() => entriesQ.refetch()}>{t("common.retry")}</Button>
              </div>
            ) : (
              <details className="rounded-card border border-line bg-surface">
                <summary className="cursor-pointer px-4 py-3 text-[14px] font-medium text-text">
                  {t("export.files")}
                  <span className="ml-2 font-normal text-muted">{t("export.selected", { n: sel.size, total: allLeaves.length, size: formatBytes(selSize) })}</span>
                </summary>
                <FileTree tree={tree} sel={sel} setSel={setSel} />
              </details>
            )}
          </>
        )}
        {running && !task && <p role="status" className="text-[14px] text-muted">{t("export.running")}</p>}
        {!choosing && (task || error) && (
          <div className="flex flex-col gap-2 animate-fade-in">
            {task && !done && (
              <>
                <div className="flex justify-between">
                  <span className="label">{failed ? t("export.failed") : t("export.running")}</span>
                  <span className="text-caption tabular-nums text-muted">{task.progress != null ? `${Math.round(task.progress * 100)} %` : ""}</span>
                </div>
                <Progress value={task.progress} tone={failed ? "danger" : "accent"} />
                <div className="selectable min-h-5 break-words text-[12px] text-dim">{failed ? task.error : task.message}</div>
              </>
            )}
            {done && (
              <div className="flex items-center gap-3 rounded-card bg-ok/[.08] px-4 py-3">
                <CheckCircle2 size={18} className="shrink-0 text-ok" />
                <div className="min-w-0">
                  <div className="text-[13px] text-text">{t("export.done")}</div>
                  <div className="selectable truncate text-caption text-dim">{dest}</div>
                </div>
              </div>
            )}
            {error && (
              <div className="flex items-start gap-2 text-meta text-danger">
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

function FileTree({ tree, sel, setSel }: { tree: Node[]; sel: Set<string>; setSel: (s: Set<string>) => void }) {
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
  const v = useVirtualizer({ count: rows.length, getScrollElement: () => ref.current, estimateSize: () => 36, overscan: 12 });

  const toggle = (n: Node) => {
    const next = new Set(sel);
    const all = n.leaves.every((l) => next.has(l));
    for (const l of n.leaves) all ? next.delete(l) : next.add(l);
    setSel(next);
  };

  if (!tree.length) return <div className="flex h-[80px] items-center justify-center rounded-card bg-surface text-meta text-dim">{t("export.no_files")}</div>;

  return (
    <div ref={ref} className="scroll h-[248px] rounded-card bg-surface py-1">
      <div className="relative" style={{ height: v.getTotalSize() }}>
        {v.getVirtualItems().map((it) => {
          const n = rows[it.index];
          const on = n.leaves.filter((l) => sel.has(l)).length;
          const state = on === 0 ? "off" : on === n.leaves.length ? "on" : "mixed";
          const isOpen = expanded.has(n.path);
          return (
            <div
              key={n.path}
              className="absolute inset-x-0 flex h-9 items-center gap-1.5 pr-3 text-[14px] hover:bg-white/[.03]"
              style={{ top: it.start, paddingLeft: 8 + Math.min(n.depth, 12) * 18 }}
            >
              {n.isDir && n.children.length > 0 ? (
                <button
                  aria-label={isOpen ? t("export.collapse") : t("export.expand")}
                  className="grid h-5 w-5 place-items-center rounded-xs text-dim hover:text-text"
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
                onClick={() => toggle(n)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:opacity-60"
              >
                <span
                  className={cn(
                    "grid h-4 w-4 shrink-0 place-items-center rounded-xs border transition-colors duration-100",
                    state === "off" ? "border-white/20" : "border-brand bg-brand text-[var(--ui-on-accent)]",
                  )}
                >
                  {state === "on" ? <Check size={11} strokeWidth={3} /> : state === "mixed" ? <Minus size={11} strokeWidth={3} /> : null}
                </span>
                {n.isDir ? <Folder size={14} className="shrink-0 text-muted" /> : <File size={14} className="shrink-0 text-dim" />}
                <span className={cn("truncate", state === "off" ? "text-muted" : "text-text")}>{n.name}</span>
              </button>
              <span className="shrink-0 text-caption tabular-nums text-dim">{formatBytes(n.size)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
