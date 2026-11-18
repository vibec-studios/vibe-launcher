// Kopfzeile der Instanzseite: Icon, Name, Metazeile (Loader, Version, Spielzeit, Modpack), Spielen + ein Menü.
// Seltene Aktionen (Ordner, Duplizieren, Export, Teilen, Verknüpfung, Icon, Farbe, Gruppe, Reparieren, Löschen)
// liegen gesammelt im „Mehr“-Menü.
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { Box, Clock, MoreHorizontal, Package } from "lucide-react";
import type { ReactNode } from "react";
import { DropdownMenu, IconButton, Skeleton, Tooltip, cn } from "@/components/ui";
import { InstanceIcon } from "@/components/instance/InstanceIcon";
import { StatusHint } from "@/components/instance/InstanceCard";
import { InstanceDropdownContent } from "@/components/instance/InstanceMenu";
import { PlayButton } from "@/components/instance/PlayButton";
import { setIcon } from "@/components/instance/actions";
import { useT } from "@/i18n";
import { formatDuration, formatRelative, loaderNames } from "@/lib/format";
import type { Instance } from "@/lib/types";

export const pageX = "px-6";
const route = getRouteApi("/instances/$id");

function Meta({ icon, children, title }: { icon: ReactNode; children: ReactNode; title?: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 whitespace-nowrap" title={title}>
      <span className="shrink-0 text-dim [&_svg]:size-[13px]">{icon}</span>
      <span className="truncate">{children}</span>
    </span>
  );
}

/** Metazeile: „Fabric 0.16.9 · Minecraft 1.21.4 · 10 h gespielt, zuletzt vor 1 Std. · Modpack 1.4.2“ */
function MetaLine({ instance: i }: { instance: Instance }) {
  const t = useT();
  const src = i.source;
  const loader = i.loader.kind === "vanilla" ? "Vanilla" : `${loaderNames[i.loader.kind]}${i.loader.version ? ` ${i.loader.version}` : ""}`;
  const played = [i.play_time_secs >= 60 ? t("inst.meta.played", { time: formatDuration(i.play_time_secs) }) : null, i.last_played ? t("inst.meta.last", { when: formatRelative(i.last_played) }) : t("inst.never_played")]
    .filter(Boolean)
    .join(" · ");
  const packVersion = src?.version_name ?? "";
  const pack = src
    ? !src.name || src.name === i.name
      ? t("ipage.meta.modpack", { version: packVersion }).trim()
      : t("ipage.meta.modpack_named", { name: src.name, version: packVersion }).trim()
    : null;
  return (
    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-0.5 text-meta text-muted">
      <Meta icon={<Box size={14} />}>
        {loader} · Minecraft {i.mc_version}
      </Meta>
      <Meta icon={<Clock size={14} />}>{played}</Meta>
      {pack && (
        <Meta icon={<Package size={14} />} title={src?.name ?? undefined}>
          {pack}
        </Meta>
      )}
      <span className="flex items-center whitespace-nowrap empty:hidden">
        <StatusHint instance={i} />
      </span>
    </div>
  );
}

export function InstanceHeader({ instance, accent, tabs, notices }: { instance: Instance; accent: string; tabs: ReactNode; notices?: ReactNode }) {
  const t = useT();
  const nav = useNavigate();
  const navTab = route.useNavigate();
  return (
    <header className="relative shrink-0 border-b border-line">
      <div className={cn(pageX, "relative flex items-center gap-4 pb-3 pt-4")}>
        <Tooltip content={t("inst.icon.choose")}>
          <button onClick={() => setIcon(instance)} className="shrink-0" aria-label={t("inst.icon.choose")}>
            <InstanceIcon icon={instance.icon} accent={accent} size={56} />
          </button>
        </Tooltip>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-hero text-text" title={instance.name}>
            {instance.name}
          </h1>
          <MetaLine instance={instance} />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <PlayButton instance={instance} size="lg" />
          <DropdownMenu
            trigger={
              <IconButton label={t("common.more")} className="h-11 w-11 data-[state=open]:bg-surface3 data-[state=open]:text-text">
                <MoreHorizontal size={18} />
              </IconButton>
            }
          >
            <InstanceDropdownContent
              instance={instance}
              onDeleted={() => nav({ to: "/instances" })}
              onEdit={() => navTab({ search: { tab: "settings" }, replace: true })}
            />
          </DropdownMenu>
        </div>
      </div>
      <div className={cn(pageX, "relative flex items-center gap-6")}>
        <div className="shrink-0">{tabs}</div>
        {/* Hinweiszeile: ruhige Chips rechts neben den Bereichen, auf allen Unterseiten sichtbar */}
        <div className="@container flex min-w-0 flex-1 justify-end">{notices}</div>
      </div>
    </header>
  );
}

export function HeaderSkeleton() {
  return (
    <header className="shrink-0 border-b border-line">
      <div className={cn(pageX, "flex items-center gap-4 pb-3 pt-4")}>
        <Skeleton className="h-[56px] w-[56px]" />
        <div className="flex flex-1 flex-col gap-2.5">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-4 w-96" />
        </div>
        <Skeleton className="h-11 w-[168px]" />
        <Skeleton className="h-11 w-11" />
      </div>
      <div className={cn(pageX, "flex h-10 items-center gap-6")}>
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-3.5 w-20" />
        ))}
      </div>
    </header>
  );
}
