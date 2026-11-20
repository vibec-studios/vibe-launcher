import { Check, Copy, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Spinner } from "@/components/ui";
import { useT } from "@/i18n";
import type { DeviceCode } from "@/lib/types";
import { openExternal } from "@/components/content/util";

export function CodeView({ code, started, copied, onCopy }: { code: DeviceCode; started: number; copied: boolean; onCopy: () => void }) {
  const t = useT();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(h);
  }, []);
  const left = Math.max(0, Math.round(code.expires_in - (now - started) / 1000));
  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, "0");
  return (
    <div className="flex flex-col items-center gap-5 py-2 animate-fade-in">
      <ol className="flex w-full flex-col gap-1.5 text-[13px] text-muted">
        {(["step1", "step2", "step3"] as const).map((k, i) => (
          <li key={k} className="flex items-start">
            <span className="mr-2.5 inline-grid h-5 w-5 shrink-0 place-items-center rounded-xs bg-surface3 text-[12px] font-semibold text-text">{i + 1}</span>
            {t(`accounts.msa.${k}`)}
          </li>
        ))}
      </ol>
      <button
        onClick={onCopy}
        className="group relative flex w-full flex-col items-center gap-2.5 rounded-card bg-field px-6 py-5 transition-colors duration-150 hover:bg-white/[.07]"
        aria-label={t("common.copy")}
      >
        <span className="selectable font-mono text-[40px] font-bold leading-none tracking-[.08em] text-text">{code.user_code}</span>
        <span className="flex items-center gap-1.5 text-[12.5px] text-muted group-hover:text-text">
          {copied ? <Check size={12} className="text-ok" /> : <Copy size={12} />}
          {copied ? t("accounts.msa.copied") : t("common.copy")}
        </span>
      </button>
      <div className="flex w-full items-center gap-3">
        <Button variant="primary" className="flex-1" icon={<ExternalLink size={14} />} onClick={() => void openExternal(code.verification_uri)} autoFocus>
          {t("accounts.msa.open_browser")}
        </Button>
      </div>
      <div className="flex w-full items-center justify-between gap-3 pt-1">
        <span className="flex items-center gap-2 text-[12.5px] text-muted">
          <Spinner size={12} className="text-muted" />
          {t("accounts.msa.waiting")}
        </span>
        <span className="font-mono text-[11px] text-dim">
          {code.verification_uri.replace(/^https?:\/\//, "")} · {t("accounts.msa.expires", { time: `${mm}:${ss}` })}
        </span>
      </div>
    </div>
  );
}
