// Microsoft-Anmeldung per Gerätecode: Code groß anzeigen (automatisch in der Zwischenablage), Browser öffnen,
// auf Abschluss warten (`authMsaWait`). Abbrechen ruft `authMsaCancel`.
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, Check, CheckCircle2, Copy, ExternalLink, KeyRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Dialog, Skeleton, Spinner, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { api, errorMessage, isCancelled } from "@/lib/api";
import { qk, queryClient } from "@/lib/queries";
import type { Account, DeviceCode } from "@/lib/types";
import { PlayerHead } from "@/components/PlayerHead";
import { copyText, openExternal } from "@/components/content/util";

type Phase = { k: "begin" } | { k: "code"; code: DeviceCode; started: number } | { k: "done"; account: Account } | { k: "error"; message: string };

export function MsaDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const avail = useQuery({ queryKey: ["msa-available"], queryFn: api.authMsaAvailable, enabled: open, staleTime: 0, placeholderData: undefined });
  const [phase, setPhase] = useState<Phase>({ k: "begin" });
  const session = useRef(0);
  const [copied, setCopied] = useState(false);

  const run = async () => {
    const my = ++session.current;
    setPhase({ k: "begin" });
    setCopied(false);
    try {
      const code = await api.authMsaBegin();
      if (my !== session.current) return;
      setPhase({ k: "code", code, started: Date.now() });
      copyText(code.user_code)
        .then(() => my === session.current && setCopied(true))
        .catch(() => {});
      const account = await api.authMsaWait();
      if (my !== session.current) return;
      queryClient.invalidateQueries({ queryKey: qk.accounts });
      setPhase({ k: "done", account });
    } catch (e) {
      if (my !== session.current || isCancelled(e)) return;
      setPhase({ k: "error", message: errorMessage(e) });
    }
  };

  // Ablauf starten, sobald der Dialog offen ist und Microsoft-Login verfügbar ist (einmal je Öffnen)
  const startedFor = useRef<number>(-1);
  const openCount = useRef(0);
  useEffect(() => {
    if (open) openCount.current++;
  }, [open]);
  useEffect(() => {
    if (open && avail.data === true && startedFor.current !== openCount.current) {
      startedFor.current = openCount.current;
      void run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, avail.data]);

  const close = () => {
    if (phase.k === "begin" || phase.k === "code") api.authMsaCancel().catch(() => {});
    session.current++;
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(true) : close())}
      title={t("accounts.msa.title")}
      size="md"
      footer={
        phase.k === "done" ? (
          <Button variant="primary" onClick={() => onOpenChange(false)} autoFocus>
            {t("common.done")}
          </Button>
        ) : phase.k === "error" ? (
          <>
            <Button variant="subtle" onClick={close}>
              {t("common.close")}
            </Button>
            <Button variant="primary" onClick={() => void run()} autoFocus>
              {t("common.retry")}
            </Button>
          </>
        ) : (
          <Button variant="subtle" onClick={close}>
            {t("common.cancel")}
          </Button>
        )
      }
    >
      {avail.isPending ? (
        <Skeleton className="h-[220px]" />
      ) : avail.data === false || avail.isError ? (
        <div className="flex flex-col items-center gap-3 px-4 py-6 text-center">
          <KeyRound size={26} className="text-warn" />
          <div className="text-[15px] font-semibold text-text">{t("accounts.msa.unavailable")}</div>
          <p className="max-w-[420px] text-[13px] text-muted">{t("accounts.msa.unavailable_text")}</p>
          <Link
            to="/settings"
            search={{ tab: "general" }}
            onClick={() => onOpenChange(false)}
            className="mt-1 inline-flex h-9 items-center rounded-ctl bg-surface2 px-4 text-[13.5px] font-semibold text-text transition-colors hover:bg-surface3"
          >
            {t("accounts.msa.to_settings")}
          </Link>
        </div>
      ) : phase.k === "begin" ? (
        <div className="flex flex-col items-center gap-4 py-6">
          <Skeleton className="h-[72px] w-[300px]" />
          <div className="flex items-center gap-2 text-[13px] text-muted">
            <Spinner size={12} className="text-muted" />
            {t("accounts.msa.requesting")}
          </div>
        </div>
      ) : phase.k === "code" ? (
        <CodeView code={phase.code} started={phase.started} copied={copied} onCopy={() => copyText(phase.code.user_code).then(() => setCopied(true)).catch((e) => toast.error(e))} />
      ) : phase.k === "done" ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center animate-fade-in">
          <div className="relative">
            <PlayerHead uuid={phase.account.uuid} name={phase.account.username} size={72} />
            <CheckCircle2 size={22} className="absolute -bottom-2 -right-2 rounded-pill bg-overlay text-ok" />
          </div>
          <div className="mt-2 text-title text-text">{phase.account.username}</div>
          <p className="text-[13px] text-muted">{t("accounts.msa.success")}</p>
        </div>
      ) : (
        <div className="flex items-start gap-3 rounded-card bg-danger/10 px-4 py-3.5">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-danger" />
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-text">{t("accounts.msa.failed")}</div>
            <div className="selectable mt-1 break-words text-[12.5px] text-muted">{phase.message}</div>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function CodeView({ code, started, copied, onCopy }: { code: DeviceCode; started: number; copied: boolean; onCopy: () => void }) {
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
