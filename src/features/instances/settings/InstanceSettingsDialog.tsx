// Instanz-Einstellungen als Popup im Stil der Launcher-Einstellungen: Tabs links (auf schmalen Fenstern nur
// Icons), Inhalt rechts. Speichert automatisch (gebündelt, verzögert); Änderungen kommen per `instance://changed`
// zurück. Öffnen: `openInstanceSettings(id, tab)`.
import * as D from "@radix-ui/react-dialog";
import { useEffect, useState, type ReactNode } from "react";
import { Cloud, Coffee, Layers, MonitorPlay, Package, RefreshCcw, SlidersHorizontal, Sparkles, Wrench, X } from "lucide-react";
import { api } from "@/lib/api";
import { instanceAccent } from "@/lib/format";
import type { Instance, InstancePatch } from "@/lib/types";
import { Tooltip, cn } from "@/components/ui";
import { SaveIndicator, useAutoSave } from "@/components/instance/forms";
import { InstanceIcon } from "@/components/instance/InstanceIcon";
import { accentVars } from "@/components/instance/accent";
import { useVibe } from "@/lib/vibe";
import { useT } from "@/i18n";
import { INSTANCE_SETTINGS_TABS, closeInstanceSettings, restoreInstanceSettingsFocus, setInstanceSettingsTab, useInstanceSettings, type InstanceSettingsTab } from "./store";
import { AdvancedTab, ClientTab, GeneralTab, JavaTab, LaunchTab, VersionTab, VibeTab, type TabProps } from "./tabs";
import { useClientPacks } from "./ClientPacks";
import { InstanceSyncTab } from "@/components/instance/OptSync";
import { useSimple } from "@/lib/mode";
import { simpleHides } from "@/lib/simple-mode";

const ICONS: Record<InstanceSettingsTab, ReactNode> = {
  general: <SlidersHorizontal size={16} />,
  version: <Layers size={16} />,
  client: <Package size={16} />,
  java: <Coffee size={16} />,
  launch: <MonitorPlay size={16} />,
  sync: <RefreshCcw size={16} />,
  vibe: <Cloud size={16} />,
  advanced: <Wrench size={16} />,
};

const apply = (base: Instance, p: InstancePatch): Instance => ({ ...base, ...p }) as Instance;

/** Auf der Instanzseite eingehängt; offen, solange `openInstanceSettings` diese Instanz gewählt hat. */
export function InstanceSettingsDialog({ instance: inst }: { instance: Instance }) {
  const open = useInstanceSettings((s) => s.instanceId === inst.id);
  return (
    <D.Root open={open} onOpenChange={(o) => !o && closeInstanceSettings()}>
      <D.Portal>
        <D.Overlay className="vl-overlay fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-fade-in" />
        <D.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement | null)?.focus();
          }}
          onCloseAutoFocus={restoreInstanceSettingsFocus}
          tabIndex={-1}
          className={cn(
            "outline-none",
            "fixed left-1/2 top-1/2 z-50 flex -translate-x-1/2 -translate-y-1/2",
            "h-[min(780px,calc(100%-48px))] w-[min(1100px,calc(100%-48px))] overflow-hidden",
            "vl-dialog rounded-panel bg-overlay shadow-e3 data-[state=open]:animate-pop-in",
          )}
          style={accentVars(instanceAccent(inst.id, inst.accent))}
        >
          <Body key={inst.id} instance={inst} />
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

