import { Check } from "lucide-react";
import type { Software } from "@/api/types";
import { useT, type Key } from "@/i18n";
import { cn } from "@/components/ui";
import { SOFTWARE_NAMES } from "../meta";
import { SoftwareIcon } from "../parts";

const GROUPS: { key: Key; items: Software[] }[] = [
  { key: "create.group.plugins", items: ["paper", "purpur", "folia"] },
  { key: "create.group.mods", items: ["fabric", "neoforge", "forge", "quilt"] },
  { key: "create.group.vanilla", items: ["vanilla"] },
];

export function SoftwareStep({ value, onChange }: { value: Software; onChange: (s: Software) => void }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-5">
      {GROUPS.map((g) => (
        <div key={g.key}>
          <div className="label mb-2">{t(g.key)}</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {g.items.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={value === s}
                onClick={() => onChange(s)}
                className={cn(
                  "relative flex items-start gap-3 rounded-card p-3.5 text-left transition-colors",
                  value === s ? "bg-brand/12 shadow-[inset_0_0_0_1.5px_var(--ui-accent)]" : "bg-surface2 hover:bg-surface3",
                )}
              >
                <SoftwareIcon software={s} size={38} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 font-semibold">
                    {SOFTWARE_NAMES[s]}
                    {s === "paper" && <span className="rounded-pill bg-ok/15 px-1.5 py-px text-[10.5px] font-bold text-ok">{t("create.recommended")}</span>}
                  </div>
                  <div className="mt-0.5 text-meta text-muted">{t(`sw.${s}` as Key)}</div>
                </div>
                {value === s && <Check size={16} className="absolute top-3 right-3 text-accent" />}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
