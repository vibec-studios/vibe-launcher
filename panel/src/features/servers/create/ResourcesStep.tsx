import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { Software } from "@/api/types";
import { useResources } from "@/app/agent";
import { bytes, mib } from "@/app/format";
import { useT } from "@/i18n";
import { Field, Input, cn } from "@/components/ui";

export function recommendedMemory(s: Software): number {
  if (s === "vanilla" || s === "paper" || s === "purpur") return 3072;
  if (s === "folia") return 6144;
  if (s === "fabric" || s === "quilt") return 4096;
  return 6144;
}

export function ResourcesStep({ software, name, onName, memory, onMemory, port, onPort }: { software: Software; name: string; onName: (v: string) => void; memory: number; onMemory: (v: number) => void; port: string; onPort: (v: string) => void }) {
  const t = useT();
  const res = useResources().data;
  const [more, setMore] = useState(false);
  const rec = recommendedMemory(software);
  const free = res ? res.mem_total - res.mem_used : null;
  const tooMuch = free != null && memory * 1_048_576 > free;
  const max = res ? Math.max(4096, Math.floor(res.mem_total / 1_073_741_824) * 1024 - 1024) : 16384;
  return (
    <div className="flex flex-col gap-6">
      <Field label={t("create.name")} hint={t("create.name_hint")}>
        <Input value={name} maxLength={48} onChange={(e) => onName(e.target.value)} placeholder={t("create.name_ph")} />
      </Field>
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <span className="label">{t("create.memory")}</span>
          <span className="text-[17px] font-bold tabular-nums">{mib(memory)}</span>
        </div>
        <input type="range" min={1024} max={max} step={512} value={memory} onChange={(e) => onMemory(Number(e.target.value))} className="w-full accent-[var(--ui-accent)]" aria-label={t("create.memory")} />
        <div className="flex flex-wrap justify-between gap-2 text-meta text-muted">
          <span>
            {t("create.memory_rec", { size: mib(rec) })}{" "}
            {memory !== rec && (
              <button type="button" className="font-semibold text-accent hover:underline" onClick={() => onMemory(rec)}>
                {t("create.memory_use_rec")}
              </button>
            )}
          </span>
          {free != null && <span className={cn(tooMuch && "text-warn")}>{t("create.memory_free", { size: bytes(free) })}</span>}
        </div>
        <p className="text-meta text-dim">{t("create.memory_hint")}</p>
      </div>
      <div>
        <button type="button" className="flex items-center gap-1.5 text-meta font-semibold text-muted hover:text-text" onClick={() => setMore((v) => !v)}>
          <ChevronDown size={15} className={cn("transition-transform", more && "rotate-180")} />
          {t("create.more")}
        </button>
        {more && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label={t("create.port")} hint={t("create.port_hint")}>
              <Input inputMode="numeric" placeholder={t("create.port_auto")} value={port} onChange={(e) => onPort(e.target.value.replace(/\D/g, "").slice(0, 5))} />
            </Field>
          </div>
        )}
      </div>
    </div>
  );
}
