// OWNER: Frontend-Agent B. Wird von Agent A (Instanz-Kontextmenü / Instanzseite) geöffnet.
// Format wählen, Metadaten, Dateibaum (exportEntries) mit Checkboxen, Speicherort, Fortschritt, "Im Ordner zeigen".
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, FolderOpen, PackageOpen } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button, Dialog, Field, Input, Skeleton, Textarea, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { useAccounts, useTask } from "@/lib/queries";
import type { Instance } from "@/lib/types";
import { dirName } from "@/components/content/util";
import { buildTree, compactInclude, FORMATS, type Fmt, type Node } from "./tree";
import { ExportStatus } from "./components/ExportStatus";
import { FileTree } from "./components/FileTree";
import { FormatPicker } from "./components/FormatPicker";

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
        {choosing && <FormatPicker format={format} setFormat={setFormat} />}
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
        {!choosing && (task || error) && <ExportStatus task={task} done={done} failed={failed} error={error} dest={dest} />}
      </div>
    </Dialog>
  );
}
