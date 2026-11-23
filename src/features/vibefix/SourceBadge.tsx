import { BrainCircuit, ListChecks } from "lucide-react";
import { Tag, Tooltip } from "@/components/ui";
import { useT } from "@/i18n";
import type { Diagnosis } from "@/lib/types";

export function SourceBadge({ d }: { d: Diagnosis }) {
  const t = useT();
  if (!d.origin) return null;
  const model = d.origin !== "rules";
  const label = t(`vibefix.origin.${d.origin}`);
  const pct = d.model_confidence != null ? Math.round(d.model_confidence * 100) : null;
  const tip = model ? t(d.id === "unknown" ? "vibefix.origin.tip_unknown" : "vibefix.origin.tip", { pct: pct ?? "?" }) : t("vibefix.origin.tip_rules");
  return (
    <Tooltip content={tip}>
      <span className="inline-flex">
        <Tag className={model ? "text-accent" : undefined}>
          {model ? <BrainCircuit size={11} /> : <ListChecks size={11} />}
          {label}
        </Tag>
      </span>
    </Tooltip>
  );
}
