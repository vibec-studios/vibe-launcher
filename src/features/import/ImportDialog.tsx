import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, FileArchive, FolderInput, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Dialog, Field, Input, Progress, Skeleton } from "@/components/ui";
import { useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { formatLoader } from "@/lib/format";
import { useTask, waitForTask } from "@/lib/queries";
import type { PackFormat } from "@/lib/types";
import { ProjectIcon } from "@/components/content/ProjectIcon";
import { Pill } from "@/components/content/Pill";
import { baseName } from "@/components/content/util";
import { finishNewInstance } from "@/components/content/install";
import { useExternalImport } from "./ExternalImport";
import { ImportFileList } from "./ImportFileList";
import { HelpLink } from "@/features/help/HelpButton";
import { ImportSources } from "./ImportSources";
import { PACK_EXTENSIONS, useImportDialog, type ImportMode } from "./importStore";

const formatNames: Record<PackFormat, string> = {
  mrpack: "Modrinth (.mrpack)",
  curseforge: "CurseForge (.zip)",
  vlpack: "Vibe Launcher (.vlpack)",
  prism: "Prism Launcher",
  multimc: "MultiMC",
};

async function pickPackFile(title: string, filterName: string): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const res = await open({ multiple: false, title, filters: [{ name: filterName, extensions: PACK_EXTENSIONS }] });
  return typeof res === "string" ? res : null;
}

