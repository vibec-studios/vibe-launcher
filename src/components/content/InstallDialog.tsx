// Wiederverwendbarer Installations-Dialog: Instanz wählen (kompatible zuerst), Version (neueste kompatible
// vorausgewählt), Fortschritt im Dialog. Modpacks: Version wählen -> als neue Instanz installieren.
// Öffnen von überall: `openInstall({ project, instanceId?, versionId? })`. Host sitzt in GlobalDropZone.
import { AlertTriangle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Dialog, Tag } from "@/components/ui";
import { useT } from "@/i18n";
import { useInstallDialog, type InstallTarget } from "./installStore";
import { ProjectIcon } from "./ProjectIcon";
import type { Phase } from "./installDialog/state";
import { DoneNote } from "./installDialog/DoneNote";
import { Footer } from "./installDialog/Footer";
import { Running } from "./installDialog/Running";
import { ContentSelect } from "./installDialog/ContentSelect";
import { PackSelect } from "./installDialog/PackSelect";

export function InstallDialogHost() {
  const target = useInstallDialog((s) => s.target);
  const seq = useInstallDialog((s) => s.seq);
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(!!target), [target, seq]);
  if (!target) return null;
  return (
    <InstallDialog
      key={seq}
      target={target}
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setTimeout(() => useInstallDialog.setState((s) => (s.seq === seq ? { target: null } : s)), 200);
      }}
    />
  );
}

function InstallDialog({ target, open, onOpenChange }: { target: InstallTarget; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const { project } = target;
  const isPack = project.project_type === "modpack";
  const [phase, setPhase] = useState<Phase>({ k: "select" });
  const openRef = useRef(open);
  openRef.current = open;

  const title = isPack ? t("install.pack_title") : t("install.title");

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      size="lg"
      className="[&_.vl-dialog-foot]:flex-wrap"
      footer={<Footer phase={phase} setPhase={setPhase} isPack={isPack} onClose={() => onOpenChange(false)} />}
    >
      <div className="flex flex-wrap items-center gap-4 rounded-card border border-line bg-surface p-4">
        <ProjectIcon src={project.icon_url} size={52} eager />
        <div className="min-w-0 flex-1">
          <div className="break-words text-[18px] font-semibold text-text">{project.title}</div>
          <div className="break-words text-[14px] text-muted">{t("discover.by", { author: project.author })}</div>
        </div>
        <Tag>{t(`discover.type.${project.project_type}`)}</Tag>
      </div>
      {phase.k === "select" &&
        (isPack ? (
          <PackSelect target={target} onStart={(id) => setPhase({ k: "running", taskId: id })} onError={(m) => setPhase({ k: "error", message: m })} isOpen={() => openRef.current} />
        ) : (
          <ContentSelect target={target} onStart={(id) => setPhase({ k: "running", taskId: id })} onError={(m) => setPhase({ k: "error", message: m })} />
        ))}
      {phase.k === "running" && <Running taskId={phase.taskId} isPack={isPack} onDone={(iid) => (isPack ? onOpenChange(false) : setPhase({ k: "done", instanceId: iid }))} onFail={(m) => setPhase({ k: "error", message: m })} />}
      {phase.k === "done" && <DoneNote name={project.title} manual={!!project.manual_download && !isPack} />}
      {phase.k === "error" && (
        <div role="alert" className="mt-5 flex items-start gap-3 rounded-card bg-danger/[.08] px-4 py-3 animate-fade-in">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-danger" />
          <div className="min-w-0">
            <div className="text-[16px] font-semibold text-text">{t("install.error_title")}</div>
            <div className="selectable mt-1 break-words text-[14px] text-muted">{phase.message}</div>
          </div>
        </div>
      )}
    </Dialog>
  );
}
