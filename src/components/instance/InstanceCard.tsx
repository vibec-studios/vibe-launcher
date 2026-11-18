// Instanz-Kacheln: Raster-Kachel (Bibliothek, rahmenlos – das Bild trägt) und Listenzeile.
// Klick öffnet, Rechtsklick = Aktionsmenü, Spielen-Knopf erscheint beim Hover über dem Bild.
import { memo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpCircle } from "lucide-react";
import { api } from "@/lib/api";
import type { Instance } from "@/lib/types";
import { AnimatedNumber, ContextMenu, Progress, cn } from "@/components/ui";
import { formatDuration, formatRelative, imageSrc, instanceAccent, loaderNames } from "@/lib/format";
import { useT } from "@/i18n";
import { InstanceIcon, PixelBlock } from "./InstanceIcon";
import { InstanceContextMenuContent } from "./InstanceMenu";
import { PlayButton } from "./PlayButton";
import { useRunPhase } from "./status";
import { accentVars } from "./accent";

/** "Fabric 1.21.4" bzw. "Vanilla 1.21.4" */
export function loaderLine(i: Instance): string {
  return `${loaderNames[i.loader.kind]} ${i.mc_version}`;
}

/** Status-Text: läuft / Fortschritt / installiert / nicht installiert. */
export function InstanceStatus({ instance: i, compact }: { instance: Instance; compact?: boolean }) {
  const t = useT();
  const { phase, task } = useRunPhase(i.id);
  if (phase === "running")
    return (
      <span className="inline-flex items-center gap-1.5 text-ok">
        <span className="h-1.5 w-1.5 rounded-dot bg-ok" />
        {t("inst.status.running")}
      </span>
    );
  if (phase !== "idle")
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5 text-accent">
        <span className="truncate">{compact ? t("inst.preparing") : (task?.message ?? t("inst.preparing"))}</span>
        {task?.progress != null && (
          <span className="shrink-0 tabular-nums">
            <AnimatedNumber value={Math.round(task.progress * 100)} />%
          </span>
        )}
      </span>
    );
  if (i.install_state === "installed") return <span className="text-muted">{t("inst.status.installed")}</span>;
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

function CardProgress({ id }: { id: string }) {
  const { phase, task } = useRunPhase(id);
  if (phase !== "busy" && phase !== "preparing") return null;
  return <Progress value={task?.progress ?? null} className="absolute inset-x-0 bottom-0 h-[3px]" />;
}

function RunningBadge({ id }: { id: string }) {
  const t = useT();
  const { phase } = useRunPhase(id);
  if (phase !== "running") return null;
  return (
    <span className="absolute left-2 top-2 inline-flex h-6 items-center gap-1.5 rounded-pill bg-black/70 px-2 text-[12px] font-medium text-ok">
      <span className="h-1.5 w-1.5 rounded-dot bg-ok" />
      {t("inst.status.running")}
    </span>
  );
}

/** „N Updates“ (Hintergrundprüfung im Backend, höchstens alle 30 min). OWNER Badge: Content-Agent. */
function UpdatesBadge({ id }: { id: string }) {
  const t = useT();
  const { data } = useQuery({ queryKey: ["update-counts"], queryFn: api.contentUpdateCounts, staleTime: 60_000, refetchInterval: 120_000 });
  const n = data?.[id] ?? 0;
  if (!n) return null;
  return (
    <span className="absolute right-2 top-2 inline-flex h-6 items-center gap-1 rounded-pill bg-black/70 px-2 text-[12px] font-medium text-accent">
      <ArrowUpCircle size={12} />
      {n === 1 ? t("instances.updates_badge_1") : t("instances.updates_badge", { n })}
    </span>
  );
}

/** Icon füllt die Fläche (eigenes Bild) bzw. Pixel-Block in der Akzentfarbe auf leicht getönter Fläche. */
function IconArea({ instance: i, accent }: { instance: Instance; accent: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const src = imageSrc(i.icon);
  if (src && failed !== src)
    return (
      <img
        src={src}
        alt=""
        draggable={false}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(src)}
        className="absolute inset-0 h-full w-full object-cover [image-rendering:pixelated]"
      />
    );
  return (
    <div className="absolute inset-0 grid place-items-center bg-surface2">
      <PixelBlock color={accent} size={60} />
    </div>
  );
}

