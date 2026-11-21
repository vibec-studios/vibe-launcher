// Instanz-Kacheln: Raster-Kachel (Bibliothek, rahmenlos – das Bild trägt) und Listenzeile.
// Klick öffnet, Rechtsklick = Aktionsmenü, Spielen-Knopf erscheint beim Hover über dem Bild.
import { memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpCircle, Download } from "lucide-react";
import { api } from "@/lib/api";
import type { Instance } from "@/lib/types";
import { AnimatedNumber, ContextMenu, Progress, cn } from "@/components/ui";
import { useSimple } from "@/lib/mode";
import { formatDuration, formatRelative, instanceAccent, loaderNames } from "@/lib/format";
import { BedrockTag } from "@/features/bedrock/parts";
import { useT } from "@/i18n";
import { InstanceIcon, PixelBlock, useInstanceArt } from "./InstanceIcon";
import { BlockArt } from "./blocks/BlockArt";
import { backgroundCss } from "./blocks/catalog";
import { InstanceContextMenuContent } from "./InstanceMenu";
import { PlayButton } from "./PlayButton";
import { useRunPhase } from "./status";
import { accentVars } from "./accent";

/** "Fabric 1.21.4" bzw. "Vanilla 1.21.4" */
export function loaderLine(i: Instance): string {
  if (i.bedrock) return i.bedrock.channel === "preview" ? "Bedrock Preview" : "Bedrock";
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
    <span className="vl-badge absolute left-2 top-2 inline-flex h-6 items-center gap-1.5 rounded-pill bg-black/70 px-2 text-[12px] font-medium text-ok">
      <span className="h-1.5 w-1.5 rounded-dot bg-ok" />
      {t("inst.status.running")}
    </span>
  );
}

/** „Nicht installiert“ als ruhiges Abzeichen auf der Kachel (wird beim ersten Spielen nachgeholt). */
function NotInstalledBadge({ instance: i }: { instance: Instance }) {
  const t = useT();
  const { phase } = useRunPhase(i.id);
  if (phase !== "idle" || i.install_state !== "not_installed") return null;
  return (
    <span className="vl-badge absolute left-2 top-2 inline-flex h-6 items-center gap-1 rounded-pill bg-black/70 px-2 text-[12px] font-medium text-muted">
      <Download size={12} />
      {t("inst.status.not_installed")}
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
    <span className="vl-badge absolute right-2 top-2 inline-flex h-6 items-center gap-1 rounded-pill bg-black/70 px-2 text-[12px] font-medium text-accent">
      <ArrowUpCircle size={12} />
      {n === 1 ? t("instances.updates_badge_1") : t("instances.updates_badge", { n })}
    </span>
  );
}

function IconArea({ instance: i, accent }: { instance: Instance; accent: string }) {
  const { img, art, onError } = useInstanceArt(i.icon, i.id);
  if (img)
    return (
      <img
        src={img}
        alt=""
        draggable={false}
        loading="lazy"
        decoding="async"
        onError={onError}
        className="absolute inset-0 h-full w-full object-cover [image-rendering:pixelated]"
      />
    );
  return (
    <div className="vl-inst-art absolute inset-0 grid place-items-center bg-surface2" style={{ background: art ? backgroundCss(art.bg, accent) : undefined }}>
      {art ? <BlockArt design={art.design} accent={accent} size={88} cover /> : <PixelBlock color={accent} size={60} />}
    </div>
  );
}

/** Raster-Karte der Bibliothek. */
export const InstanceCard = memo(function InstanceCard({ instance: i, onOpen }: { instance: Instance; onOpen: (i: Instance) => void }) {
  const accent = instanceAccent(i.id, i.accent);
  // Simple-Modus: kein Kontextmenü (Ordner, Export …), statt Loader nur die Minecraft-Version
  const simple = useSimple();
  return (
    <ContextMenu disabled={simple} content={<InstanceContextMenuContent instance={i} />}>
      <div
        role="button"
        tabIndex={0}
        aria-label={i.name}
        onClick={() => onOpen(i)}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
          e.preventDefault();
          if (!e.repeat) onOpen(i);
        }}
        style={accentVars(accent)}
        className={cn(
          "vl-card vl-inst-card group relative flex min-w-0 flex-col rounded-panel p-1.5 text-left transition-colors duration-100",
          "hover:bg-white/[.04] data-[state=open]:bg-white/[.04]",
        )}
      >
        <div className="vl-zoom relative aspect-[4/3] overflow-hidden rounded-card bg-surface2">
          <IconArea instance={i} accent={accent} />
          <RunningBadge id={i.id} />
          <NotInstalledBadge instance={i} />
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
            {/* Version bleibt ganz lesbar, ein Status dahinter kürzt sich zuerst */}
            {i.bedrock ? <BedrockTag instance={i} /> : <span className="shrink-0">{simple ? `Minecraft ${i.mc_version}` : loaderLine(i)}</span>}
            <StatusDot instance={i} />
          </div>
        </div>
      </div>
    </ContextMenu>
  );
});