function Body({ instance }: { instance: Instance }) {
  const t = useT();
  const vibe = useVibe();
  const narrow = useNarrow();
  const packs = useClientPacks(instance);
  const vibeyOn = !!packs.data?.packs.find((p) => p.id === "vibey")?.installed;
  const stored = useInstanceSettings((s) => s.tab);
  const simple = useSimple();
  // Vibe-Tab nur bei eingeschalteten Vibe-Diensten
  const tabs = INSTANCE_SETTINGS_TABS.filter((x) => (x !== "vibe" || vibe.enabled) && !simpleHides.instanceTab(simple, x));
  const tab: InstanceSettingsTab = tabs.includes(stored) ? stored : "general";
  const { draft: d, update, local, reset, state } = useAutoSave(instance, apply, (p: InstancePatch) => api.instanceUpdate(instance.id, p));
  const props: TabProps = { instance, d, update, local, reset };
  const accent = instanceAccent(d.id, d.accent);

  return (
    <>
      <aside className="flex w-[208px] shrink-0 flex-col border-r border-line bg-bg max-[680px]:w-[60px]">
        <div className="flex min-h-[72px] shrink-0 items-center gap-3 px-4 py-3 max-[680px]:justify-center max-[680px]:px-0">
          <InstanceIcon icon={d.icon} seed={d.id} accent={accent} size={30} />
          <div className="min-w-0 max-[680px]:sr-only">
            <D.Title className="text-[14px] font-semibold text-text">{t("isd.title")}</D.Title>
            <div className="truncate text-[13px] text-muted" title={d.name}>{d.name}</div>
          </div>
        </div>
        <nav role="tablist" aria-orientation="vertical" className="scroll flex min-h-0 flex-1 flex-col gap-1 px-2.5 max-[680px]:items-center max-[680px]:px-0">
          {tabs.map((id) => {
            const active = id === tab;
            return (
              <Tooltip key={id} content={narrow ? t(`isd.tab.${id}`) : null} side="right">
                <button
                  role="tab"
                  aria-selected={active}
                  aria-label={t(`isd.tab.${id}`)}
                  onClick={() => setInstanceSettingsTab(id)}
                  className={cn(
                    "relative flex min-h-10 shrink-0 items-center gap-3 rounded-ctl px-3 py-2 text-left text-[14px] font-medium transition-colors duration-100",
                    "max-[680px]:w-10 max-[680px]:justify-center max-[680px]:px-0",
                    active ? "bg-accent/[.12] text-text" : "text-muted hover:bg-surface2 hover:text-text",
                  )}
                >
                  <span className={active ? "text-accent" : "text-dim"}>{ICONS[id]}</span>
                  <span className="min-w-0 flex-1 break-words max-[680px]:hidden">{t(`isd.tab.${id}`)}</span>
                  {id === "vibe" && vibeyOn && <Sparkles size={12} className="shrink-0 text-brand max-[680px]:hidden" />}
                </button>
              </Tooltip>
            );
          })}
        </nav>
        <div className="flex min-h-11 shrink-0 items-center px-4 max-[680px]:justify-center max-[680px]:px-0">
          <SaveIndicator state={state} />
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-[72px] shrink-0 items-center gap-4 border-b border-line py-3 pl-6 pr-4">
          <div className="min-w-0 flex-1">
            <h2 className="break-words text-[18px] font-semibold text-text">{t(`isd.tab.${tab}`)}</h2>
            <p className="break-words text-[14px] text-muted">{t(`isd.tab.${tab}.desc`)}</p>
          </div>
          <D.Close aria-label={t("common.close")} className="grid h-9 w-9 shrink-0 place-items-center rounded-ctl text-dim transition-colors hover:bg-white/[.07] hover:text-text">
            <X size={18} />
          </D.Close>
        </header>
        <div key={tab} className="scroll min-h-0 flex-1">
          <div className="vl-settings mx-auto flex w-full max-w-[900px] flex-col gap-5 px-6 pb-10 pt-5 animate-fade-in">
            <TabContent tab={tab} {...props} />
          </div>
        </div>
      </section>
    </>
  );
}

function TabContent({ tab, ...p }: TabProps & { tab: InstanceSettingsTab }) {
  switch (tab) {
    case "general":
      return <GeneralTab {...p} />;
    case "version":
      return <VersionTab {...p} />;
    case "client":
      return <ClientTab {...p} />;
    case "java":
      return <JavaTab {...p} />;
    case "launch":
      return <LaunchTab {...p} />;
    case "sync":
      return <InstanceSyncTab instance={p.instance} />;
    case "vibe":
      return <VibeTab {...p} />;
    case "advanced":
      return <AdvancedTab {...p} />;
  }
}

const NARROW = "(max-width: 680px)";
function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches);
  useEffect(() => {
    const mq = window.matchMedia(NARROW);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}
