import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { t } from "@/i18n";
import { cn } from "./cn";

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

export function CopyField({ value, mono = true, big, className }: { value: string; mono?: boolean; big?: boolean; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className={cn("flex min-w-0 items-center gap-2 rounded-ctl bg-field pl-3", big ? "h-12" : "h-9", className)}>
      <code className={cn("min-w-0 flex-1 truncate select-all", mono ? "font-mono" : "font-sans", big ? "text-[16px] font-semibold" : "text-[13px]")}>{value}</code>
      <button
        type="button"
        onClick={async () => {
          if (await copyText(value)) {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          }
        }}
        className={cn("flex h-full shrink-0 items-center gap-1.5 rounded-r-ctl px-3 text-[13px] font-semibold transition-colors", done ? "text-ok" : "text-muted hover:bg-white/[.06] hover:text-text")}
      >
        {done ? <Check size={15} /> : <Copy size={15} />}
        {done ? t("common.copied") : t("common.copy")}
      </button>
    </div>
  );
}
