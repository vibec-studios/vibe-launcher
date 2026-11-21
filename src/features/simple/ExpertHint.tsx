import type { ReactNode } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button, cn, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { setMode, useSimple } from "@/lib/mode";

function switchToExpert() {
  void setMode("expert").catch((e) => toast.error(e));
}

export function ExpertHint({ text, className }: { text: ReactNode; className?: string }) {
  const t = useT();
  if (!useSimple()) return null;
  return (
    <div data-testid="expert-hint" className={cn("flex items-center gap-3 rounded-card bg-white/[.035] px-4 py-2.5", className)}>
      <SlidersHorizontal size={15} className="shrink-0 text-dim" />
      <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-muted">{text}</p>
      <button type="button" onClick={switchToExpert} className="shrink-0 text-[12.5px] font-semibold text-accent hover:underline">
        {t("usab.expert.switch")}
      </button>
    </div>
  );
}

export function ExpertGate({ title, text, children }: { title: string; text: string; children: ReactNode }) {
  const t = useT();
  if (!useSimple()) return <>{children}</>;
  return (
    <div data-testid="expert-gate" className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="vl-empty-icon grid h-14 w-14 place-items-center rounded-panel bg-white/[.05] text-dim">
        <SlidersHorizontal size={24} />
      </span>
      <h2 className="text-[17px] font-semibold text-text">{title}</h2>
      <p className="max-w-[440px] text-[13.5px] leading-relaxed text-muted">{text}</p>
      <Button variant="accent" className="mt-2" icon={<SlidersHorizontal size={15} />} onClick={switchToExpert}>
        {t("usab.expert.switch_long")}
      </Button>
      <p className="text-[12px] text-dim">{t("usab.expert.back")}</p>
    </div>
  );
}
