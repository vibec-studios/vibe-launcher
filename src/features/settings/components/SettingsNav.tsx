import * as D from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { Cloud, Coffee, Download, Gamepad2, Info, Palette, RefreshCw, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { Tooltip, cn, toast } from "@/components/ui";
import { SaveIndicator, type SaveState } from "@/components/instance/forms";
import { setMode, useSimple } from "@/lib/mode";
import { useT } from "@/i18n";
import { setSettingsTab, type SettingsTab } from "../store";
import { useNarrow } from "../hooks/useNarrow";

const ICONS: Record<SettingsTab, ReactNode> = {
  general: <SlidersHorizontal size={16} />,
  appearance: <Palette size={16} />,
  java: <Coffee size={16} />,
  game: <Gamepad2 size={16} />,
  downloads: <Download size={16} />,
  vibe: <Cloud size={16} />,
  privacy: <ShieldCheck size={16} />,
  updates: <RefreshCw size={16} />,
  about: <Info size={16} />,
};

export function SettingsNav({ tabs, tab, state }: { tabs: readonly SettingsTab[]; tab: SettingsTab; state: SaveState }) {
  const t = useT();
  const narrow = useNarrow();
  const simple = useSimple();
  return (
    <aside className="flex w-[232px] shrink-0 flex-col bg-bg max-[880px]:w-[60px]">
      <div className="flex h-[64px] shrink-0 items-center px-5 max-[880px]:justify-center max-[880px]:px-0">
        <D.Title className="text-title text-text max-[880px]:sr-only">{t("nav.settings")}</D.Title>
        <span className="hidden text-muted max-[880px]:block">
          <SlidersHorizontal size={18} />
        </span>
      </div>
      <nav role="tablist" aria-orientation="vertical" className="scroll flex min-h-0 flex-1 flex-col gap-0.5 px-2.5 max-[880px]:items-center max-[880px]:px-0">
        {tabs.map((id) => {
          const active = id === tab;
          const btn = (
            <button
              key={id}
              role="tab"
              data-tour={`settings-tab-${id}`}
              aria-selected={active}
              aria-label={t(`settings.tab.${id}`)}
              onClick={() => setSettingsTab(id)}
              className={cn(
                "vl-snav relative flex h-9 shrink-0 items-center gap-3 rounded-ctl px-3 text-left text-[13.5px] font-medium transition-colors duration-100",
                "max-[880px]:h-10 max-[880px]:w-10 max-[880px]:justify-center max-[880px]:px-0",
                active ? "bg-white/[.08] text-text" : "text-muted hover:bg-white/[.05] hover:text-text",
              )}
            >
              <span className={active ? "text-brand" : "text-dim"}>{ICONS[id]}</span>
              <span className="truncate max-[880px]:hidden">{t(`settings.tab.${id}`)}</span>
            </button>
          );
          return (
            <Tooltip key={id} content={narrow ? t(`settings.tab.${id}`) : null} side="right">
              {btn}
            </Tooltip>
          );
        })}
      </nav>
      {simple && (
        <div className="px-2.5 pb-1 max-[880px]:hidden">
          <button
            onClick={() => void setMode("expert").catch((e) => toast.error(e))}
            className="flex w-full items-center gap-2 rounded-ctl px-3 py-2 text-left text-[12.5px] font-medium text-muted transition-colors hover:bg-white/[.05] hover:text-text"
          >
            <SlidersHorizontal size={14} className="shrink-0 text-dim" />
            {t("simple.settings.more")}
          </button>
        </div>
      )}
      <div className="flex h-11 shrink-0 items-center px-5 max-[880px]:justify-center max-[880px]:px-0">
        <SaveIndicator state={state} />
      </div>
    </aside>
  );
}