export function ImportDialog() {
  const t = useT();
  const { open, path, mode } = useImportDialog();
  const [taskId, setTaskId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const picking = useRef(false);
  const openRef = useRef(open);
  openRef.current = open;

  // Neuer Pfad -> Zustand zurücksetzen
  useEffect(() => {
    if (!open) return;
    setTaskId(null);
    setStartError(null);
    setName("");
  }, [path, open]);

  const preview = useQuery({
    queryKey: ["import-preview", path],
    queryFn: () => api.importPreview(path!),
    enabled: open && !!path,
    retry: 0,
    staleTime: 0,
    gcTime: 0,
    placeholderData: undefined,
  });
  useEffect(() => {
    if (preview.data && open) setName(preview.data.name);
  }, [preview.data, open]);

  const task = useTask(taskId);
  const running = starting || (!!taskId && (!task || task.status === "running"));
  const failed = task?.status === "failed" || task?.status === "cancelled";

  const back = () => {
    setStartError(null);
    useImportDialog.setState({ mode: "source", path: null });
  };
  const backButton = <Button variant="subtle" icon={<ArrowLeft size={16} />} onClick={back}>{t("import.back_to_source")}</Button>;
  const close = () => useImportDialog.setState({ open: false });
  const choose = async () => {
    if (picking.current) return;
    picking.current = true;
    setStartError(null);
    try {
      const p = await pickPackFile(t("import.choose"), t("import.filter"));
      const state = useImportDialog.getState();
      if (p && state.open && state.mode === "file" && state.path === path) useImportDialog.setState({ path: p });
    } catch (e) {
      setStartError(errorMessage(e));
    } finally {
      picking.current = false;
    }
  };

  const start = async () => {
    if (!path || running) return;
    setStarting(true);
    setStartError(null);
    try {
      const id = await api.importPack(path, name.trim() || null);
      setTaskId(id);
      const finalName = name.trim() || preview.data?.name || baseName(path);
      waitForTask(id)
        .then((done) => {
          const go = openRef.current && useImportDialog.getState().path === path;
          if (go) close();
          finishNewInstance(done.instance_id, finalName, go);
        })
        .catch(() => {
          /* Fehler zeigt der Dialog bzw. die Aufgabenliste */
        });
    } catch (e) {
      setStartError(errorMessage(e));
    } finally {
      setStarting(false);
    }
  };

  const p = preview.data;
  const external = useExternalImport(open && (mode === "launcher" || mode === "folder"), mode === "folder", close);
  const selectSource = (source: ImportMode) => {
    setStartError(null);
    useImportDialog.setState({ mode: source });
    if (source === "file") void choose();
  };
  const externalMode = mode === "launcher" || mode === "folder";
  const title = mode === "source" ? t("import.title_any")
    : externalMode && external.progressView ? t(external.busy ? "import.progress_title" : "import.finished_title")
    : mode === "file" && (running || p) ? t(running ? "import.progress_title" : "import.review_title")
    : t(`import.source.${mode}`);
  const description = mode === "source" ? t("import.choose_source")
    : running || (externalMode && external.progressView) ? undefined
    : mode === "file" && p ? t("import.review_description")
    : t(`import.source.${mode}.desc`);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && close()}
      title={title}
      description={description}
      size="xl"
      className="[&_.vl-dialog-foot]:flex-wrap [&_.vl-dialog-head_p]:text-[14px]"
      footer={
        mode === "source" ? (
          <>
            <div className="mr-auto"><HelpLink guide="import" /></div>
            <Button variant="subtle" onClick={close}>{t("common.cancel")}</Button>
          </>
        ) : externalMode ? (
          <>
            {!external.progressView && <div className="mr-auto">{backButton}</div>}
            {external.footer}
          </>
        ) : running ? (
          <Button variant="ghost" onClick={close}>{t("install.background")}</Button>
        ) : (
          <>
            <div className="mr-auto">{backButton}</div>
            {path && (
              <Button variant={p ? "ghost" : "primary"} onClick={choose} icon={<FolderInput size={16} />}>
                {t("import.other_file")}
              </Button>
            )}
            {p && (
              <Button variant="primary" disabled={!name.trim()} onClick={start} icon={<Upload size={16} />}>
                {failed ? t("common.retry") : t("import.start")}
              </Button>
            )}
          </>
        )
      }
    >
      <div data-tour="import-body" key={mode}>
        {mode === "source" ? (
          <ImportSources onSelect={selectSource} />
        ) : externalMode ? (
          external.body
        ) : running ? (
          <div role="status" className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
            <div className="break-words text-[16px] font-semibold text-text">{name}</div>
            <Progress value={task?.progress ?? null} />
            <div className="break-words text-[14px] text-muted">{task?.message || t("import.running")}</div>
          </div>
        ) : (
          <>
            {!path ? (
              <button
                onClick={choose}
                // Sichtbare Ablagefläche (gestrichelt), damit klar ist: hier klicken oder Datei hineinziehen
                className="group flex w-full flex-col items-center justify-center gap-3 rounded-card border-2 border-dashed border-line2 bg-surface/60 px-6 py-10 text-center transition-colors duration-150 hover:border-accent/60 hover:bg-surface"
              >
                <span className="grid h-12 w-12 place-items-center rounded-card bg-surface2 text-muted transition-colors group-hover:text-accent">
                  <FileArchive size={22} />
                </span>
                <span className="text-[17px] font-semibold text-text">{t("import.drop_or_choose")}</span>
                <span className="text-[14px] text-muted">{t("import.formats_named")}</span>
              </button>
            ) : preview.isPending ? (
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-4">
                  <Skeleton className="h-16 w-16" />
                  <div className="flex flex-1 flex-col gap-2">
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                </div>
                <Skeleton className="h-[62px]" />
                <Skeleton className="h-10" />
              </div>
            ) : preview.isError ? (
              <div role="alert" className="flex items-start gap-3 rounded-card bg-danger/[.08] px-4 py-3">
                <AlertTriangle size={18} className="mt-0.5 shrink-0 text-danger" />
                <div className="min-w-0">
                  <div className="text-[16px] font-semibold text-text">{t("import.preview_failed")}</div>
                  <div className="selectable mt-1 break-words text-[14px] text-muted">{errorMessage(preview.error)}</div>
                  <div className="mt-1.5 truncate text-caption text-dim">{baseName(path)}</div>
                </div>
              </div>
            ) : p ? (
              <div className="flex flex-col gap-5">
                {failed && (
                  <div role="alert" className="flex flex-col gap-2 rounded-card bg-danger/[.08] p-4 animate-fade-in">
                    <div className="flex justify-between">
                      <span className="label">{t("import.failed")}</span>
                      <span className="text-caption tabular-nums text-muted">{task?.progress != null ? `${Math.round(task.progress * 100)} %` : ""}</span>
                    </div>
                    <Progress value={task?.progress ?? null} tone="danger" />
                    <div className="selectable min-h-5 break-words text-[12px] text-dim">{task?.error ?? t("tasks.cancelled")}</div>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-4 rounded-card border border-line bg-surface p-4">
                  <ProjectIcon src={p.icon} size={64} eager />
                  <div className="min-w-0 flex-1">
                    <div className="break-words text-[18px] font-semibold text-text">{p.name}</div>
                    <div className="mt-0.5 break-words text-[14px] text-muted">
                      {[p.version_name, p.author && t("discover.by", { author: p.author })].filter(Boolean).join(" · ") || baseName(path)}
                    </div>
                  </div>
                  <Pill>{formatNames[p.format] ?? p.format}</Pill>
                </div>
                <div className="grid grid-cols-3 gap-2 max-[560px]:grid-cols-1">
                  <Fact label={t("discover.filter.version")} value={p.mc_version} />
                  <Fact label={t("discover.filter.loader")} value={formatLoader(p.loader)} />
                  <Fact label={t("import.files")} value={p.file_count.toLocaleString()} />
                </div>
                <Field label={t("import.name")} error={!name.trim() ? t("import.name_required") : undefined}>
                  <Input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && start()} />
                </Field>
                {p.files.length > 0 && <ImportFileList files={p.files} />}
              </div>
            ) : null}
            {startError && (
              <div role="alert" className="mt-4 flex items-start gap-2 rounded-card bg-danger/[.08] p-3 text-[14px] text-danger">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span className="selectable break-words">{startError}</span>
              </div>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-card bg-surface px-3.5 py-2.5">
      <div className="text-[13px] font-medium text-muted">{label}</div>
      <div className="mt-0.5 break-words text-[15px] tabular-nums text-text">{value}</div>
    </div>
  );
}
