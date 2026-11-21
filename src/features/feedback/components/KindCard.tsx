import type { ReactNode } from "react";
import type { FeedbackKind } from "@/lib/types";
import { cn } from "@/components/ui";
import { setFeedback, useFeedback } from "../store";

// ------------------------------------------------------------------ Eingabe

export function KindCard({ value, icon, label }: { value: FeedbackKind; icon: ReactNode; label: string }) {
  const kind = useFeedback((s) => s.kind);
  const on = kind === value;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={() => setFeedback({ kind: value })}
      className={cn(
        "flex h-11 flex-1 items-center justify-center gap-2 rounded-ctl text-[13.5px] font-semibold transition-colors duration-100",
        on ? "bg-brand/15 text-text shadow-[inset_0_0_0_1.5px_var(--color-brand)]" : "bg-field text-muted hover:bg-white/[.07] hover:text-text",
      )}
    >
      <span className={on ? "text-brand" : undefined}>{icon}</span>
      {label}
    </button>
  );
}
