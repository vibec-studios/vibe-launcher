import { useState, type ReactNode } from "react";
import { ChevronDown, ShieldCheck } from "lucide-react";
import { formatBytes } from "@/lib/format";
import type { FeedbackPreview } from "@/lib/types";
import { cn } from "@/components/ui";
import { useT } from "@/i18n";

export function LogBlock({ l, initiallyOpen }: { l: FeedbackPreview["logs"][number]; initiallyOpen: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <div className="overflow-hidden rounded-card bg-surface/60">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left hover:bg-white/[.03]">
        <ChevronDown size={14} className={cn("shrink-0 text-dim transition-transform", !open && "-rotate-90")} />
        <span className="font-mono text-[12.5px] font-medium text-text">{l.name}</span>
        <span className="text-[12px] tabular-nums text-dim">{formatBytes(l.bytes)}</span>
        {l.truncated && <span className="text-[11.5px] text-dim">· {t("fb.preview.truncated", { from: formatBytes(l.original_bytes) })}</span>}
        <span className="flex-1" />
        <span className={cn("inline-flex items-center gap-1 text-[11.5px]", l.redactions ? "text-ok" : "text-dim")}>
          <ShieldCheck size={12} />
          {l.redactions === 1 ? t("fb.preview.redacted_one") : l.redactions ? t("fb.preview.redacted", { n: l.redactions }) : t("fb.preview.redacted_none")}
        </span>
      </button>
      {open && (
        <pre className="selectable scroll max-h-56 overflow-auto whitespace-pre-wrap break-all bg-black/25 px-3.5 py-2.5 font-mono text-[11.5px] leading-[1.55] text-muted">
          {highlight(l.text)}
        </pre>
      )}
    </div>
  );
}

/** Ersetzte Stellen (<user>, <ip>, …) hervorheben. */
function highlight(text: string): ReactNode[] {
  const parts = text.split(/(<(?:user|host|ip|email|token|redacted)>)/g);
  return parts.map((s, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="rounded-[3px] bg-ok/15 px-0.5 text-ok">
        {s}
      </mark>
    ) : (
      s
    ),
  );
}