/** Kleiner Hinweis hinter der Versionszeile (nur wenn nicht „installiert & bereit“). */
function StatusDot({ instance: i, notInstalled }: { instance: Instance; notInstalled?: boolean }) {
  const { phase } = useRunPhase(i.id);
  const t = useT();
  if (phase === "running" || (phase === "idle" && i.install_state === "installed")) return null;
  // „Nicht installiert“ ist kein Fehler (wird beim ersten Spielen nachgeholt) – ruhig statt orange.
  // Kachel: als Abzeichen auf dem Bild (hier kein Platz), Liste: als Text hinter dem Namen.
  if (phase === "idle" && i.install_state === "not_installed" && !notInstalled) return null;
  if (phase === "idle" && i.install_state === "not_installed")
    return (
      <>
        <span className="text-dim">·</span>
        <span className="min-w-0 truncate text-dim">{t("inst.status.not_installed")}</span>
      </>
    );
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

/** Spalten der Listenansicht (Zeilen und Kopfzeile teilen sich das Raster; Container-Query auf dem Listen-Wrapper). */
export const listCols =
  "grid min-w-0 grid-cols-[32px_minmax(0,1fr)_36px] items-center gap-3 px-2 @min-[640px]:grid-cols-[32px_minmax(0,1fr)_150px_36px] @min-[860px]:grid-cols-[32px_minmax(0,1fr)_150px_130px_90px_36px]";

/** Spaltenköpfe der Listenansicht, damit die Zahlen rechts nicht ohne Bedeutung dastehen. */
export function InstanceListHeader() {
  const t = useT();
  const simple = useSimple();
  return (
    <div className={cn(listCols, "h-8 text-[12px] font-medium text-dim")} aria-hidden>
      <span />
      <span>{t("instances.col.name")}</span>
      <span className="hidden @min-[640px]:block">{simple ? t("instances.col.version_simple") : t("instances.col.version")}</span>
      <span className="hidden @min-[860px]:block">{t("inst.last_played")}</span>
      <span className="hidden text-right @min-[860px]:block">{t("inst.play_time")}</span>
      <span />
    </div>
  );
}

/** Kompakte Zeile der Bibliothek (Listenansicht): Icon, Name, Loader/Version, zuletzt gespielt, Spielzeit, Spielen. */
export const InstanceListRow = memo(function InstanceListRow({ instance: i, onOpen }: { instance: Instance; onOpen: (i: Instance) => void }) {
  const t = useT();
  const accent = instanceAccent(i.id, i.accent);
  // Simple-Modus: kein Kontextmenü (Ordner, Export …), statt Loader nur die Minecraft-Version
  const simple = useSimple();
  return (
    <ContextMenu disabled={simple} content={<InstanceContextMenuContent instance={i} />}>
      <div
        role="button"
        tabIndex={0}
        aria-label={i.name}
        onClick={() => onOpen(i)}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
          e.preventDefault();
          if (!e.repeat) onOpen(i);
        }}
        style={accentVars(accent)}
        className={cn("group relative h-12 overflow-hidden rounded-ctl transition-colors duration-100 hover:bg-white/[.04] data-[state=open]:bg-white/[.04]", listCols)}
      >
        <InstanceIcon icon={i.icon} seed={i.id} accent={accent} size={32} />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[13.5px] font-semibold text-text">{i.name}</span>
            <BedrockTag instance={i} />
            <span className="flex min-w-0 items-center gap-1.5 truncate text-[12px] font-normal empty:hidden">
              <StatusDot instance={i} notInstalled />
            </span>
          </div>
          {/* Zweite Zeile nur, wenn sie etwas sagt: Modpack-Name (wenn anders als der Instanzname) bzw. „Modpack“ */}
          {i.source && (
            <div className="truncate text-[12px] leading-tight text-dim">
              {i.source.name && i.source.name !== i.name ? i.source.name : t("inst.modpack")}
              {i.source.version_name ? ` ${i.source.version_name}` : ""}
            </div>
          )}
        </div>
        <span className="hidden truncate text-[12.5px] text-muted @min-[640px]:block">{simple && !i.bedrock ? `Minecraft ${i.mc_version}` : loaderLine(i)}</span>
        <span className="hidden truncate text-[12.5px] text-muted @min-[860px]:block">{i.last_played ? formatRelative(i.last_played) : t("inst.never_played")}</span>
        <span className="hidden truncate text-right text-[12.5px] tabular-nums text-muted @min-[860px]:block">{i.play_time_secs >= 60 ? formatDuration(i.play_time_secs) : <span className="text-dim">–</span>}</span>
        <span className="flex justify-end opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
          <PlayButton instance={i} size="icon" subtle />
        </span>
        <CardProgress id={i.id} />
      </div>
    </ContextMenu>
  );
});
