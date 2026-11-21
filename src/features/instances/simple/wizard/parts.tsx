import { SlidersHorizontal } from "lucide-react";
import { cn } from "@/components/ui";
import { openExpertNewInstance } from "@/components/instance/actions";
import { useT } from "@/i18n";

export type Step = "goal" | "packs" | "details";


export function Dots({ step, withPacks }: { step: Step; withPacks: boolean }) {
  const steps: Step[] = withPacks ? ["goal", "packs", "details"] : ["goal", "details"];
  const idx = steps.indexOf(step);
  return (
    <div className="flex shrink-0 items-center gap-1.5 pr-2" aria-hidden>
      {steps.map((s, i) => (
        <span key={s} className={cn("h-1.5 transition-[width,background-color] duration-200", i === idx ? "w-5 bg-brand" : i < idx ? "w-1.5 bg-white/40" : "w-1.5 bg-white/15")} />
      ))}
    </div>
  );
}

export function Footer({ children }: { children: React.ReactNode }) {
  return <footer className="flex shrink-0 flex-wrap items-center gap-3 border-t border-line px-6 py-3">{children}</footer>;
}

/** „Erweitert“: in den vollen Dialog mit allen Versionen und Mod-Unterbauten. */
export function AdvancedLink() {
  const t = useT();
  return (
    <button onClick={openExpertNewInstance} className="flex items-center gap-1.5 text-[12.5px] font-medium text-dim transition-colors hover:text-text">
      <SlidersHorizontal size={13} />
      {t("wiz.advanced")}
    </button>
  );
}
