// Einmaliger Hinweis „Neu: Simple-Modus“ für bestehende Nutzer (Expert, Onboarding nie gesehen). Unaufdringlich
// unten links über dem Inhalt; „Ausprobieren“ schaltet um (die Einführung startet dann von selbst), „Nicht jetzt“
// blendet ihn für immer aus. Zurück geht es jederzeit über das Konto-Menü.
import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui";
import { useSettings } from "@/lib/queries";
import { patchSettings, setMode } from "@/lib/mode";
import { useT } from "@/i18n";
import { useOnboarding } from "./store";

export function SimpleModeHint() {
  const t = useT();
  const s = useSettings().data;
  const onboarding = useOnboarding((x) => x.open);
  if (!s || !s.onboarding_done || s.simple_hint_seen || s.ui_mode !== "expert" || onboarding) return null;
  const dismiss = () => patchSettings({ simple_hint_seen: true }).catch(() => {});
  return (
    <div
      role="status"
      className="vl-bubble fixed bottom-4 z-[45] flex w-[340px] flex-col gap-3 rounded-card bg-overlay p-4 shadow-e3"
      style={{ left: "calc(var(--rail-w) + 16px)" }}
    >
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-card bg-brand/15 text-brand">
          <Sparkles size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-text">{t("hint.simple.title")}</div>
          <p className="mt-0.5 text-[12.5px] leading-snug text-muted">{t("hint.simple.text")}</p>
        </div>
        <button aria-label={t("common.close")} onClick={dismiss} className="-mr-1.5 -mt-1 grid h-7 w-7 place-items-center rounded-ctl text-dim hover:bg-white/[.07] hover:text-text">
          <X size={15} />
        </button>
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="subtle" onClick={dismiss}>
          {t("hint.simple.later")}
        </Button>
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            void setMode("simple").then(() => patchSettings({ simple_hint_seen: true }));
          }}
        >
          {t("hint.simple.try")}
        </Button>
      </div>
    </div>
  );
}
