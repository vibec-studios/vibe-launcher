import { Check, Clock, Download, ExternalLink, ListFilter, ListPlus } from "lucide-react";
import { Progress, Spinner, Tooltip, cn, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { formatLoader } from "@/lib/format";
import type { Instance } from "@/lib/types";
import { InstanceBadge } from "@/components/content/InstanceBadge";
import { openInstall } from "@/components/content/installStore";
import { installKey, startContentInstall, startManualDownload, useExpected } from "@/components/content/install";
import { useInstallProgress, type P } from "./shared";

export function PickerRow({
  inst,
  project,
  ok,
  reason,
  installed,
  checking,
  close,
}: {
  inst: Instance;
  project: P;
  ok: boolean;
  reason: "loader" | "version" | "vanilla" | null;
  installed: boolean;
  checking: boolean;
  close: () => void;
}) {
  const t = useT();
  const task = useInstallProgress(installKey(inst.id, project));
  const running = task?.status === "running";
  const manual = !!project.manual_download;
  const expected = useExpected(installKey(inst.id, project));
  const done = installed || (!manual && task?.status === "done");
  const note =
    reason === "vanilla"
      ? t("install.incompat.vanilla")
      : reason === "loader"
        ? t("install.incompat.loader", { loader: formatLoader(inst.loader) })
        : reason === "version"
          ? t("install.incompat.version", { version: inst.mc_version })
          : null;
  return (
    <button
      disabled={running}
      onClick={() => {
        if (done || !ok) {
          close();
          openInstall({ project, instanceId: inst.id });
          return;
        }
        if (manual) {
          startManualDownload(inst.id, project, null).catch(() => {});
          return;
        }
        startContentInstall(inst.id, project, null).catch((e) => toast.error(t("install.failed", { name: project.title }), errorMessage(e)));
      }}
      className="group flex h-11 w-full items-center gap-2.5 rounded-ctl px-2 text-left outline-none transition-colors hover:bg-white/[.07] focus-visible:bg-white/[.07]"
    >
      <span className={cn(!ok && "opacity-50")}>
        <InstanceBadge instance={inst} size={26} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-[13px] font-medium leading-tight", ok ? "text-text" : "text-muted")}>{inst.name}</span>
        <span className="block truncate text-[11.5px] leading-tight text-dim">{note ?? `${inst.mc_version} · ${formatLoader(inst.loader)}`}</span>
      </span>
      {manual && ok && !done && !running && (
        <Tooltip content={<span className="block max-w-[240px] leading-snug">{t("manual.add_tip")}</span>}>
          <span
            role="button"
            tabIndex={-1}
            aria-label={t("manual.add")}
            onClick={(e) => {
              e.stopPropagation();
              startManualDownload(inst.id, project, null, { open: false }).catch(() => {});
            }}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-ctl text-dim opacity-0 transition-opacity hover:bg-white/[.08] hover:text-text group-hover:opacity-100 group-focus-visible:opacity-100"
          >
            <ListPlus size={14} />
          </span>
        </Tooltip>
      )}
      <span className={cn("flex shrink-0 justify-end whitespace-nowrap text-[12px]", manual ? "w-[104px]" : "w-[78px]")}>
        {running ? (
          <span className="flex w-full flex-col gap-1">
            <span className="text-right tabular-nums text-muted">{task?.progress != null ? `${Math.round(task.progress * 100)} %` : ""}</span>
            <Progress value={task?.progress ?? null} />
          </span>
        ) : done ? (
          <span className="flex items-center gap-1 font-semibold text-ok">
            <Check size={13} strokeWidth={2.5} />
            {t("common.installed")}
          </span>
        ) : checking ? (
          <Spinner size={11} className="text-dim" />
        ) : expected ? (
          <span className="flex items-center gap-1 font-medium text-muted">
            <Clock size={12} />
            {t("manual.expected")}
          </span>
        ) : (
          <span className={cn("flex items-center gap-1 font-semibold opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100", ok ? "text-text" : "text-muted")}>
            {!ok ? <ListFilter size={13} /> : manual ? <ExternalLink size={13} /> : <Download size={13} />}
            {!ok ? t("discover.install_pick_version") : manual ? t("missing.download") : t("common.install")}
          </span>
        )}
      </span>
    </button>
  );
}
