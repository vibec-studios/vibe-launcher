import { AppWindow, KeyRound, XCircle } from "lucide-react";
import { Button, Spinner } from "@/components/ui";
import { useT } from "@/i18n";

export function FallbackLinks({ onCode, onWindow }: { onCode?: () => void; onWindow?: () => void }) {
  const t = useT();
  return (
    <div className="flex w-full flex-col items-center gap-1.5 border-t border-line pt-3.5 text-center">
      {onCode && (
        <button onClick={onCode} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-muted underline-offset-2 hover:text-text hover:underline">
          <KeyRound size={12} />
          {t("accounts.msa.use_code")}
          <span className="font-normal text-dim">· {t("accounts.msa.use_code_hint")}</span>
        </button>
      )}
      {onWindow && (
        <button onClick={onWindow} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-muted underline-offset-2 hover:text-text hover:underline">
          <AppWindow size={12} />
          {t("accounts.msa.use_window")}
        </button>
      )}
      <span className="text-[11.5px] text-dim">{t("accounts.msa.personal_only")}</span>
    </div>
  );
}

export function WindowWaiting({ onCode }: { onCode: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-col items-center gap-4 pt-3 text-center animate-fade-in">
      <div className="grid h-14 w-14 place-items-center rounded-card bg-brand/15 text-brand">
        <AppWindow size={26} />
      </div>
      <div>
        <div className="text-[15px] font-semibold text-text">{t("accounts.msa.window_open")}</div>
        <p className="mx-auto mt-1 max-w-[400px] text-[13px] text-muted">{t("accounts.msa.window_text")}</p>
      </div>
      <span className="flex items-center gap-2 text-[12.5px] text-muted">
        <Spinner size={12} className="text-muted" />
        {t("accounts.msa.window_waiting")}
      </span>
      <FallbackLinks onCode={onCode} />
    </div>
  );
}

export function WindowClosed({ onWindow, onCode }: { onWindow: () => void; onCode: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-col items-center gap-4 pt-3 text-center animate-fade-in">
      <div className="grid h-14 w-14 place-items-center rounded-card bg-surface2 text-muted">
        <XCircle size={26} />
      </div>
      <div>
        <div className="text-[15px] font-semibold text-text">{t("accounts.msa.window_closed")}</div>
        <p className="mx-auto mt-1 max-w-[400px] text-[13px] text-muted">{t("accounts.msa.window_closed_text")}</p>
      </div>
      <Button variant="primary" icon={<AppWindow size={14} />} onClick={onWindow} autoFocus>
        {t("accounts.msa.window_start")}
      </Button>
      <FallbackLinks onCode={onCode} />
    </div>
  );
}
