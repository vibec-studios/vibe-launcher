import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CircleCheck, Clock, Gift, PlugZap, Ticket, TriangleAlert } from "lucide-react";
import { Button, Dialog, Input, Skeleton, Spinner, toast } from "@/components/ui";
import { PlayerHead } from "@/components/PlayerHead";
import { formatDate } from "@/lib/format";
import { useVibe } from "@/lib/vibe";
import { useT } from "@/i18n";
import { connect, useSocial, vibeClient } from "@/features/social/service";
import { hasAccessClient, redeemAccessInvite, useVibeAccess } from "@/features/access/store";
import { INVITE_CODE, aik, normalizeCode, redeemError } from "./api";

async function redeem(code: string, t: ReturnType<typeof useT>) {
  const info = await redeemAccessInvite(code);
  if (info.status === "approved") toast.success(t("ainv.redeem.done"), t("ainv.redeem.done_text"));
  return info;
}

export function RedeemInviteRow({ bare }: { bare?: boolean }) {
  const t = useT();
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const code = normalizeCode(raw);
  const valid = INVITE_CODE.test(code);
  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await redeem(code, t);
      setRaw("");
    } catch (e) {
      setErr(redeemError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={bare ? "flex items-start gap-4" : "flex items-start gap-4 border-t border-line px-4 py-3.5"}>
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-card bg-surface2 text-brand">
        <Ticket size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold leading-tight text-text">{t("ainv.redeem.title")}</div>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{t("ainv.redeem.text")}</p>
        <form
          className="mt-2.5 flex max-w-md items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) void submit();
          }}
        >
          <Input
            value={raw}
            onChange={(e) => (setRaw(e.target.value), setErr(null))}
            placeholder={t("ainv.redeem.placeholder")}
            aria-label={t("ainv.redeem.title")}
            className="font-mono"
            invalid={!!err}
          />
          <Button type="submit" variant="primary" loading={busy} disabled={!valid}>
            {t("ainv.redeem.button")}
          </Button>
        </form>
        {err && <p className="mt-1.5 text-[12.5px] text-danger">{err}</p>}
      </div>
    </div>
  );
}

export function AccessInviteDialog({ code, onClose }: { code: string; onClose: () => void }) {
  const t = useT();
  const vibe = useVibe();
  const conn = useSocial((s) => s.conn);
  const status = useVibeAccess((s) => s.status);
  const busyAccess = useVibeAccess((s) => s.busy);
  const [err, setErr] = useState<string | null>(null);
  const client = vibeClient();
  const q = useQuery({ queryKey: aik.preview(code), queryFn: () => client!.accessInvites.preview(code), enabled: !!client, retry: 0, staleTime: 30_000 });
  const p = q.data;
  const approved = status === "approved";
  const canRedeem = !!p?.valid && hasAccessClient() && !approved;

  const go = async () => {
    setErr(null);
    try {
      const info = await redeem(code, t);
      if (info.status === "approved") onClose();
    } catch (e) {
      setErr(redeemError(e));
    }
  };

  let body: React.ReactNode;
  if (!vibe.enabled || !client) {
    body = (
      <div className="flex items-start gap-3 text-[13px] text-muted">
        <PlugZap size={18} className="mt-0.5 shrink-0 text-brand" />
        <div>
          <p className="text-text">{t("ainv.redeem.connect")}</p>
          <Button size="sm" variant="primary" className="mt-3" loading={conn === "connecting" || conn === "logging_in"} onClick={() => void connect().catch((e) => setErr(redeemError(e)))}>
            {t("ainv.redeem.connect_button")}
          </Button>
        </div>
      </div>
    );
  } else if (q.isPending) {
    body = (
      <div className="flex items-center gap-3">
        <Skeleton className="h-12 w-12" />
        <Skeleton className="h-5 w-56" />
      </div>
    );
  } else if (q.isError || !p) {
    body = (
      <p className="flex items-start gap-2 text-[13px] text-danger">
        <TriangleAlert size={15} className="mt-0.5 shrink-0" />
        {redeemError(q.error)}
      </p>
    );
  } else {
    body = (
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3.5">
          <PlayerHead uuid={p.inviter.uuid} name={p.inviter.name} size={48} />
          <div className="min-w-0">
            <div className="text-[16px] font-semibold text-text">{t("ainv.redeem.from", { name: p.inviter.name })}</div>
            <div className="mt-0.5 font-mono text-meta tracking-wider text-dim">{p.code}</div>
          </div>
        </div>
        {approved ? (
          <p className="flex items-center gap-2 rounded-card bg-ok/10 px-3 py-2.5 text-[13px] text-text">
            <CircleCheck size={15} className="shrink-0 text-ok" />
            {t("ainv.redeem.already")}
          </p>
        ) : p.valid ? (
          <div className="flex flex-col gap-1.5 rounded-card bg-surface px-3 py-2.5 text-[13px]">
            <span className="flex items-center gap-2 text-text">
              <Gift size={14} className="shrink-0 text-brand" />
              {t("ainv.redeem.explain")}
            </span>
            {p.name && <span className="text-muted">{t("ainv.redeem.bound", { name: p.name })}</span>}
            {!hasAccessClient() && (
              <Button size="sm" variant="subtle" className="mt-1 self-start" icon={<PlugZap size={13} />} loading={conn === "connecting" || conn === "logging_in"} onClick={() => void connect().catch((e) => setErr(redeemError(e)))}>
                {t("ainv.redeem.connect_button")}
              </Button>
            )}
            <span className="flex items-center gap-1.5 text-caption text-dim">
              <Clock size={11} />
              {t("ainv.until", { date: formatDate(p.expiresAt) })}
            </span>
          </div>
        ) : (
          <p className="flex items-start gap-2 rounded-card bg-surface px-3 py-2.5 text-[13px] text-muted">
            <TriangleAlert size={15} className="mt-0.5 shrink-0 text-warn" />
            {t(`ainv.redeem.invalid_${p.status}`)}
          </p>
        )}
        {status === "unknown" && hasAccessClient() && (
          <span className="flex items-center gap-2 text-caption text-dim">
            <Spinner size={10} />
            {t("access.checking")}
          </span>
        )}
      </div>
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      size="md"
      title={t("ainv.redeem.dialog_title")}
      description={t("action.source_hint")}
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            {approved ? t("common.close") : t("common.cancel")}
          </Button>
          {!approved && (
            <Button variant="primary" icon={<Ticket size={14} />} loading={busyAccess} disabled={!canRedeem} onClick={() => void go()}>
              {t("ainv.redeem.button")}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {body}
        {err && <p className="text-[12.5px] text-danger">{err}</p>}
      </div>
    </Dialog>
  );
}

export function RedeemInviteButton() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const approved = useVibeAccess((s) => s.status === "approved");
  if (approved) return null;
  return (
    <>
      <Button size="sm" variant="ghost" icon={<Ticket size={13} />} onClick={() => setOpen(true)}>
        {t("ainv.redeem.have_code")}
      </Button>
      {open && (
        <Dialog open onOpenChange={setOpen} size="md" title={t("ainv.redeem.title")}>
          <RedeemInviteRow bare />
        </Dialog>
      )}
    </>
  );
}
