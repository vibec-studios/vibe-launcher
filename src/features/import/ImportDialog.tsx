// OWNER: Frontend-Agent B. Öffnen von überall: `openImport()` bzw. `openImport(path)`.
// Ablauf: Datei wählen/ablegen -> Vorschau (`importPreview`) -> Import (Task) -> `instanceInstall(neueId)` -> zur Instanz.
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, FileArchive, FolderInput, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { Button, Dialog, Field, Input, Progress, Segmented, Skeleton } from "@/components/ui";
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

export type ImportMode = "file" | "launcher";
interface ImportState {
  open: boolean;
  path: string | null;
  /** "file" = Modpack-Datei, "launcher" = aus anderem Launcher übernehmen */
  mode: ImportMode;
}
export const useImportDialog = create<ImportState>(() => ({ open: false, path: null, mode: "file" }));

/** Import-Dialog öffnen, optional direkt mit einer Datei oder im Launcher-Modus. */
export function openImport(path: string | null = null, mode?: ImportMode) {
  useImportDialog.setState((s) => ({ open: true, path, mode: path ? "file" : (mode ?? s.mode) }));
}

export const PACK_EXTENSIONS = ["mrpack", "zip", "vlpack"];

const formatNames: Record<PackFormat, string> = {
  mrpack: "Modrinth (.mrpack)",
  curseforge: "CurseForge (.zip)",
  vlpack: "Vibe Launcher (.vlpack)",
  prism: "Prism Launcher",
  multimc: "MultiMC",
};

export async function pickPackFile(title: string, filterName: string): Promise<string | null> {
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
  const running = task?.status === "running" || starting;
  const failed = task?.status === "failed" || task?.status === "cancelled";

  const close = () => useImportDialog.setState({ open: false });
  const choose = async () => {
    try {
      const p = await pickPackFile(t("import.choose"), t("import.filter"));
      if (p) useImportDialog.setState({ path: p });
    } catch (e) {
      setStartError(errorMessage(e));
    }
  };

  const start = async () => {
    if (!path) return;
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
  const external = useExternalImport(open && mode === "launcher", close);
  const modeSwitch = !running && !(path && mode === "file") && !(mode === "launcher" && external.progressView) && (
    <Segmented<ImportMode>
      className="mb-4"
      value={mode}
      onChange={(m) => useImportDialog.setState({ mode: m })}
      items={[
        { value: "file", label: t("import.mode.file") },
        { value: "launcher", label: t("import.mode.launcher") },
      ]}
    />
  );

  if (mode === "launcher") {
    return (
      <Dialog
        open={open}
        onOpenChange={(o) => !o && close()}
        title={t("import.title_any")}
        description={t("import.description_launcher")}
        size="lg"
        footer={external.footer}
      >
        {modeSwitch}
        {external.body}
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && close()}
      title={t("import.title")}
      description={t("import.description")}
      size="md"
      footer={
        running ? (
          <Button variant="ghost" onClick={close}>
            {t("install.background")}
          </Button>
        ) : (
          <>
            <Button variant="subtle" onClick={close}>
              {t("common.cancel")}
            </Button>
            {path && (
              <Button variant="ghost" onClick={choose} icon={<FolderInput size={14} />}>
                {t("import.other_file")}
              </Button>
            )}
            <Button variant="primary" disabled={!p || !name.trim()} onClick={start} icon={<Upload size={14} />}>
              {failed ? t("common.retry") : t("import.start")}
            </Button>
          </>
        )
      }
    >
      {modeSwitch}
      {!path ? (
        <button
          onClick={choose}
          className="flex w-full flex-col items-center justify-center gap-3 border border-dashed border-line2 px-6 py-12 text-center transition-colors duration-150 hover:border-accent hover:bg-white/[.02]"
        >
          <FileArchive size={28} className="text-brand" />
          <span className="text-[15px] font-semibold text-white">{t("import.drop_or_choose")}</span>
          <span className="text-[12.5px] text-muted">{t("import.formats")}</span>
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
        <div className="flex items-start gap-3 border border-danger/30 bg-danger/[.06] px-4 py-3.5">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-danger" />
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-white">{t("import.preview_failed")}</div>
            <div className="selectable mt-1 break-words text-[12.5px] text-muted">{errorMessage(preview.error)}</div>
            <div className="mt-1.5 truncate font-mono text-[11px] text-dim">{baseName(path)}</div>
          </div>
        </div>
      ) : p ? (
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-4">
            <ProjectIcon src={p.icon} size={64} eager />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[16px] font-semibold text-white">{p.name}</div>
              <div className="mt-0.5 truncate text-[12.5px] text-dim">
                {[p.version_name, p.author && t("discover.by", { author: p.author })].filter(Boolean).join(" · ") || baseName(path)}
              </div>
            </div>
            <Pill>{formatNames[p.format] ?? p.format}</Pill>
          </div>
          <div className="grid grid-cols-3 gap-px border border-line bg-line">
            <Fact label={t("discover.filter.version")} value={p.mc_version} />
            <Fact label={t("discover.filter.loader")} value={formatLoader(p.loader)} />
            <Fact label={t("import.files")} value={p.file_count.toLocaleString()} />
          </div>
          <Field label={t("import.name")} error={!name.trim() ? t("import.name_required") : undefined}>
            <Input value={name} onChange={(e) => setName(e.target.value)} disabled={running} onKeyDown={(e) => e.key === "Enter" && !running && name.trim() && start()} />
          </Field>
          {(running || task) && (
            <div className="flex flex-col gap-2 animate-fade-in">
              <div className="flex justify-between">
                <span className="label">{failed ? t("import.failed") : t("import.running")}</span>
                <span className="font-mono text-[11px] text-muted">{task?.progress != null ? `${Math.round(task.progress * 100)} %` : ""}</span>
              </div>
              <Progress value={task?.progress ?? null} tone={failed ? "danger" : "accent"} />
              <div className="selectable min-h-5 break-words text-[12px] text-dim">{failed ? (task?.error ?? t("tasks.cancelled")) : (task?.message ?? "")}</div>
            </div>
          )}
        </div>
      ) : null}
      {startError && (
        <div className="mt-4 flex items-start gap-2 text-[12.5px] text-danger">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span className="selectable break-words">{startError}</span>
        </div>
      )}
    </Dialog>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 bg-[#07070a] px-3.5 py-2.5">
      <div className="label">{label}</div>
      <div className="mt-0.5 truncate font-mono text-[13px] text-white">{value}</div>
    </div>
  );
}
