import { Check } from "lucide-react";
import type { LoaderKind } from "@/lib/types";
import { loaderNames } from "@/lib/format";
import { cn } from "@/components/ui";
import { LoaderIcon } from "@/components/instance/LoaderIcon";
import { LOADERS } from "@/components/instance/VersionPicker";
import { useT } from "@/i18n";

// ------------------------------------------------------------------ Loader-Karten

export function LoaderCards({ value, onChange }: { value: LoaderKind | null; onChange: (l: LoaderKind) => void }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-1" role="radiogroup" aria-label={t("newinst.loader")}>
      {LOADERS.map((l) => {
        const on = l === value;
        return (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(l)}
            className={cn(
              "flex min-h-[53px] items-center gap-3 rounded-card px-3 py-2 text-left transition-colors duration-100",
              on ? "bg-surface3 shadow-[inset_0_0_0_1px_var(--accent)]" : "bg-surface2 hover:bg-surface3",
            )}
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-ctl bg-surface">
              <LoaderIcon loader={l} size={22} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-semibold leading-tight text-text">{loaderNames[l]}</span>
              <span className="block text-[13px] leading-snug text-muted">{t(`newinst.loader.${l}`)}</span>
            </span>
            {on && <Check size={16} strokeWidth={2.5} className="shrink-0 text-accent" />}
          </button>
        );
      })}
    </div>
  );
}
