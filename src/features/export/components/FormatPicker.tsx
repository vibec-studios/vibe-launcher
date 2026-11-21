import { Check, PackageOpen } from "lucide-react";
import { cn } from "@/components/ui";
import { useT } from "@/i18n";
import { FORMATS, type Fmt } from "../tree";

export function FormatPicker({ format, setFormat }: { format: Fmt; setFormat: (f: Fmt) => void }) {
  const t = useT();
  return (
    <div className="grid gap-3" role="group" aria-label={t("export.format")}>
      {FORMATS.map((f) => (
        <button
          key={f.value}
          type="button"
          aria-pressed={format === f.value}
          onClick={() => setFormat(f.value)}
          className={cn(
            "flex min-w-0 items-center gap-4 rounded-card border p-4 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
            format === f.value ? "border-accent bg-accent/[.08]" : "border-line bg-surface hover:bg-surface2",
          )}
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-ctl bg-surface3 text-accent"><PackageOpen size={20} /></span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-[16px] font-semibold text-text">{t(`export.format.${f.value}`)}</span>
              <span className="text-[13px] text-muted">.{f.ext}</span>
            </span>
            <span className="mt-0.5 block text-[14px] text-muted">{t(`export.format_text.${f.value}`)}</span>
          </span>
          <span className="w-5 shrink-0 text-accent">{format === f.value && <Check size={20} />}</span>
        </button>
      ))}
    </div>
  );
}
