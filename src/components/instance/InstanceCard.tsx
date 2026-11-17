// Instanz-Karten im Stil eines Desktop-Launchers: Raster-Karte (Bibliothek) und kompakte Zeile (Start).
// Klick öffnet, Rechtsklick = Aktionsmenü, Spielen-Knopf erscheint beim Hover über dem Icon.
import { memo, useState } from "react";
import type { Instance } from "@/lib/types";
import { ContextMenu, Progress, cn } from "@/components/ui";
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
        <span className="h-1.5 w-1.5 bg-ok" />
        {t("inst.status.running")}
      </span>
    );
  if (phase !== "idle")
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5 text-accent">
        <span className="truncate">{compact ? t("inst.preparing") : (task?.message ?? t("inst.preparing"))}</span>
        {task?.progress != null && <span className="shrink-0 tabular-nums">{Math.round(task.progress * 100)}%</span>}
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
    <span className="absolute left-2 top-2 inline-flex h-6 items-center gap-1.5 bg-black/80 px-2 text-[12px] font-medium text-ok">
      <span className="h-1.5 w-1.5 bg-ok" />
      {t("inst.status.running")}
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
    <div
      className="absolute inset-0 grid place-items-center"
      style={{ background: `radial-gradient(70% 70% at 50% 40%, color-mix(in srgb, ${accent} 14%, #121217), #0e0e12)` }}
    >
      <PixelBlock color={accent} size={64} />
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
          "group relative flex min-w-0 flex-col border border-line bg-surface p-2 text-left transition-colors duration-100",
          "hover:border-line2 hover:bg-surface2 data-[state=open]:border-line2 data-[state=open]:bg-surface2",
        )}
      >
        <div className="relative aspect-[4/3] overflow-hidden border border-line">
          <IconArea instance={i} accent={accent} />
          <RunningBadge id={i.id} />
          <div className="absolute bottom-2 right-2 translate-y-1 opacity-0 transition-[opacity,transform] duration-150 group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:translate-y-0 group-hover:opacity-100">
            <PlayButton instance={i} size="icon" />
          </div>
          <CardProgress id={i.id} />
        </div>
        <div className="min-w-0 px-1 pb-0.5 pt-2">
          <div className="truncate text-[14px] font-semibold text-white" title={i.name}>
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
    <div className="flex flex-col border border-line bg-surface p-2">
      <div className="skeleton aspect-[4/3]" />
      <div className="flex flex-col gap-1.5 px-1 pb-0.5 pt-2.5">
        <div className="skeleton h-4 w-3/4" />
        <div className="skeleton h-3 w-1/2" />
      </div>
    </div>
  );
}

/** Kompakte Zeile (Start-Seite „Weiterspielen“). */
export const InstanceRow = memo(function InstanceRow({ instance: i, onOpen }: { instance: Instance; onOpen: (i: Instance) => void }) {
  const t = useT();
  const accent = instanceAccent(i.id, i.accent);
  const { phase } = useRunPhase(i.id);
  return (
    <ContextMenu content={<InstanceContextMenuContent instance={i} />}>
      <div
        role="button"
        tabIndex={0}
        aria-label={i.name}
        onClick={() => onOpen(i)}
        onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && onOpen(i)}
        style={accentVars(accent)}
        className="group relative flex min-w-0 items-center gap-3 border border-line bg-surface p-2 pr-2.5 transition-colors duration-100 hover:border-line2 hover:bg-surface2 data-[state=open]:border-line2 data-[state=open]:bg-surface2"
      >
        <InstanceIcon icon={i.icon} accent={accent} size={48} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold text-white">{i.name}</div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 truncate text-[12px] text-muted">
            <span className="truncate">{loaderLine(i)}</span>
            <span className="text-dim">·</span>
            <span className="truncate">
              {phase !== "idle" || i.install_state === "failed" || i.install_state === "installing" ? (
                <InstanceStatus instance={i} compact />
              ) : i.last_played ? (
                formatRelative(i.last_played)
              ) : (
                t("inst.never_played")
              )}
            </span>
            {i.play_time_secs > 0 && (
              <>
                <span className="text-dim">·</span>
                <span className="shrink-0">{formatDuration(i.play_time_secs)}</span>
              </>
            )}
          </div>
        </div>
        <PlayButton instance={i} size="icon" subtle />
        <CardProgress id={i.id} />
      </div>
    </ContextMenu>
  );
});
