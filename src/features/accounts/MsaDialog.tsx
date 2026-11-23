import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, KeyRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Dialog, Skeleton, Spinner, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { api, errorMessage, isCancelled } from "@/lib/api";
import { qk, queryClient } from "@/lib/queries";
import type { Account, DeviceCode } from "@/lib/types";
import { PlayerHead } from "@/components/PlayerHead";
import { copyText } from "@/components/content/util";
import { CodeView } from "./MsaCodeView";
import { FallbackLinks, WindowClosed, WindowWaiting } from "./MsaWindowView";

type Mode = "window" | "code";
type Phase =
  | { k: "window" }
  | { k: "closed" }
  | { k: "begin" }
  | { k: "code"; code: DeviceCode; started: number }
  | { k: "done"; account: Account }
  | { k: "error"; message: string; mode: Mode };

export function MsaDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const avail = useQuery({ queryKey: ["msa-available"], queryFn: api.authMsaAvailable, enabled: open, staleTime: 0, placeholderData: undefined });
  const [phase, setPhase] = useState<Phase>({ k: "window" });
  const session = useRef(0);
  const [copied, setCopied] = useState(false);

  const finish = (account: Account) => {
    queryClient.invalidateQueries({ queryKey: qk.accounts });
    setPhase({ k: "done", account });
  };

  const runWindow = async () => {
    const my = ++session.current;
    setPhase({ k: "window" });
    try {
      const account = await api.authMsaWindowLogin(t("accounts.msa.window_title"));
      if (my === session.current) finish(account);
    } catch (e) {
      if (my !== session.current) return;
      setPhase(isCancelled(e) ? { k: "closed" } : { k: "error", message: errorMessage(e), mode: "window" });
    }
  };

  const runCode = async () => {
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
      if (my === session.current) finish(account);
    } catch (e) {
      if (my !== session.current || isCancelled(e)) return;
      setPhase({ k: "error", message: errorMessage(e), mode: "code" });
    }
  };

  const startedFor = useRef<number>(-1);
  const openCount = useRef(0);
  useEffect(() => {
    if (open) openCount.current++;
  }, [open]);
  useEffect(() => {
    if (open && avail.data === true && startedFor.current !== openCount.current) {
      startedFor.current = openCount.current;
      void runWindow();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, avail.data]);

  const close = () => {
    if (phase.k === "window" || phase.k === "begin" || phase.k === "code") api.authMsaCancel().catch(() => {});
    session.current++;
    onOpenChange(false);
  };

  const retry = () => void (phase.k === "error" && phase.mode === "code" ? runCode() : runWindow());

  return (
    <Dialog
      open={open}
      protect
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
            <Button variant="primary" onClick={retry} autoFocus>
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
        <Unavailable onClose={() => onOpenChange(false)} />
      ) : phase.k === "window" ? (
        <WindowWaiting onCode={() => void runCode()} />
      ) : phase.k === "closed" ? (
        <WindowClosed onWindow={() => void runWindow()} onCode={() => void runCode()} />
      ) : phase.k === "begin" ? (
        <div className="flex flex-col items-center gap-4 py-6">
          <Skeleton className="h-[72px] w-[300px]" />
          <div className="flex items-center gap-2 text-[13px] text-muted">
            <Spinner size={12} className="text-muted" />
            {t("accounts.msa.requesting")}
          </div>
        </div>
      ) : phase.k === "code" ? (
        <div className="flex flex-col gap-4">
          <CodeView code={phase.code} started={phase.started} copied={copied} onCopy={() => copyText(phase.code.user_code).then(() => setCopied(true)).catch((e) => toast.error(e))} />
          <FallbackLinks onWindow={() => void runWindow()} />
        </div>
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
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3 rounded-card bg-danger/10 px-4 py-3.5">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-danger" />
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-text">{t("accounts.msa.failed")}</div>
              <div className="selectable mt-1 break-words text-[12.5px] text-muted">{phase.message}</div>
            </div>
          </div>
          <FallbackLinks onCode={phase.mode === "window" ? () => void runCode() : undefined} onWindow={phase.mode === "code" ? () => void runWindow() : undefined} />
        </div>
      )}
    </Dialog>
  );
}

function Unavailable({ onClose }: { onClose: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-6 text-center">
      <KeyRound size={26} className="text-warn" />
      <div className="text-[15px] font-semibold text-text">{t("accounts.msa.unavailable")}</div>
      <p className="max-w-[420px] text-[13px] text-muted">{t("accounts.msa.unavailable_text")}</p>
      <Link
        to="/settings"
        search={{ tab: "general" }}
        onClick={onClose}
        className="mt-1 inline-flex h-9 items-center rounded-ctl bg-surface2 px-4 text-[13.5px] font-semibold text-text transition-colors hover:bg-surface3"
      >
        {t("accounts.msa.to_settings")}
      </Link>
    </div>
  );
}
