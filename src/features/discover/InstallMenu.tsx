// Installieren mit Instanzwahl: Knopf mit Ausklapp-Liste aller Instanzen (passende zuerst), je Instanz der Status
// „Installiert“ / Fortschritt / „Nicht für …“. Im Ziel-Instanz-Modus installiert der Knopf direkt.
// CurseForge-Projekte ohne Freigabe für andere Launcher: „Auf CurseForge herunterladen“ öffnet die Dateiseite der
// passenden Version und merkt die Datei vor (Übernahme aus dem Download-Ordner); „Zur Instanz hinzufügen“ merkt nur vor.
import { Check, Download, FolderPlus } from "lucide-react";
import { memo } from "react";
import { Button, Progress, Tooltip, cn, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import type { Instance } from "@/lib/types";
import { openInstall } from "@/components/content/installStore";
import { installKey, packKey, startContentInstall } from "@/components/content/install";
import { compatibility } from "@/components/content/util";
import { InstancePicker } from "./install/InstancePicker";
import { ManualButton } from "./install/ManualButton";
import { stop, useInstallProgress, type P } from "./install/shared";

export const InstallMenu = memo(function InstallMenu({
  project,
  target,
  installed,
  size = "sm",
  wide,
}: {
  project: P;
  /** Ziel-Instanz-Modus: direkt in diese Instanz */
  target?: Instance | null;
  /** Bereits in der Ziel-Instanz installiert */
  installed?: boolean;
  size?: "sm" | "md";
  /** Haupt-Knopf (Projektseite): gefüllt in der Akzentfarbe */
  wide?: boolean;
}) {
  const t = useT();
  const isPack = project.project_type === "modpack";
  const task = useInstallProgress(target && !isPack ? installKey(target.id, project) : packKey(project));
  const manual = !!project.manual_download && !isPack;

  if (task && task.status === "running") {
    return (
      <div className={cn("flex flex-col justify-center gap-1.5", size === "md" ? "h-9 w-[160px]" : "h-8 w-[118px]")} onClick={stop}>
        <span className="flex items-center justify-between text-[12px] text-muted">
          {t("install.installing")}
          <span className="tabular-nums">{task.progress != null ? `${Math.round(task.progress * 100)} %` : ""}</span>
        </span>
        <Progress value={task.progress} />
      </div>
    );
  }
  if (isPack) {
    return (
      <Button
        size={size}
        variant={wide ? "primary" : "ghost"}
        icon={<FolderPlus size={size === "md" ? 15 : 13} />}
        onClick={(e) => {
          e.stopPropagation();
          openInstall({ project });
        }}
      >
        {wide ? t("install.as_new_instance_short") : t("common.install")}
      </Button>
    );
  }
  if (target) {
    if (installed || task?.status === "done") {
      return (
        <span className={cn("inline-flex items-center gap-1.5 px-2 text-[13px] font-semibold text-ok", size === "md" ? "h-9" : "h-8")}>
          <Check size={14} strokeWidth={2.5} />
          {t("common.installed")}
        </span>
      );
    }
    const c = compatibility(project, target);
    if (manual) return <ManualButton project={project} target={target} ok={c.ok} size={size} wide={wide} />;
    return (
      <Tooltip content={c.ok ? null : t("discover.maybe_incompatible")}>
        <Button
          size={size}
          variant={c.ok ? (wide ? "primary" : "accent") : "ghost"}
          icon={<Download size={size === "md" ? 15 : 13} />}
          onClick={(e) => {
            e.stopPropagation();
            if (!c.ok) return openInstall({ project, instanceId: target.id });
            startContentInstall(target.id, project, null).catch((err) => toast.error(t("install.failed", { name: project.title }), errorMessage(err)));
          }}
        >
          {wide ? t("project.install_into", { name: target.name }) : t("common.install")}
        </Button>
      </Tooltip>
    );
  }
  return <InstancePicker project={project} size={size} wide={wide} />;
});
