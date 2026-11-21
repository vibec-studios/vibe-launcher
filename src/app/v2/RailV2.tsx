import { memo, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Plus, Settings as SettingsIcon } from "lucide-react";
import { ContextMenu, Tooltip, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { instanceAccent } from "@/lib/format";
import type { Instance } from "@/lib/types";
import { InstanceIcon } from "@/components/instance/InstanceIcon";
import { InstanceContextMenuContent } from "@/components/instance/InstanceMenu";
import { openNewInstance } from "@/components/instance/actions";
import { Logo3D } from "@/components/Logo3D";
import { BEDROCK_COLOR } from "@/features/bedrock/parts";
import { openSettings } from "@/features/settings/store";
import { useSimple } from "@/lib/mode";
import { NAV, useInstanceActivity, useRailModel } from "../nav";

function Item({
  label,
  active,
  wide,
  onClick,
  icon,
  badge,
  tour,
}: {
  label: string;
  active?: boolean;
  wide: boolean;
  onClick: () => void;
  icon: ReactNode;
  badge?: ReactNode;
  tour?: string;
}) {
  return (
    <Tooltip content={wide ? null : label} side="right">
      <button
        data-tour={tour}
        aria-label={label}
        aria-current={active ? "page" : undefined}
        onClick={onClick}
        className={cn(
          "vl2-item group relative flex shrink-0 items-center rounded-ctl transition-[background-color,color,box-shadow] duration-150",
          wide ? "h-9 w-full gap-3 px-2.5 text-[13.5px] font-medium" : "h-10 w-11 justify-center",
          active
            ? "bg-surface2 text-text shadow-[inset_0_0_0_1px_var(--line-1)]"
            : "text-muted hover:bg-[var(--v2-hover)] hover:text-text",
        )}
      >
        {active && <span aria-hidden className={cn("absolute top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-pill bg-brand", wide ? "-left-3" : "-left-[14px]")} />}
        <span className={cn("grid shrink-0 place-items-center [&>svg]:h-[19px] [&>svg]:w-[19px]", active && "text-brand")}>{icon}</span>
        {wide && <span className="min-w-0 flex-1 truncate text-left">{label}</span>}
        {badge}
      </button>
    </Tooltip>
  );
}

const RailInstance = memo(function RailInstance({ instance: i, active, wide }: { instance: Instance; active: boolean; wide: boolean }) {
  const nav = useNavigate();
  const { running, busy } = useInstanceActivity(i.id);
  const simple = useSimple();
  return (
    <ContextMenu disabled={simple} content={<InstanceContextMenuContent instance={i} />}>
      <div className={wide ? "w-full" : undefined}>
        <Tooltip content={wide ? null : i.bedrock ? `${i.name} · Bedrock` : i.name} side="right">
          <button
            aria-label={i.name}
            aria-current={active ? "page" : undefined}
            onClick={() => nav({ to: "/instances/$id", params: { id: i.id }, search: { tab: "content" } })}
            className={cn(
              "relative flex shrink-0 items-center rounded-ctl transition-[background-color,box-shadow] duration-150",
              wide ? "h-9 w-full gap-2.5 px-1.5 text-left" : "h-11 w-11 justify-center",
              active ? "bg-surface2 shadow-[inset_0_0_0_1px_var(--line-1)]" : "hover:bg-[var(--v2-hover)]",
            )}
          >
            <span className="relative">
              <InstanceIcon icon={i.icon} accent={instanceAccent(i.id, i.accent)} size={wide ? 26 : 32} className="rounded-[var(--r-xs)]" />
              {(running || busy) && (
                <span className={cn("absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-dot shadow-[0_0_0_2px_var(--tone-frame)]", running ? "bg-ok" : "bg-warn")} />
              )}
            </span>
            {wide && <span className={cn("min-w-0 flex-1 truncate text-[13px] font-medium", active ? "text-text" : "text-muted")}>{i.name}</span>}
            {wide && i.bedrock && (
              <span className="shrink-0 text-[10.5px] font-bold tracking-wide" style={{ color: BEDROCK_COLOR }} title="Minecraft Bedrock">
                BE
              </span>
            )}
          </button>
        </Tooltip>
      </div>
    </ContextMenu>
  );
});

export function RailV2() {
  const t = useT();
  const { nav, path, at, wide, keys, recent, serversRunning, socialBadge, settingsOpen } = useRailModel();
  return (
    <nav className={cn("vl2-rail flex w-[var(--rail-w)] shrink-0 flex-col bg-bg pb-[var(--gutter)] pt-2", wide ? "items-stretch px-3" : "items-center px-2")}>
      <Tooltip content={wide ? null : "Vibe Launcher"} side="right">
        <button
          aria-label="Vibe Launcher"
          onClick={() => nav({ to: "/" })}
          className={cn("mb-3 flex h-11 shrink-0 items-center rounded-ctl", wide ? "w-full gap-2.5 px-1" : "w-11 justify-center")}
        >
          <Logo3D size={34} speed={0} hoverSpin float={false} interactive={false} />
          {wide && (
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-[15px] font-bold tracking-[-0.02em] text-text">Vibe</span>
              <span className="block truncate text-[11px] font-medium text-dim">Launcher</span>
            </span>
          )}
        </button>
      </Tooltip>
      <div className={cn("flex flex-col gap-1", wide ? "items-stretch" : "items-center")}>
        {keys.map((k) => {
          const n = NAV[k];
          const badge =
            k === "servers" && serversRunning ? (
              <span className={cn("h-2 w-2 rounded-dot bg-ok", !wide && "absolute bottom-2 right-2 shadow-[0_0_0_2px_var(--tone-frame)]")} />
            ) : k === "social" && socialBadge > 0 ? (
              <span
                className={cn(
                  "grid h-[18px] min-w-[18px] place-items-center rounded-pill bg-brand px-1 text-[10px] font-bold leading-none text-[var(--ui-on-accent)]",
                  !wide && "absolute -right-0.5 -top-0.5 shadow-[0_0_0_2px_var(--tone-frame)]",
                )}
              >
                {socialBadge > 9 ? "9+" : socialBadge}
              </span>
            ) : null;
          return <Item key={k} wide={wide} label={t(n.label)} icon={n.icon} active={n.match(path, at)} onClick={() => n.go(nav)} tour={k} badge={badge} />;
        })}
      </div>
      <div className={cn("my-3 h-px shrink-0 bg-line", wide ? "mx-1" : "w-8")} />
      {wide && recent.length > 0 && <div className="px-2.5 pb-1.5 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-dim">{t("nav.recent")}</div>}
      <div
        className={cn(
          "scroll flex min-h-0 w-full flex-1 flex-col py-0.5 [scrollbar-gutter:auto] [&::-webkit-scrollbar]:w-0",
          wide ? "items-stretch gap-0.5" : "items-center gap-1",
        )}
      >
        {recent.map((i) => (
          <RailInstance key={i.id} instance={i} wide={wide} active={path === `/instances/${i.id}`} />
        ))}
        <Tooltip content={wide ? null : t("rail.new_instance")} side="right">
          <button
            aria-label={t("rail.new_instance")}
            onClick={openNewInstance}
            className={cn(
              "flex shrink-0 items-center rounded-ctl text-dim transition-colors duration-150 hover:bg-[var(--v2-hover)] hover:text-text",
              wide ? "h-9 w-full gap-2.5 px-1.5 text-[13px] font-medium" : "h-11 w-11 justify-center",
            )}
          >
            <span className={cn("grid place-items-center rounded-[var(--r-xs)] border border-dashed border-line2", wide ? "h-[26px] w-[26px]" : "h-8 w-8")}>
              <Plus size={16} />
            </span>
            {wide && <span className="truncate">{t("rail.new_instance")}</span>}
          </button>
        </Tooltip>
      </div>
      <div className={cn("mt-2 flex flex-col", wide ? "items-stretch" : "items-center")}>
        <Item wide={wide} label={t("nav.settings")} icon={<SettingsIcon size={20} />} active={settingsOpen} onClick={() => openSettings()} />
      </div>
    </nav>
  );
}
