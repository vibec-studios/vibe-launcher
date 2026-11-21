import { Check, MoreHorizontal, X } from "lucide-react";
import { useState } from "react";
import { Button, ContextItem, ContextMenu, ContextSeparator, DropdownItem, DropdownMenu, DropdownSeparator, IconButton, Spinner, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { loaderNames } from "@/lib/format";
import type { LoaderKind } from "@/lib/types";
import type { Invite } from "@/lib/vibe-sdk";
import { Avatar } from "../FriendsList";
import { openInviteAccept } from "../dialogStore";
import { errText, removeInviteLocal, requireClient } from "../service";

/** Einladung im Postfach: sichtbar „Annehmen“ (öffnet den Annehmen-Dialog), Ablehnen im ⋯-Menü und per Rechtsklick. */
export function InviteRow({ inv }: { inv: Invite }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const accept = () => openInviteAccept({ invite: inv });
  const decline = async () => {
    setBusy(true);
    try {
      await requireClient().invites.decline(inv.id);
      removeInviteLocal(inv.id);
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ContextMenu
      content={
        <>
          <ContextItem icon={<Check size={14} />} onSelect={accept}>
            {t("social.invite.accept")}
          </ContextItem>
          <ContextSeparator />
          <ContextItem icon={<X size={14} />} onSelect={() => void decline()}>
            {t("social.invite.decline")}
          </ContextItem>
        </>
      }
    >
      <div className="mx-1.5 flex items-start gap-2.5 rounded-ctl px-2 py-2 transition-colors duration-100 hover:bg-white/[.04] data-[state=open]:bg-white/[.04]">
        <Avatar user={inv.from} size={28} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold leading-tight text-text">{inv.target.name}</div>
          <div className="truncate text-caption text-dim">
            {t("social.accept.from", { name: inv.from.name })}
            {inv.target.mcVersion ? ` · ${inv.target.mcVersion}` : ""}
            {inv.target.loader ? ` ${loaderNames[inv.target.loader as LoaderKind] ?? inv.target.loader}` : ""}
          </div>
          {inv.message && <div className="mt-1 truncate text-[12px] italic text-muted">„{inv.message}“</div>}
        </div>
        {busy ? (
          <span className="grid h-8 w-8 place-items-center">
            <Spinner size={12} />
          </span>
        ) : (
          <Button size="sm" variant="ghost" onClick={accept}>
            {t("social.invite.accept")}
          </Button>
        )}
        <DropdownMenu
          align="end"
          trigger={
            <IconButton label={t("social.chat.more")} variant="ghost" size="sm" disabled={busy}>
              <MoreHorizontal size={15} />
            </IconButton>
          }
        >
          <DropdownItem icon={<Check size={14} />} onSelect={accept}>
            {t("social.invite.accept")}
          </DropdownItem>
          <DropdownSeparator />
          <DropdownItem icon={<X size={14} />} onSelect={() => void decline()}>
            {t("social.invite.decline")}
          </DropdownItem>
        </DropdownMenu>
      </div>
    </ContextMenu>
  );
}
