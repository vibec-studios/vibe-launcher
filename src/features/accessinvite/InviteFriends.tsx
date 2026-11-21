import { useState } from "react";
import { Check, Copy, Gift, Link2, Plus, Ticket, UserRound, Users, X } from "lucide-react";
import type { AccessInvite } from "@/lib/vibe-sdk";
import { Button, ChoiceCard, ChoiceGrid, Dialog, Field, IconButton, Input, Skeleton, Tag, cn, confirm, toast } from "@/components/ui";
import { copyText } from "@/components/content/util";
import { formatDate } from "@/lib/format";
import { useT } from "@/i18n";
import { MC_NAME, createInvite, inviteError, revokeInvite, useInviteQuota } from "./api";

function CopyButton({ text, label }: { text: string; label: string }) {
  const t = useT();
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      variant="subtle"
      icon={done ? <Check size={13} /> : <Copy size={13} />}
      onClick={async () => {
        await copyText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? t("common.copied") : label}
    </Button>
  );
}

const TONE: Record<AccessInvite["status"], string> = {
  pending: "bg-brand/10 text-brand",
  redeemed: "bg-ok/10 text-ok",
  revoked: "bg-surface2 text-dim",
  expired: "bg-surface2 text-dim",
};

function InviteRow({ inv }: { inv: AccessInvite }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const revoke = async () => {
    const ok = await confirm({ title: t("ainv.revoke_title"), text: t("ainv.revoke_text"), confirmLabel: t("ainv.revoke"), danger: true });
    if (!ok) return;
    setBusy(true);
    try {
      await revokeInvite(inv.id);
    } catch (e) {
      toast.error(inviteError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5">
      <span className="selectable font-mono text-[13.5px] font-semibold tracking-wider text-text">{inv.code}</span>
      <span className={cn("inline-flex h-6 items-center rounded-pill px-2 text-caption font-semibold", TONE[inv.status])}>{t(`ainv.status.${inv.status}`)}</span>
      <span className="min-w-0 flex-1 truncate text-caption text-muted">
        {inv.status === "redeemed" && inv.redeemedBy
          ? t("ainv.redeemed_by", { name: inv.redeemedBy.name })
          : inv.name
            ? t("ainv.bound", { name: inv.name })
            : t("ainv.anyone")}
        {inv.status === "pending" && <span className="text-dim"> · {t("ainv.until", { date: formatDate(inv.expiresAt) })}</span>}
      </span>
      {inv.status === "pending" && (
        <span className="flex shrink-0 items-center gap-1.5">
          <CopyButton text={inv.url} label={t("ainv.copy_link")} />
          <IconButton label={t("ainv.revoke")} tip variant="ghost" size="sm" onClick={() => void revoke()} disabled={busy}>
            <X size={14} />
          </IconButton>
        </span>
      )}
    </li>
  );
}

function Created({ inv, onMore }: { inv: AccessInvite; onMore: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-center gap-2 rounded-card bg-surface px-4 py-5 text-center">
        <Gift size={22} className="text-brand" />
        <span className="text-[13px] text-muted">{inv.name ? t("ainv.created_for", { name: inv.name }) : t("ainv.created_any")}</span>
        <span className="selectable font-mono text-[26px] font-bold tracking-[0.2em] text-text">{inv.code}</span>
        <span className="selectable max-w-full truncate font-mono text-caption text-dim">{inv.url}</span>
        <div className="mt-1 flex flex-wrap justify-center gap-2">
          <CopyButton text={inv.url} label={t("ainv.copy_link")} />
          <CopyButton text={inv.code} label={t("ainv.copy_code")} />
          <CopyButton text={t("ainv.share_text", { url: inv.url, code: inv.code })} label={t("ainv.copy_message")} />
        </div>
      </div>
      <p className="text-[12.5px] leading-relaxed text-muted">{inv.name && inv.status === "redeemed" ? t("ainv.instant") : t("ainv.how")}</p>
      <Button variant="ghost" size="sm" icon={<Plus size={13} />} onClick={onMore} className="self-start">
        {t("ainv.another")}
      </Button>
    </div>
  );
}

export function InviteFriendsDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const q = useInviteQuota();
  const [mode, setMode] = useState<"any" | "name">("any");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<AccessInvite | null>(null);
  const quota = q.data;
  const nameOk = mode === "any" || MC_NAME.test(name.trim());
  const canCreate = !!quota?.enabled && quota.remaining > 0 && nameOk;

  const create = async () => {
    setBusy(true);
    try {
      setCreated(await createInvite(mode === "name" ? name.trim() : undefined));
      setName("");
    } catch (e) {
      toast.error(inviteError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title={t("ainv.title")}
      description={t("ainv.lead")}
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            {t("common.close")}
          </Button>
          {!created && (
            <Button variant="primary" icon={<Ticket size={14} />} loading={busy} disabled={!canCreate} onClick={() => void create()}>
              {t("ainv.create")}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {q.isPending ? (
          <Skeleton className="h-16" />
        ) : q.isError ? (
          <p className="text-[13px] text-danger">{inviteError(q.error)}</p>
        ) : quota && !quota.enabled ? (
          <p className="rounded-card bg-surface px-3 py-3 text-[13px] text-muted">{t("ainv.err.disabled")}</p>
        ) : quota ? (
          <>
            <div className="flex items-center gap-4 rounded-card bg-surface px-4 py-3">
              <Users size={18} className="shrink-0 text-brand" />
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-semibold text-text">{t("ainv.quota", { left: quota.remaining, limit: quota.limit })}</div>
                <div className="mt-1.5 flex max-w-xs gap-1">
                  {Array.from({ length: Math.max(1, quota.limit) }, (_, i) => (
                    <span key={i} className={cn("h-1.5 flex-1 rounded-pill", i < quota.used ? "bg-brand" : "bg-surface3")} />
                  ))}
                </div>
              </div>
            </div>
            {created ? (
              <Created inv={created} onMore={() => setCreated(null)} />
            ) : quota.remaining > 0 ? (
              <div className="flex flex-col gap-3">
                <ChoiceGrid>
                  <ChoiceCard icon={<Link2 size={18} />} title={t("ainv.mode.any")} text={t("ainv.mode.any_text")} selected={mode === "any"} onClick={() => setMode("any")} />
                  <ChoiceCard icon={<UserRound size={18} />} title={t("ainv.mode.name")} text={t("ainv.mode.name_text")} selected={mode === "name"} onClick={() => setMode("name")} />
                </ChoiceGrid>
                {mode === "name" && (
                  <Field label={t("ainv.name")} hint={t("ainv.name_hint")} error={name && !nameOk ? t("ainv.name_bad") : undefined}>
                    <Input
                      value={name}
                      maxLength={16}
                      placeholder="Steve"
                      leading={<UserRound size={14} />}
                      onChange={(e) => setName(e.target.value.replace(/\s/g, ""))}
                      autoFocus
                    />
                  </Field>
                )}
              </div>
            ) : (
              <p className="rounded-card bg-surface px-3 py-3 text-[13px] text-muted">{t("ainv.none_left")}</p>
            )}
            {quota.invites.length > 0 && (
              <section className="flex flex-col gap-2">
                <h3 className="label">{t("ainv.list")}</h3>
                <ul className="divide-y divide-line rounded-card bg-surface">
                  {quota.invites.map((inv) => (
                    <InviteRow key={inv.id} inv={inv} />
                  ))}
                </ul>
              </section>
            )}
          </>
        ) : null}
      </div>
    </Dialog>
  );
}

export function InviteFriendsCard() {
  const t = useT();
  const q = useInviteQuota();
  const [open, setOpen] = useState(false);
  const quota = q.data;
  if (q.isError || (quota && (!quota.enabled || quota.limit === 0))) return null;
  return (
    <section className="rounded-card bg-surface px-4 py-3.5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-text">
          <Gift size={14} className="text-brand" />
          {t("ainv.card.title")}
        </h3>
        {quota && <Tag>{t("ainv.card.left", { n: quota.remaining })}</Tag>}
      </div>
      <p className="mt-1.5 text-[12px] leading-relaxed text-dim">{t("ainv.card.text")}</p>
      <Button size="sm" variant="subtle" className="mt-3 w-full" icon={<Ticket size={13} />} onClick={() => setOpen(true)} disabled={!quota}>
        {t("ainv.card.button")}
      </Button>
      {open && <InviteFriendsDialog onClose={() => setOpen(false)} />}
    </section>
  );
}
