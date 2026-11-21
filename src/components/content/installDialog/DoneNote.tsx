import { CheckCircle2 } from "lucide-react";
import { useT } from "@/i18n";
import { useManualMode } from "./state";

export function DoneNote({ name, manual }: { name: string; manual: boolean }) {
  const t = useT();
  const mode = useManualMode((s) => s.mode);
  const text = manual && mode === "open" ? t("manual.done_inline", { name }) : manual && mode === "add" ? t("manual.added_inline", { name }) : t("install.done_inline", { name });
  return (
    <div className="mt-5 flex items-center gap-3 rounded-card bg-ok/[.08] px-4 py-3 animate-fade-in">
      <CheckCircle2 size={18} className="shrink-0 text-ok" />
      <div className="text-[13px]">{text}</div>
    </div>
  );
}
