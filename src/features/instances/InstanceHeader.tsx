// Kopfblock der Instanzseite (Aufbau wie die Modrinth App): großes Icon, Name, Meta-Zeile mit Symbolen; rechts Spielen,
// Einstellungen (Zahnrad) und das Mehr-Menü. Darunter die Tab-Leiste und die Hinweise mit Text.
// Seltene Aktionen (Ordner, Duplizieren, Export, Teilen, Verknüpfung, Icon, Farbe, Gruppe, Reparieren, Löschen)
// liegen gesammelt im „Mehr“-Menü.
import { useNavigate } from "@tanstack/react-router";
import { Box, Clock, MoreHorizontal, Package, Settings, Timer } from "lucide-react";
import type { ReactNode } from "react";
import { DropdownMenu, IconButton, Skeleton, Tooltip, cn } from "@/components/ui";
import { InstanceIcon } from "@/components/instance/InstanceIcon";
import { StatusHint } from "@/components/instance/InstanceCard";
import { InstanceDropdownContent } from "@/components/instance/InstanceMenu";
import { PlayButton } from "@/components/instance/PlayButton";
import { setIcon } from "@/components/instance/actions";
import { useT } from "@/i18n";
import { useSimple } from "@/lib/mode";
import { AutofixButton } from "@/features/content/AutoFix";
import { formatDuration, formatRelative, loaderNames } from "@/lib/format";
import type { Instance } from "@/lib/types";

export const pageX = "px-6";

function Meta({ icon, children, title }: { icon: ReactNode; children: ReactNode; title?: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 whitespace-nowrap" title={title}>
      <span className="shrink-0 text-dim">{icon}</span>
      <span className="truncate">{children}</span>
    </span>
  );
}

/** Meta-Zeile mit Symbolen: Loader + Version · Spielzeit · zuletzt gespielt · Modpack · Status. */
function MetaLine({ instance: i }: { instance: Instance }) {
  const t = useT();
  const simple = useSimple();
  const src = i.source;
  const loader = i.loader.kind === "vanilla" ? "Vanilla" : `${loaderNames[i.loader.kind]}${i.loader.version ? ` ${i.loader.version}` : ""}`;
  const packVersion = src?.version_name ?? "";
  const pack = src
    ? !src.name || src.name === i.name
      ? t("ipage.meta.modpack", { version: packVersion }).trim()
      : t("ipage.meta.modpack_named", { name: src.name, version: packVersion }).trim()
    : null;
  return (
    <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-muted">
      {/* Simple: nur die Minecraft-Version, kein Mod-Unterbau/keine Loader-Version */}
      <Meta icon={<Box size={15} />}>{simple ? `Minecraft ${i.mc_version}` : `${loader} · Minecraft ${i.mc_version}`}</Meta>
      {i.play_time_secs >= 60 && <Meta icon={<Timer size={15} />}>{t("inst.meta.played", { time: formatDuration(i.play_time_secs) })}</Meta>}
      <Meta icon={<Clock size={15} />}>
        {!i.last_played
          ? t("inst.never_played")
          : Date.now() - i.last_played < 60_000
            ? t("ipage.meta.last_now")
            : t("inst.meta.last", { when: formatRelative(i.last_played) })}
      </Meta>
      {pack && !simple && (
        <Meta icon={<Package size={15} />} title={src?.name ?? undefined}>
          {pack}
        </Meta>
      )}
      <span className="flex items-center whitespace-nowrap empty:hidden">
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
  settingsActive,
  onSettings,
}: {
  instance: Instance;
  accent: string;
  tabs: ReactNode;
  notices?: ReactNode;
  /** Kleine Statussymbole neben dem Namen (z. B. Vibey Client aktiv) */
  badge?: ReactNode;
  settingsActive?: boolean;
  onSettings: () => void;
}) {
  const t = useT();
  const nav = useNavigate();
  const simple = useSimple();
  return (
    <header className="shrink-0">
      {/* Kopfblock: großes Icon, Name, Meta-Zeile; rechts Spielen, Einstellungen, Mehr */}
      <div className={cn(pageX, "flex items-center gap-5 pb-4 pt-6")}>
        <Tooltip content={t("inst.icon.choose")}>
          <button onClick={() => setIcon(instance)} className="shrink-0" aria-label={t("inst.icon.choose")}>
            <InstanceIcon icon={instance.icon} accent={accent} size={72} />
          </button>
        </Tooltip>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-[26px] font-bold leading-tight tracking-[-0.015em] text-text" title={instance.name}>
              {instance.name}
            </h1>
            {badge}
          </div>
          <MetaLine instance={instance} />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <PlayButton instance={instance} size="lg" />
          {/* Simple: „Probleme beheben“ direkt im Kopf statt Logs/Dateien */}
          {simple && <AutofixButton req={{ instanceId: instance.id }} variant="ghost" size="md" className="h-11" />}
          <IconButton label={t("ipage.settings")} tip active={settingsActive} className={cn("h-11 w-11", settingsActive && "text-accent")} onClick={onSettings}>
            <Settings size={19} />
          </IconButton>
          {!simple && (
            <DropdownMenu
              trigger={
                <IconButton label={t("common.more")} tip className="h-11 w-11 data-[state=open]:bg-surface3 data-[state=open]:text-text">
                  <MoreHorizontal size={19} />
                </IconButton>
              }
            >
              <InstanceDropdownContent instance={instance} onDeleted={() => nav({ to: "/instances" })} onEdit={onSettings} />
            </DropdownMenu>
          )}
        </div>
      </div>
      {/* Tab-Leiste mit klarer Trennung zum Inhalt; darunter Hinweise mit Text */}
      <div className={cn(pageX, "border-b border-line")}>{tabs}</div>
      {notices}
    </header>
  );
}

export function HeaderSkeleton() {
  return (
    <header className="shrink-0">
      <div className={cn(pageX, "flex items-center gap-5 pb-4 pt-6")}>
        <Skeleton className="h-[72px] w-[72px]" />
        <div className="flex flex-1 flex-col gap-2.5">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-96" />
        </div>
        <Skeleton className="h-11 w-[168px]" />
        <Skeleton className="h-11 w-11" />
        <Skeleton className="h-11 w-11" />
      </div>
      <div className={cn(pageX, "flex h-11 items-center gap-6 border-b border-line")}>
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-3.5 w-16" />
        ))}
      </div>
    </header>
  );
}
