import { cn } from "@/components/ui";
import { useT } from "@/i18n";
import { PARTS } from "./layout";
import type { Focus, SkinEditor } from "./useSkinEditor";

const ITEMS: Focus[] = ["all", ...PARTS];

export function PartsPanel({ ed }: { ed: SkinEditor }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-2">
      <div className="text-section text-muted">{t("skined.parts")}</div>
      <div className="grid grid-cols-2 gap-1.5">
        {ITEMS.map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={ed.focus === p}
            onClick={() => ed.setFocus(p)}
            className={cn(
              "h-9 truncate rounded-ctl px-3 text-left text-[13px] font-semibold transition-colors duration-100",
              p === "all" && "col-span-2",
              ed.focus === p ? "bg-surface3 text-text outline outline-2 outline-accent" : "bg-surface2 text-muted hover:bg-surface3 hover:text-text",
            )}
          >
            {t(`skined.part.${p}`)}
          </button>
        ))}
      </div>
      <p className="text-[12px] leading-snug text-dim">{t("skined.parts_hint")}</p>
    </div>
  );
}
