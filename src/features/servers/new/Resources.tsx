import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { NumberInput, Slider, cn } from "@/components/ui";
import { formatMb } from "@/components/instance/forms";
import { useT } from "@/i18n";

export function RamField({ ram, setRam, total }: { ram: number; setRam: (v: number) => void; total: number }) {
  const t = useT();
  const limit = Math.max(1024, Math.floor(total / 256) * 256);
  const tone = ram < 2048 ? "low" : ram <= 6144 ? "ok" : "high";
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-3">
        <span className="label flex-1">{t("srv.ram")}</span>
        <span className="font-mono text-[13px] font-semibold text-text">{formatMb(ram)}</span>
      </div>
      <div className="flex h-8 items-center">
        <Slider value={ram} min={512} max={limit} step={256} onChange={setRam} />
      </div>
      <p className={cn("text-[12.5px] leading-relaxed", tone === "low" ? "text-warn" : "text-muted")}>{t(`uic.srv.ram.${tone}`, { total: formatMb(total) })}</p>
    </div>
  );
}

export function AdvancedPort({ port, setPort }: { port: number; setPort: (v: number) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-card border border-line">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-card px-4 py-3 text-left text-[13px] font-medium text-muted outline-none hover:text-text focus-visible:ring-2 focus-visible:ring-brand/60"
      >
        <ChevronRight size={15} className={cn("shrink-0 transition-transform duration-150", open && "rotate-90")} />
        <span className="flex-1">{t("uic.advanced")}</span>
        {!open && <span className="font-mono text-[12px] text-dim">{t("srv.port")} {port}</span>}
      </button>
      {open && (
        <div className="flex items-center gap-4 px-4 pb-4 pl-[39px]">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-text">{t("srv.port")}</div>
            <div className="text-[12.5px] leading-relaxed text-muted">{t("srv.port.desc")}</div>
          </div>
          <div className="w-[120px] shrink-0">
            <NumberInput value={port} min={1024} max={65535} onChange={(v) => v !== null && setPort(v)} aria-label={t("srv.port")} />
          </div>
        </div>
      )}
    </div>
  );
}
