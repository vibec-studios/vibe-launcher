import { Ban, Check, Ellipsis, X } from "lucide-react";
import { useState } from "react";
import { ContextMenu, DropdownMenu, IconButton, Spinner, toast } from "@/components/ui";
import { useT } from "@/i18n";
import type { FriendRequest } from "@/lib/vibe-sdk";
import { errText, refreshRequests, requireClient } from "../service";
import { ActionItems, blockUser, type FriendAction } from "./actions";
import { Avatar } from "./Avatar";

// ------------------------------------------------------------------ Anfragen

/** Anfrage: sichtbar nur „Annehmen“ (eingehend) bzw. „Zurückziehen“ (ausgehend); Ablehnen und Blockieren im ⋯-Menü
 *  und per Rechtsklick. */
export function RequestRow({ r }: { r: FriendRequest }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const user = r.direction === "incoming" ? r.from : r.to;
  const incoming = r.direction === "incoming";
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await refreshRequests();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const accept = () => void act(() => requireClient().friends.accept(r.id));
  const cancel = () => void act(() => requireClient().friends.cancel(r.id));
  const actions: FriendAction[] = [
    ...(incoming
      ? [
          { key: "accept", icon: <Check size={14} />, label: t("social.req.accept"), onSelect: accept },
          { key: "decline", icon: <X size={14} />, label: t("social.req.decline"), onSelect: () => void act(() => requireClient().friends.decline(r.id)) },
        ]
      : [{ key: "cancel", icon: <X size={14} />, label: t("social.req.cancel"), onSelect: cancel }]),
    { key: "block", sep: true, danger: true, icon: <Ban size={14} />, label: t("social.friend.block"), onSelect: () => void blockUser(user) },
  ];
  return (
    <ContextMenu content={<ActionItems actions={actions} kind="context" />}>
      <div className="mx-1.5 flex h-11 items-center gap-1.5 rounded-ctl pl-2 transition-colors duration-100 hover:bg-white/[.04] data-[state=open]:bg-white/[.04]">
        <Avatar user={user} size={26} />
        <span className="ml-1 min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold leading-tight text-text">{user.name}</span>
          <span className="block truncate text-caption text-dim">{incoming ? t("social.req.incoming") : t("social.req.outgoing")}</span>
        </span>
        {busy ? (
          <span className="grid h-8 w-8 place-items-center">
            <Spinner size={12} />
          </span>
        ) : incoming ? (
          <IconButton label={t("social.req.accept")} tip variant="ghost" size="sm" onClick={accept}>
            <Check size={15} className="text-ok" />
          </IconButton>
        ) : (
          <IconButton label={t("social.req.cancel")} tip variant="ghost" size="sm" onClick={cancel}>
            <X size={15} />
          </IconButton>
        )}
        <DropdownMenu
          align="end"
          trigger={
            <IconButton label={t("social.chat.more")} variant="ghost" size="sm" disabled={busy}>
              <Ellipsis size={15} />
            </IconButton>
          }
        >
          <ActionItems actions={actions} kind="dropdown" />
        </DropdownMenu>
      </div>
    </ContextMenu>
  );
}
