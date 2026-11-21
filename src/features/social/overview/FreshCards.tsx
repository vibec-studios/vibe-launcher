import { Check, Mail, Play, X } from "lucide-react";
import { useState } from "react";
import { Button, IconButton, Spinner, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { formatRelative } from "@/lib/format";
import type { FriendRequest, Invite } from "@/lib/vibe-sdk";
import { Avatar } from "../FriendsList";
import { loaderName } from "../presence";
import { openInviteAccept } from "../dialogStore";
import { errText, refreshRequests, removeInviteLocal, requireClient } from "../service";

// ------------------------------------------------------------------ Anfragen + Einladungen

export function RequestCard({ r }: { r: FriendRequest }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await refreshRequests();
    } catch (e) {
      toast.error(errText(e));
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-3 rounded-card bg-surface px-3.5 py-3 animate-fade-in">
      <Avatar user={r.from} size={36} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-semibold text-text">{r.from.name}</div>
        <div className="truncate text-[12px] text-dim">
          {t("social.req.incoming")} · {formatRelative(r.createdAt)}
        </div>
      </div>
      {busy ? (
        <Spinner size={13} className="mx-2" />
      ) : (
        <>
          <Button size="sm" variant="primary" icon={<Check size={13} />} onClick={() => void act(() => requireClient().friends.accept(r.id))}>
            {t("social.req.accept")}
          </Button>
          <IconButton label={t("social.req.decline")} tip size="sm" variant="ghost" onClick={() => void act(() => requireClient().friends.decline(r.id))}>
            <X size={15} />
          </IconButton>
        </>
      )}
    </div>
  );
}

export function InviteCard({ inv }: { inv: Invite }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const decline = async () => {
    setBusy(true);
    try {
      await requireClient().invites.decline(inv.id);
      removeInviteLocal(inv.id);
    } catch (e) {
      toast.error(errText(e));
      setBusy(false);
    }
  };
  const meta = [inv.target.mcVersion, inv.target.loader && inv.target.loader !== "vanilla" ? loaderName(inv.target.loader) : null].filter(Boolean).join(" · ");
  return (
    <div className="flex items-center gap-3 rounded-card bg-surface px-3.5 py-3 animate-fade-in">
      <span className="relative">
        <Avatar user={inv.from} size={36} />
        <span className="absolute -bottom-1 -right-1 grid h-4 w-4 place-items-center rounded-dot bg-brand text-[var(--ui-on-accent)] ring-2 ring-[var(--surface-1)]">
          <Mail size={9} strokeWidth={2.6} />
        </span>
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] text-text">
          <b className="font-semibold">{inv.from.name}</b> <span className="text-muted">{t("social.invite.lead")}</span> <b className="font-semibold">{inv.target.name}</b>
        </div>
        <div className="truncate text-[12px] text-dim">
          {meta || t(`social.invite.kind.${inv.kind}`)}
          {inv.message ? ` · „${inv.message}“` : ""}
        </div>
      </div>
      {busy ? (
        <Spinner size={13} className="mx-2" />
      ) : (
        <>
          <Button size="sm" variant="primary" icon={<Play size={13} />} onClick={() => openInviteAccept({ invite: inv })}>
            {t("social.accept.join")}
          </Button>
          <IconButton label={t("social.invite.decline")} tip size="sm" variant="ghost" onClick={() => void decline()}>
            <X size={15} />
          </IconButton>
        </>
      )}
    </div>
  );
}
