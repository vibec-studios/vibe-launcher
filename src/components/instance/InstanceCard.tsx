// Instanz-Karte für Raster (Instanzen-Seite, Startseite). Rechtsklick = Aktionsmenü, Doppelklick = öffnen.
import { memo } from "react";
import { Clock, Hourglass } from "lucide-react";
import type { Instance } from "@/lib/types";
import { ContextMenu, Progress, Tag, cn } from "@/components/ui";
import { formatDuration, formatRelative, instanceAccent, loaderColors, loaderNames } from "@/lib/format";
import { useT } from "@/i18n";
import { InstanceIcon } from "./InstanceIcon";
import { InstanceContextMenuContent } from "./InstanceMenu";
import { PlayButton } from "./PlayButton";
import { useRunPhase } from "./status";
import { accentVars } from "./accent";

export function LoaderTag({ instance: i }: { instance: Instance }) {
  return <Tag color={loaderColors[i.loader.kind]}>{loaderNames[i.loader.kind]}</Tag>;
}

/** Status-Zeile: läuft / Fortschritt / installiert / nicht installiert. */
export function InstanceStatus({ instance: i, compact }: { instance: Instance; compact?: boolean }) {
  const t = useT();
  const { phase, task } = useRunPhase(i.id);
  if (phase === "running")
    return (
      <span className="flex items-center gap-1.5 text-ok">
        <span className="h-1.5 w-1.5 animate-pulse bg-ok" />
        {t("inst.status.running")}
      </span>
    );
  if (phase !== "idle")
    return (
      <span className="flex min-w-0 items-center gap-2 text-accent">
        <span className="truncate">{compact ? t("inst.preparing") : (task?.message ?? t("inst.preparing"))}</span>
        {task?.progress != null && <span className="shrink-0">{Math.round(task.progress * 100)}%</span>}
      </span>
    );
  if (i.install_state === "installed") return <span className="text-dim">{t("inst.status.installed")}</span>;
  if (i.install_state === "failed") return <span className="text-danger">{t("inst.status.failed")}</span>;
  if (i.install_state === "installing") return <span className="text-accent">{t("inst.status.installing")}</span>;
  return <span className="text-warn">{t("inst.status.not_installed")}</span>;
}

/** Status nur, wenn er etwas Besonderes sagt (läuft, Fortschritt, nicht installiert …). */
export function StatusHint({ instance: i }: { instance: Instance }) {
  const { phase } = useRunPhase(i.id);
  if (phase === "idle" && i.install_state === "installed") return null;
  return <InstanceStatus instance={i} compact />;
}

/** Rechts in der Fußzeile: Live-Status oder Hinweis, sonst die Spielzeit. */
function CardRight({ instance: i }: { instance: Instance }) {
  const t = useT();
  const { phase } = useRunPhase(i.id);
  if (phase !== "idle" || i.install_state !== "installed") return <InstanceStatus instance={i} compact />;
  if (i.play_time_secs <= 0) return null;
  return (
    <span className="flex items-center gap-1.5" title={t("inst.play_time")}>
      <Hourglass size={11} />
      {formatDuration(i.play_time_secs)}
    </span>
  );
}

function CardProgress({ id }: { id: string }) {
  const { phase, task } = useRunPhase(id);
  if (phase !== "busy" && phase !== "preparing") return null;
  return <Progress value={task?.progress ?? null} className="absolute inset-x-0 bottom-0 h-[2px]" />;
}

export const InstanceCard = memo(function InstanceCard({ instance: i, onOpen }: { instance: Instance; onOpen: (i: Instance) => void }) {
  const t = useT();
  const accent = instanceAccent(i.id, i.accent);
  return (
    <ContextMenu content={<InstanceContextMenuContent instance={i} />}>
      <div
        role="button"
        tabIndex={0}
        aria-label={i.name}
        onDoubleClick={() => onOpen(i)}
        onKeyDown={(e) => e.key === "Enter" && onOpen(i)}
        style={accentVars(accent)}
        className={cn(
          "group relative flex min-w-0 flex-col border border-line bg-surface text-left transition-[border-color,background-color,box-shadow] duration-150",
          "hover:border-line2 hover:bg-surface2 data-[state=open]:border-line2 data-[state=open]:bg-surface2",
          "focus-visible:border-accent",
        )}
      >
        <div className="h-[2px] w-full bg-accent" />
        <div
          className="relative flex items-end gap-3.5 px-4 pb-3.5 pt-4"
          style={{ background: `linear-gradient(180deg, color-mix(in srgb, ${accent} 16%, transparent), transparent)` }}
        >
          <InstanceIcon icon={i.icon} accent={accent} size={52} />
          <div className="min-w-0 flex-1 pb-0.5">
            <div className="truncate text-[15px] font-semibold leading-tight text-white" title={i.name}>
              {i.name}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Tag>{i.mc_version}</Tag>
              <LoaderTag instance={i} />
            </div>
          </div>
          <div className="absolute right-3 top-3 translate-y-1 opacity-0 transition-[opacity,transform] duration-150 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100">
            <PlayButton instance={i} size="icon" />
          </div>
        </div>
        <div className="flex items-center gap-3 border-t border-line px-4 py-2.5 font-mono text-[11px] text-dim">
          <span className="flex min-w-0 items-center gap-1.5" title={t("inst.last_played")}>
            <Clock size={11} className="shrink-0" />
            <span className="truncate">{i.last_played ? formatRelative(i.last_played) : t("inst.never_played")}</span>
          </span>
          <span className="ml-auto flex min-w-0 shrink-0 items-center justify-end">
            <CardRight instance={i} />
          </span>
        </div>
        <CardProgress id={i.id} />
      </div>
    </ContextMenu>
  );
});

export function InstanceCardSkeleton() {
  return (
    <div className="flex flex-col border border-line bg-surface">
      <div className="h-[2px] w-full bg-white/10" />
      <div className="flex items-end gap-3.5 px-4 pb-3.5 pt-4">
        <div className="skeleton h-[52px] w-[52px]" />
        <div className="flex flex-1 flex-col gap-2 pb-0.5">
          <div className="skeleton h-4 w-3/4" />
          <div className="skeleton h-4 w-1/2" />
        </div>
      </div>
      <div className="flex border-t border-line px-4 py-2.5">
        <div className="skeleton h-3 w-24" />
      </div>
    </div>
  );
}