/** Raster-Karte der Bibliothek. */
export const InstanceCard = memo(function InstanceCard({ instance: i, onOpen }: { instance: Instance; onOpen: (i: Instance) => void }) {
  const accent = instanceAccent(i.id, i.accent);
  return (
    <ContextMenu content={<InstanceContextMenuContent instance={i} />}>
      <div
        role="button"
        tabIndex={0}
        aria-label={i.name}
        onClick={() => onOpen(i)}
        onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && onOpen(i)}
        style={accentVars(accent)}
        className={cn(
          "vl-card group relative flex min-w-0 flex-col rounded-panel p-1.5 text-left transition-colors duration-100",
          "hover:bg-white/[.04] data-[state=open]:bg-white/[.04]",
        )}
      >
        <div className="vl-zoom relative aspect-[4/3] overflow-hidden rounded-card bg-surface2">
          <IconArea instance={i} accent={accent} />
          <RunningBadge id={i.id} />
          <UpdatesBadge id={i.id} />
          <div className="absolute bottom-2 right-2 translate-y-1 opacity-0 transition-[opacity,transform] duration-150 group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:translate-y-0 group-hover:opacity-100">
            <PlayButton instance={i} size="icon" />
          </div>
          <CardProgress id={i.id} />
        </div>
        <div className="min-w-0 px-1 pb-0.5 pt-2">
          <div className="truncate text-[13.5px] font-semibold text-text" title={i.name}>
            {i.name}
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-muted">
            <span className="truncate">{loaderLine(i)}</span>
            <StatusDot instance={i} />
          </div>
        </div>
      </div>
    </ContextMenu>
  );
});

/** Kleiner Hinweis hinter der Versionszeile (nur wenn nicht „installiert & bereit“). */
function StatusDot({ instance: i }: { instance: Instance }) {
  const { phase } = useRunPhase(i.id);
  if (phase === "running" || (phase === "idle" && (i.install_state === "installed" || i.install_state === "not_installed"))) return null;
  return (
    <>
      <span className="text-dim">·</span>
      <span className="min-w-0 truncate">
        <InstanceStatus instance={i} compact />
      </span>
    </>
  );
}

export function InstanceCardSkeleton() {
  return (
    <div className="flex flex-col p-1.5">
      <div className="skeleton aspect-[4/3] rounded-card" />
      <div className="flex flex-col gap-1.5 px-1 pb-0.5 pt-2.5">
        <div className="skeleton h-4 w-3/4" />
        <div className="skeleton h-3 w-1/2" />
      </div>
    </div>
  );
}

/** Kompakte Zeile der Bibliothek (Listenansicht): Icon, Name, Loader/Version, zuletzt gespielt, Spielzeit, Spielen. */
export const InstanceListRow = memo(function InstanceListRow({ instance: i, onOpen }: { instance: Instance; onOpen: (i: Instance) => void }) {
  const t = useT();
  const accent = instanceAccent(i.id, i.accent);
  return (
    <ContextMenu content={<InstanceContextMenuContent instance={i} />}>
      <div
        role="button"
        tabIndex={0}
        aria-label={i.name}
        onClick={() => onOpen(i)}
        onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && onOpen(i)}
        style={accentVars(accent)}
        className="group relative grid h-11 min-w-0 grid-cols-[32px_minmax(0,1fr)_36px] items-center gap-3 overflow-hidden rounded-ctl px-2 transition-colors duration-100 hover:bg-white/[.04] data-[state=open]:bg-white/[.04] @min-[640px]:grid-cols-[32px_minmax(0,1fr)_150px_36px] @min-[860px]:grid-cols-[32px_minmax(0,1fr)_150px_130px_90px_36px]"
      >
        <InstanceIcon icon={i.icon} accent={accent} size={32} />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[13.5px] font-semibold text-text">{i.name}</span>
            <span className="min-w-0 truncate text-[12px] empty:hidden">
              <StatusHint instance={i} />
            </span>
          </div>
          {i.source && <div className="truncate text-[11.5px] leading-tight text-dim">{i.source.name ?? t("inst.modpack")}</div>}
        </div>
        <span className="hidden truncate text-[12.5px] text-muted @min-[640px]:block">{loaderLine(i)}</span>
        <span className="hidden truncate text-[12.5px] text-muted @min-[860px]:block">{i.last_played ? formatRelative(i.last_played) : t("inst.never_played")}</span>
        <span className="hidden truncate text-right text-[12.5px] tabular-nums text-dim @min-[860px]:block">{i.play_time_secs >= 60 ? formatDuration(i.play_time_secs) : "–"}</span>
        <span className="flex justify-end opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
          <PlayButton instance={i} size="icon" subtle />
        </span>
        <CardProgress id={i.id} />
      </div>
    </ContextMenu>
  );
});
