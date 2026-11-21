import type { ReactNode } from "react";
import { ChevronDown, ChevronUp, Compass, Eye, EyeOff, Home, Images, LibraryBig, RotateCcw, Server as ServerIcon, Shirt, Users } from "lucide-react";
import { DEFAULT_APPEARANCE } from "@/lib/appearance";
import type { Appearance, NavKey } from "@/lib/types";
import { Button, IconButton, Segmented, SettingRow, SettingsCard, Switch, cn } from "@/components/ui";
import { useT } from "@/i18n";
import type { CardProps } from "./types";

const NAV_ICONS: Record<NavKey, ReactNode> = {
  home: <Home size={15} />,
  instances: <LibraryBig size={15} />,
  servers: <ServerIcon size={15} />,
  social: <Users size={15} />,
  discover: <Compass size={15} />,
  skins: <Shirt size={15} />,
  screenshots: <Images size={15} />,
};

export function SidebarCard({ a, set }: CardProps) {
  const t = useT();
  const setSidebar = (p: Partial<Appearance["sidebar"]>) => set({ sidebar: { ...a.sidebar, ...p } });
  const moveNav = (k: NavKey, dir: -1 | 1) => {
    const order = [...a.sidebar.order];
    const i = order.indexOf(k);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    setSidebar({ order });
  };
  const toggleNav = (k: NavKey) => {
    const hidden = a.sidebar.hidden.includes(k) ? a.sidebar.hidden.filter((x) => x !== k) : [...a.sidebar.hidden, k];
    setSidebar({ hidden });
  };
  return (
    <SettingsCard
      title={t("ap.section.sidebar")}
      right={
        <Button
          size="sm"
          variant="subtle"
          icon={<RotateCcw size={13} />}
          disabled={JSON.stringify(a.sidebar) === JSON.stringify(DEFAULT_APPEARANCE.sidebar)}
          onClick={() => set({ sidebar: DEFAULT_APPEARANCE.sidebar })}
        >
          {t("ap.reset")}
        </Button>
      }
    >
      <SettingRow title={t("ap.sidebar.mode")} description={t("ap.sidebar.mode.desc")}>
        <Segmented
          value={a.sidebar.mode}
          onChange={(mode) => setSidebar({ mode })}
          items={(["compact", "wide"] as const).map((v) => ({ value: v, label: t(`ap.sidebar.${v}`) }))}
        />
      </SettingRow>
      <SettingRow title={t("ap.sidebar.style")} description={t("ap.sidebar.style.desc")}>
        <Segmented
          value={a.sidebar.style}
          onChange={(style) => setSidebar({ style })}
          items={(["solid", "floating", "tinted"] as const).map((v) => ({ value: v, label: t(`ap.sidebar.style.${v}`) }))}
        />
      </SettingRow>
      <SettingRow title={t("ap.sidebar.instances")} description={t("ap.sidebar.instances.desc")}>
        <Switch checked={a.sidebar.instances} onChange={(instances) => setSidebar({ instances })} label={t("ap.sidebar.instances")} />
      </SettingRow>
      <SettingRow title={t("ap.sidebar.order")} description={t("ap.sidebar.order.desc")} stacked>
        <div className="flex flex-col gap-px overflow-hidden rounded-ctl" role="list">
          {a.sidebar.order.map((k, i) => {
            const hidden = a.sidebar.hidden.includes(k);
            return (
              <div key={k} role="listitem" className="flex h-10 items-center gap-3 bg-white/[.03] px-3">
                <span className={cn("text-muted", hidden && "opacity-40")}>{NAV_ICONS[k]}</span>
                <span className={cn("flex-1 text-[13px] font-medium", hidden ? "text-dim line-through decoration-white/20" : "text-text")}>{t(`nav.${k}`)}</span>
                <IconButton label={t("ap.sidebar.up")} size="sm" variant="ghost" className="h-7 w-7" disabled={i === 0} onClick={() => moveNav(k, -1)}>
                  <ChevronUp size={15} />
                </IconButton>
                <IconButton
                  label={t("ap.sidebar.down")}
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7"
                  disabled={i === a.sidebar.order.length - 1}
                  onClick={() => moveNav(k, 1)}
                >
                  <ChevronDown size={15} />
                </IconButton>
                <IconButton
                  label={hidden ? t("ap.sidebar.show") : t("ap.sidebar.hide")}
                  tip
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7"
                  disabled={k === "home"}
                  onClick={() => toggleNav(k)}
                >
                  {hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                </IconButton>
              </div>
            );
          })}
        </div>
      </SettingRow>
    </SettingsCard>
  );
}
