// Launcher-Einstellungen als großes Popup: Tabs links, Inhalt rechts (auf schmalen Fenstern nur Icons).
// Öffnen überall per `openSettings(tab)` (store.ts); die alte Route `/settings?tab=…` leitet hierher um.
// Alles speichert automatisch; `settings://changed` hält den Cache aktuell.
import * as D from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { api } from "@/lib/api";
import { qk, useSettings } from "@/lib/queries";
import type { Settings } from "@/lib/types";
import { ThemeProtect, cn } from "@/components/ui";
import { useAutoSave } from "@/components/instance/forms";
import { useSimple } from "@/lib/mode";
import { simpleHides } from "@/lib/simple-mode";
import { useT } from "@/i18n";
import { SETTINGS_TABS, closeSettings, useSettingsDialog, type SettingsTab } from "./store";
import { SettingsNav } from "./components/SettingsNav";
import { LoadingCards, TabContent } from "./components/TabContent";

const merge = (base: Settings, p: Partial<Settings>): Settings => ({ ...base, ...p });

export function SettingsDialog() {
  const open = useSettingsDialog((s) => s.open);
  return (
    <D.Root open={open} onOpenChange={(o) => !o && closeSettings()}>
      <D.Portal>
        <D.Overlay className="vl-overlay fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-fade-in" />
        <D.Content
          data-vt-protected=""
          aria-describedby={undefined}
          // Kein Fokusrahmen auf dem ersten Tab beim Öffnen; Tastatur-Navigation startet im Dialog
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement | null)?.focus();
          }}
          onEscapeKeyDown={(e) => {
            if (e.target instanceof HTMLElement && e.target.closest("[data-esc-local]")) e.preventDefault();
          }}
          tabIndex={-1}
          className={cn(
            "outline-none",
            "fixed left-1/2 top-1/2 z-50 flex -translate-x-1/2 -translate-y-1/2",
            "h-[calc(100%-48px)] max-h-[780px] w-[calc(100%-48px)] max-w-[1100px] overflow-hidden",
            "vl-dialog rounded-panel bg-overlay shadow-e3 data-[state=open]:animate-pop-in",
          )}
        >
          <ThemeProtect>
            <SettingsBody />
          </ThemeProtect>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

function SettingsBody() {
  const t = useT();
  const qc = useQueryClient();
  const settings = useSettings();
  const stored = useSettingsDialog((s) => s.tab);
  const simple = useSimple();
  const tabs = SETTINGS_TABS.filter((x) => !simpleHides.settingsTab(simple, x));
  const tab: SettingsTab = (tabs as readonly SettingsTab[]).includes(stored) ? stored : "general";

  const save = async (p: Partial<Settings>) => {
    const base = qc.getQueryData<Settings>(qk.settings);
    if (!base) return;
    const next = await api.settingsSet({ ...base, ...p });
    qc.setQueryData(qk.settings, next);
  };
  const { draft: s, update, state } = useAutoSave<Settings | undefined, Partial<Settings>>(settings.data, (b, p) => (b ? merge(b, p) : b), save);

  return (
    <>
      <SettingsNav tabs={tabs} tab={tab} state={state} />

      <section className="flex min-w-0 flex-1 flex-col bg-[var(--tone-canvas)]">
        <header className="flex h-[64px] shrink-0 items-center gap-4 pl-7 pr-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-title text-text">{t(`settings.tab.${tab}`)}</h2>
            <p className="truncate text-[12.5px] text-muted">{t(`settings.tab.${tab}.desc`)}</p>
          </div>
          <D.Close aria-label={t("common.close")} className="grid h-9 w-9 shrink-0 place-items-center rounded-ctl text-dim transition-colors hover:bg-white/[.07] hover:text-text">
            <X size={18} />
          </D.Close>
        </header>
        <div key={tab} className="scroll min-h-0 flex-1">
          <div data-tour="settings-content" className="vl-settings mx-auto flex w-full max-w-[860px] flex-col gap-6 px-7 pb-10 pt-2 animate-fade-in">
            {!s ? <LoadingCards /> : <TabContent tab={tab} s={s} update={update} />}
          </div>
        </div>
      </section>
    </>
  );
}
