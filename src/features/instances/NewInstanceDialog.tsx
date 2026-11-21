import { useEffect, useState } from "react";
import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/components/ui";
import { restoreNewInstanceFocus } from "@/components/instance/actions";
import { NewBedrockTab } from "@/features/bedrock/NewBedrockTab";
import { useT } from "@/i18n";
import { CustomTab } from "./new/CustomTab";
import { ImportTab } from "./new/ImportTab";
import { ModpackTab } from "./new/ModpackTab";

export { AccentPicker, GroupField, GroupInput, suggestName } from "./new/fields";
export { IconPicker } from "./new/IconPicker";

type Tab = "custom" | "modpack" | "bedrock" | "import";

// ------------------------------------------------------------------ Dialog

export function NewInstanceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const [tab, setTab] = useState<Tab>("custom");
  const [busy, setBusy] = useState(false);
  // Beim Öffnen zurücksetzen (Inhalte werden ohnehin neu gemountet)
  useEffect(() => {
    if (open) {
      setTab("custom");
      setBusy(false);
    }
  }, [open]);
  const close = () => onOpenChange(false);
  const tabs: { value: Tab; label: string }[] = [
    { value: "custom", label: t("newinst.tab.custom") },
    { value: "modpack", label: t("newinst.tab.modpack") },
    { value: "bedrock", label: t("bedrock.newinst.tab") },
    { value: "import", label: t("newinst.tab.import") },
  ];

  return (
    <D.Root open={open} onOpenChange={(o) => (!busy || o) && onOpenChange(o)}>
      <D.Portal>
        <D.Overlay className="vl-overlay fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-fade-in" />
        <D.Content
          onEscapeKeyDown={(e) => busy && e.preventDefault()}
          onPointerDownOutside={(e) => busy && e.preventDefault()}
          onInteractOutside={(e) => busy && e.preventDefault()}
          onCloseAutoFocus={restoreNewInstanceFocus}
          aria-describedby={undefined}
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden",
            "h-[min(660px,calc(100%-48px))] w-[960px] max-w-[calc(100%-48px)]",
            "vl-dialog rounded-panel bg-overlay shadow-e3 data-[state=open]:animate-pop-in",
          )}
          // Auswahl und Hauptaktion in der globalen Akzentfarbe; die Instanzfarbe gehört nur dem Icon
          style={{ "--accent": "var(--ui-accent)", "--on-accent": "var(--ui-on-accent)" } as React.CSSProperties}
        >
          <header className="shrink-0 border-b border-line">
            <div className="flex items-center justify-between gap-4 px-6 py-3">
              <D.Title className="text-title text-text">{t("newinst.title")}</D.Title>
              {!busy && (
                <D.Close
                  aria-label={t("common.close")}
                  className="grid h-8 w-8 place-items-center rounded-ctl text-dim transition-colors hover:bg-white/[.07] hover:text-text"
                >
                  <X size={18} />
                </D.Close>
              )}
            </div>
            <div className="flex flex-wrap items-stretch gap-x-2 px-6" role="tablist">
              {tabs.map((it) => (
                <button
                  key={it.value}
                  role="tab"
                  aria-selected={tab === it.value}
                  disabled={busy}
                  onClick={() => setTab(it.value)}
                  className={cn(
                    "flex min-h-10 items-center px-3 text-[13.5px] font-semibold transition-colors duration-150",
                    tab === it.value ? "text-text shadow-[inset_0_-2px_0_var(--ui-accent)]" : "text-muted hover:text-text",
                  )}
                >
                  {it.label}
                </button>
              ))}
            </div>
          </header>
          {tab === "custom" ? (
            <CustomTab onDone={close} onBusy={setBusy} />
          ) : tab === "modpack" ? (
            <ModpackTab onDone={close} />
          ) : tab === "bedrock" ? (
            <NewBedrockTab onDone={close} onBusy={setBusy} />
          ) : (
            <ImportTab onDone={close} />
          )}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
