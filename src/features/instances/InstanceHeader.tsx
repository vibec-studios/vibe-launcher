// Kompakte Kopfzeile der Instanzseite: kleines Icon, Name, eine knappe Metazeile, Spielen + ein Menü; darunter
// Bereichs-Tabs und Hinweis-Symbole in einer Zeile.
// Seltene Aktionen (Ordner, Duplizieren, Export, Teilen, Verknüpfung, Icon, Farbe, Gruppe, Reparieren, Löschen)
// liegen gesammelt im „Mehr“-Menü.
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { MoreHorizontal } from "lucide-react";
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

/** Knappe Metazeile in einer Zeile: „Fabric 0.16.9 · Minecraft 1.21.4 · 10 h · vor 1 Std. · Modpack 1.4.2“ (ausführlich im Tooltip). */
function MetaLine({ instance: i }: { instance: Instance }) {
  const t = useT();
  const src = i.source;
  const loader = i.loader.kind === "vanilla" ? "Vanilla" : `${loaderNames[i.loader.kind]}${i.loader.version ? ` ${i.loader.version}` : ""}`;
  const packVersion = src?.version_name ?? "";
  const pack = src
    ? !src.name || src.name === i.name
      ? t("ipage.meta.modpack", { version: packVersion }).trim()
      : t("ipage.meta.modpack_named", { name: src.name, version: packVersion }).trim()
    : null;
  const parts = [
    loader,
    `Minecraft ${i.mc_version}`,
    i.play_time_secs >= 60 ? formatDuration(i.play_time_secs) : null,
    i.last_played ? formatRelative(i.last_played) : t("inst.never_played"),
    pack,
  ].filter(Boolean);
  const full = [
    `${loader} · Minecraft ${i.mc_version}`,
    i.play_time_secs >= 60 ? t("inst.meta.played", { time: formatDuration(i.play_time_secs) }) : null,
    i.last_played ? t("inst.meta.last", { when: formatRelative(i.last_played) }) : null,
    pack,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="flex min-w-0 items-center gap-2 text-[12px] leading-tight text-muted">
      <span className="truncate" title={full}>
        {parts.join(" · ")}
      </span>
      <span className="flex shrink-0 items-center whitespace-nowrap empty:hidden">
        <StatusHint instance={i} />
      </span>
    </div>
  );
}

export function InstanceHeader({
  instance,
  accent,
  tabs,
  notices,
  badge,
}: {
  instance: Instance;
  accent: string;
  tabs: ReactNode;
  notices?: ReactNode;
  /** Kleine Statussymbole neben dem Spielen-Knopf (z. B. Vibey Client aktiv) */
  badge?: ReactNode;
}) {
  const t = useT();
  const nav = useNavigate();
  const navTab = route.useNavigate();
  return (
    <header className="shrink-0 border-b border-line">
      <div className={cn(pageX, "flex items-center gap-3 pb-1.5 pt-3")}>
        <Tooltip content={t("inst.icon.choose")}>
          <button onClick={() => setIcon(instance)} className="shrink-0" aria-label={t("inst.icon.choose")}>
            <InstanceIcon icon={instance.icon} accent={accent} size={40} />
          </button>
        </Tooltip>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h1 className="truncate text-[18px] font-bold leading-tight tracking-[-0.01em] text-text" title={instance.name}>
            {instance.name}
          </h1>
          <MetaLine instance={instance} />
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {badge}
          <PlayButton instance={instance} size="md" />
          <DropdownMenu
            trigger={
              <IconButton label={t("common.more")} tip className="h-10 w-10 data-[state=open]:bg-surface3 data-[state=open]:text-text">
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
      <div className={cn(pageX, "flex h-10 items-center gap-4")}>
        <div className="shrink-0">{tabs}</div>
        {/* Hinweise als Symbole mit Zahl (Text im Tooltip, Details per Klick) */}
        <div className="flex min-w-0 flex-1 justify-end">{notices}</div>
      </div>
    </header>
  );
}

export function HeaderSkeleton() {
  return (
    <header className="shrink-0 border-b border-line">
      <div className={cn(pageX, "flex items-center gap-3 pb-1.5 pt-3")}>
        <Skeleton className="h-10 w-10" />
        <div className="flex flex-1 flex-col gap-1.5">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-3 w-80" />
        </div>
        <Skeleton className="h-10 w-[136px]" />
        <Skeleton className="h-10 w-10" />
      </div>
      <div className={cn(pageX, "flex h-10 items-center gap-6")}>
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-3.5 w-16" />
        ))}
      </div>
    </header>
  );
}
