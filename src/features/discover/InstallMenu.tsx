// Installieren mit Instanzwahl: Knopf mit Ausklapp-Liste aller Instanzen (passende zuerst), je Instanz der Status
// „Installiert“ / Fortschritt / „Nicht für …“. Im Ziel-Instanz-Modus installiert der Knopf direkt.
// CurseForge-Projekte ohne Freigabe für andere Launcher: „Auf CurseForge herunterladen“ öffnet die Dateiseite der
// passenden Version und merkt die Datei vor (Übernahme aus dem Download-Ordner); „Zur Instanz hinzufügen“ merkt nur vor.
import * as Popover from "@radix-ui/react-popover";
import { useQueries } from "@tanstack/react-query";
import { Check, ChevronDown, Clock, Download, ExternalLink, FolderPlus, ListFilter, ListPlus, Plus } from "lucide-react";
import { memo, useMemo, useState, type MouseEvent } from "react";
import { Button, DropdownItem, DropdownMenu, Progress, Spinner, Tooltip, cn, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { formatLoader } from "@/lib/format";
import { qk, useTask, useJavaInstances } from "@/lib/queries";
import type { Instance, ProjectHit } from "@/lib/types";
import { InstanceBadge } from "@/components/content/InstanceBadge";
import { ManualBadge } from "@/components/content/ManualBadge";
import { openInstall, type InstallProject } from "@/components/content/installStore";
import { installKey, packKey, startContentInstall, startManualDownload, useExpected, useInstallTasks } from "@/components/content/install";
import { compatibility, contentKindOf, navigateTo } from "@/components/content/util";

type P = InstallProject & Pick<ProjectHit, "game_versions" | "loaders" | "manual_download">;

const stop = (e: MouseEvent) => e.stopPropagation();

/** Laufender Fortschritt für eine Instanz/ein Pack (oder null). */
function useInstallProgress(key: string) {
  const taskId = useInstallTasks((s) => s.tasks[key]);
  return useTask(taskId);
}

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

/** Ziel-Instanz-Modus für manuelle Downloads: „Auf CurseForge herunterladen“ (+ „Zur Instanz hinzufügen“). */
function ManualButton({ project, target, ok, size, wide }: { project: P; target: Instance; ok: boolean; size: "sm" | "md"; wide?: boolean }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const expected = useExpected(installKey(target.id, project));
  const run = (open: boolean) => {
    if (!ok) return openInstall({ project, instanceId: target.id });
    setBusy(true);
    startManualDownload(target.id, project, null, { open })
      .catch(() => {})
      .finally(() => setBusy(false));
  };
  const iconSize = size === "md" ? 15 : 13;
  if (expected)
    return (
      <Tooltip content={<span className="block max-w-[260px] leading-snug">{t("manual.expected_tip")}</span>}>
        <Button
          size={size}
          variant="ghost"
          icon={<Clock size={iconSize} />}
          loading={busy}
          onClick={(e) => {
            e.stopPropagation();
            run(true);
          }}
        >
          {t("manual.expected")}
        </Button>
      </Tooltip>
    );
  const main = (
    <Tooltip content={<span className="block max-w-[260px] leading-snug">{ok ? t("manual.download_tip") : t("discover.maybe_incompatible")}</span>}>
      <Button
        size={size}
        variant={ok ? (wide ? "primary" : "accent") : "ghost"}
        icon={<ExternalLink size={iconSize} />}
        loading={busy}
        onClick={(e) => {
          e.stopPropagation();
          run(true);
        }}
      >
        {wide ? t("manual.download") : t("manual.download_short")}
      </Button>
    </Tooltip>
  );
  if (!wide || !ok) return main;
  return (
    <div className="flex items-center gap-1" onClick={stop}>
      {main}
      <DropdownMenu
        trigger={
          <Button size={size} variant="subtle" className="px-2" aria-label={t("common.more")}>
            <ChevronDown size={14} />
          </Button>
        }
      >
        <DropdownItem icon={<ListPlus size={14} />} onSelect={() => run(false)}>
          <span className="flex flex-col py-0.5">
            <span>{t("manual.add")}</span>
            <span className="max-w-[240px] text-[11.5px] leading-snug text-dim">{t("manual.add_tip")}</span>
          </span>
        </DropdownItem>
      </DropdownMenu>
    </div>
  );
}

function InstancePicker({ project, size, wide }: { project: P; size: "sm" | "md"; wide?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const manual = !!project.manual_download;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button
          size={size}
          variant={wide ? "primary" : "ghost"}
          icon={manual ? <ExternalLink size={size === "md" ? 15 : 13} /> : <Download size={size === "md" ? 15 : 13} />}
          onClick={stop}
          className={cn("pr-2", open && !wide && "bg-surface3")}
          aria-haspopup="dialog"
        >
          {manual ? (wide ? t("manual.download") : t("manual.download_short")) : t("common.install")}
          <ChevronDown size={13} className={cn("ml-0.5 opacity-70 transition-transform duration-150", open && "rotate-180")} />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          collisionPadding={8}
          onClick={stop}
          className="z-[60] w-[300px] rounded-card bg-overlay p-1 shadow-e2 outline-none data-[state=open]:animate-[pop-in_.12s_var(--ease-snap)]"
        >
          {open && <PickerList project={project} close={() => setOpen(false)} />}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function PickerList({ project, close }: { project: P; close: () => void }) {
  const t = useT();
  const { data: instances, isPending } = useJavaInstances();
  const kind = contentKindOf(project.project_type);
  const list = useMemo(
    () =>
      (instances ?? [])
        .map((i) => ({ i, c: compatibility(project, i) }))
        .sort((a, b) => Number(b.c.ok) - Number(a.c.ok) || (b.i.last_played ?? 0) - (a.i.last_played ?? 0)),
    [instances, project],
  );
  // Installiert-Status je Instanz (gleicher Cache wie der Inhalte-Tab)
  const lists = useQueries({
    queries: list.map(({ i }) => ({
      queryKey: qk.content(i.id, kind ?? "mod"),
      queryFn: () => api.contentList(i.id, kind!),
      enabled: !!kind,
      staleTime: 30_000,
    })),
  });
  const installedIn = (idx: number) => !!lists[idx]?.data?.some((c) => c.project_id === project.id);

  return (
    <div className="flex flex-col">
      {project.manual_download && (
        <div className="mx-1 mb-1 mt-1 flex gap-2 rounded-ctl bg-warn/[.08] px-2.5 py-2 text-[12px] leading-snug text-muted">
          <ManualBadge iconOnly className="mt-px" />
          <span>{t("manual.picker_note")}</span>
        </div>
      )}
      <div className="px-2.5 pb-1 pt-2 text-[11px] font-semibold text-dim">{project.manual_download ? t("manual.download_for") : t("discover.install_in")}</div>
      {isPending ? (
        <div className="grid h-16 place-items-center">
          <Spinner size={14} />
        </div>
      ) : list.length === 0 ? (
        <div className="flex flex-col items-start gap-2 px-2.5 py-2">
          <p className="text-[12.5px] text-muted">{t("install.no_instances_text")}</p>
          <Button
            size="sm"
            variant="ghost"
            icon={<Plus size={13} />}
            onClick={() => {
              close();
              navigateTo({ to: "/instances" });
            }}
          >
            {t("install.create_instance")}
          </Button>
        </div>
      ) : (
        <div className="scroll max-h-[300px]">
          {list.map(({ i, c }, idx) => (
            <PickerRow key={i.id} inst={i} project={project} ok={c.ok} reason={c.ok ? null : c.reason} installed={installedIn(idx)} checking={!!kind && lists[idx]?.isPending} close={close} />
          ))}
        </div>
      )}
      <div className="-mx-1 my-1 h-px bg-line" />
      <button
        onClick={() => {
          close();
          openInstall({ project });
        }}
        className="flex h-8 items-center gap-2.5 rounded-ctl px-2.5 text-left text-[13px] text-muted outline-none transition-colors hover:bg-white/[.07] hover:text-text"
      >
        <ListFilter size={14} />
        {t("discover.install_choose")}
      </button>
    </div>
  );
}

function PickerRow({
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
