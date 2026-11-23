import { useNavigate } from "@tanstack/react-router";
import { BEDROCK_TEXT_COLOR } from "@/features/bedrock/parts";
import { Plus, Settings as SettingsIcon } from "lucide-react";
import { memo, type ReactNode } from "react";
import { ContextMenu, Tooltip, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { instanceAccent } from "@/lib/format";
import type { Instance } from "@/lib/types";
import { InstanceIcon } from "@/components/instance/InstanceIcon";
import { Logo3D } from "@/components/Logo3D";
import { InstanceContextMenuContent } from "@/components/instance/InstanceMenu";
import { openNewInstance } from "@/components/instance/actions";
import { openSettings } from "@/features/settings/store";
import { NAV, useInstanceActivity, useRailModel } from "./nav";
import { ThemeSlot } from "@/features/themes/ThemeSlot";

// ------------------------------------------------------------------ Seitenleiste
// Kompakt (nur Icons, Standard) oder breit mit Beschriftung; Reihenfolge/Sichtbarkeit der Einträge und die
// Instanz-Liste kommen aus der Darstellung (Einstellungen → Darstellung → Seitenleiste).

function RailButton({
  label,
  active,
  wide,
  onClick,
  children,
  tour,
}: {
  label: string;
  active?: boolean;
  wide: boolean;
  onClick: () => void;
  children: ReactNode;
  /** Ziel für die Einführungs-Bubbles (SimpleTour) */
  tour?: string;
}) {
  return (
    <Tooltip content={wide ? null : label} side="right">
      <button
        data-part="nav-item"
        data-tour={tour}
        aria-label={label}
        aria-current={active ? "page" : undefined}
        onClick={onClick}
        className={cn(
          "relative flex h-10 shrink-0 items-center rounded-ctl transition-colors duration-100",
          wide ? "w-full gap-3 px-3 text-[13.5px] font-medium" : "w-10 justify-center",
          active ? "bg-white/[.08] text-brand" : "text-muted hover:bg-white/[.05] hover:text-text",
        )}
      >
        {children}
        {wide && <span className={cn("truncate", active && "text-text")}>{label}</span>}
      </button>
    </Tooltip>
  );
}

const RailInstance = memo(function RailInstance({ instance: i, active, wide }: { instance: Instance; active: boolean; wide: boolean }) {
  const nav = useNavigate();
  const { running, busy } = useInstanceActivity(i.id);
  return (
    <ContextMenu content={<InstanceContextMenuContent instance={i} />}>
      <div className={wide ? "w-full" : undefined}>
        <Tooltip content={wide ? null : i.bedrock ? `${i.name} · Bedrock` : i.name} side="right">
          <button
            aria-label={i.name}
            onClick={() => nav({ to: "/instances/$id", params: { id: i.id }, search: { tab: "content" } })}
            className={cn(
              "relative flex shrink-0 items-center transition-[opacity,background-color] duration-100",
              wide ? "h-9 w-full gap-2.5 rounded-ctl px-2 text-left hover:bg-white/[.05]" : "h-10 w-10 justify-center",
              active ? "opacity-100" : "opacity-75 hover:opacity-100",
              wide && active && "bg-white/[.06]",
            )}
          >
            <span className="relative">
              <InstanceIcon
                icon={i.icon}
                seed={i.id}
                accent={instanceAccent(i.id, i.accent)}
                size={wide ? 26 : 34}
                className={cn(active && !wide && "outline outline-1 outline-offset-2 outline-white/40")}
              />
              {(running || busy) && (
                <span className={cn("absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-dot border-2 border-[var(--tone-frame)]", running ? "bg-ok" : "bg-warn")} />
              )}
            </span>
            {wide && <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text">{i.name}</span>}
            {wide && i.bedrock && (
              <span className="shrink-0 text-[10.5px] font-bold tracking-wide" style={{ color: BEDROCK_TEXT_COLOR }} title="Minecraft Bedrock">
                BE
              </span>
            )}
          </button>
        </Tooltip>
      </div>
    </ContextMenu>
  );
});

/** Logo oben: 3D-Robbe – im Winter-Theme mit Schal (Maskottchen, Logo3D folgt dem Theme selbst). */
function RailLogo({ wide }: { wide: boolean }) {
  const nav = useNavigate();
  return (
    <Tooltip content={wide ? null : "Vibe Launcher"} side="right">
      <button
        aria-label="Vibe Launcher"
        onClick={() => nav({ to: "/" })}
        className={cn("mb-1 flex h-10 shrink-0 items-center", wide ? "w-full gap-2.5 px-1.5" : "w-10 justify-center")}
      >
        <Logo3D size={34} speed={0} hoverSpin float={false} interactive={false} />
        {wide && <span className="truncate text-[14px] font-bold tracking-[-0.01em] text-text">Vibe Launcher</span>}
      </button>
    </Tooltip>
  );
}

export function Rail() {
  const t = useT();
  const { nav, path, at, wide, keys, recent, serversRunning, socialBadge, settingsOpen } = useRailModel();
  const sep = <div className={cn("my-1.5 h-px shrink-0 bg-line2", wide ? "mx-1.5" : "w-6")} />;
  return (
    <nav data-part="sidebar" className={cn("vl-rail flex w-[var(--rail-w)] shrink-0 flex-col gap-1 bg-bg py-2", wide ? "items-stretch px-2.5" : "items-center")}>
      <RailLogo wide={wide} />
      <ThemeSlot name="sidebar-top" />
      {keys.map((k) => {
        const n = NAV[k];
        return (
          <RailButton key={k} wide={wide} label={t(n.label)} active={n.match(path, at)} onClick={() => n.go(nav)} tour={k}>
            {n.icon}
            {k === "servers" && serversRunning && (
              <span className={cn("absolute h-2 w-2 rounded-dot bg-ok shadow-[0_0_0_2px_var(--tone-frame)]", wide ? "right-3 top-1/2 -translate-y-1/2" : "bottom-2 right-2")} />
            )}
            {k === "social" && socialBadge > 0 && (
              <span
                className={cn(
                  "absolute grid h-4 min-w-4 place-items-center rounded-pill bg-brand px-1 text-[9.5px] font-bold leading-none text-[var(--ui-on-accent)] shadow-[0_0_0_2px_var(--tone-frame)]",
                  wide ? "right-2.5 top-1/2 -translate-y-1/2" : "-right-0.5 -top-0.5",
                )}
              >
                {socialBadge > 9 ? "9+" : socialBadge}
              </span>
            )}
          </RailButton>
        );
      })}
      {sep}
      <div
        className={cn(
          "scroll flex min-h-0 w-full flex-1 flex-col py-0.5 [scrollbar-gutter:auto] [&::-webkit-scrollbar]:w-0",
          wide ? "items-stretch gap-0.5" : "items-center gap-1.5",
        )}
      >
        {wide && recent.length > 0 && <div className="px-2 pb-1 pt-0.5 text-[11.5px] font-semibold text-dim">{t("nav.recent")}</div>}
        {recent.map((i) => (
          <RailInstance key={i.id} instance={i} wide={wide} active={path === `/instances/${i.id}`} />
        ))}
        <Tooltip content={wide ? null : t("rail.new_instance")} side="right">
          <button
            aria-label={t("rail.new_instance")}
            data-tour="new-instance"
            onClick={openNewInstance}
            className={cn(
              "flex shrink-0 items-center rounded-ctl text-dim transition-colors duration-100 hover:bg-white/[.05] hover:text-text",
              wide ? "h-9 w-full gap-2.5 px-2 text-[13px] font-medium" : "h-10 w-10 justify-center",
            )}
          >
            <span className={cn("grid place-items-center", wide && "h-[26px] w-[26px]")}>
              <Plus size={18} />
            </span>
            {wide && <span className="truncate">{t("rail.new_instance")}</span>}
          </button>
        </Tooltip>
      </div>
      {sep}
      <RailButton wide={wide} label={t("nav.settings")} active={settingsOpen} onClick={() => openSettings()}>
        <SettingsIcon size={20} />
      </RailButton>
    </nav>
  );
}
