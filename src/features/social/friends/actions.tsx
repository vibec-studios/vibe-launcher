import { copyText as writeText } from "@/components/content/util";
import { Ban, Clipboard, MessageSquare, Play, Send, UserMinus } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { ContextItem, ContextSeparator, DropdownItem, DropdownSeparator, confirm, toast } from "@/components/ui";
import { t as tr } from "@/i18n";
import type { Friend, HostSession, PublicUser } from "@/lib/vibe-sdk";
import { errText, openDm, openSocial, removeFriendLocal, requireClient } from "../service";
import { openInviteAccept, openInviteFriends } from "../dialogStore";

export async function startDm(userId: string) {
  try {
    const c = await openDm(userId);
    openSocial(c.id);
  } catch (e) {
    toast.error(errText(e));
  }
}

// ------------------------------------------------------------------ Aktionen je Freund (Kontext- und Dropdown-Menü)

export interface FriendAction {
  key: string;
  icon: ReactNode;
  label: string;
  danger?: boolean;
  sep?: boolean;
  onSelect: () => void;
}

export function friendActions(friend: Friend, host?: HostSession): FriendAction[] {
  const t = tr;
  const u = friend.user;
  return [
    ...(host ? [{ key: "join", icon: <Play size={14} />, label: t("social.accept.join"), onSelect: () => openInviteAccept({ host }) }] : []),
    { key: "msg", icon: <MessageSquare size={14} />, label: t("social.friend.message"), onSelect: () => void startDm(u.id) },
    { key: "invite", icon: <Send size={14} />, label: t("social.friend.invite"), onSelect: () => openInviteFriends({ userIds: [u.id] }) },
    { key: "copy", icon: <Clipboard size={14} />, label: t("social.friend.copy_name"), onSelect: () => void writeText(u.name).then(() => toast.success(t("social.copied"))) },
    {
      key: "remove",
      sep: true,
      danger: true,
      icon: <UserMinus size={14} />,
      label: t("social.friend.remove"),
      onSelect: async () => {
        if (!(await confirm({ title: t("social.friend.remove_q", { name: u.name }), confirmLabel: t("social.friend.remove"), danger: true }))) return;
        try {
          await requireClient().friends.remove(u.id);
          removeFriendLocal(u.id);
        } catch (e) {
          toast.error(errText(e));
        }
      },
    },
    { key: "block", danger: true, icon: <Ban size={14} />, label: t("social.friend.block"), onSelect: () => void blockUser(u) },
  ];
}

/** Gleiche Einträge als Kontext- oder Dropdown-Menü. */
export function ActionItems({ actions, kind }: { actions: FriendAction[]; kind: "context" | "dropdown" }) {
  const Item = kind === "context" ? ContextItem : DropdownItem;
  const Sep = kind === "context" ? ContextSeparator : DropdownSeparator;
  return (
    <>
      {actions.map((a) => (
        <Fragment key={a.key}>
          {a.sep && <Sep />}
          <Item icon={a.icon} danger={a.danger} onSelect={a.onSelect}>
            {a.label}
          </Item>
        </Fragment>
      ))}
    </>
  );
}

export function FriendMenuItems({ friend, host }: { friend: Friend; host?: HostSession }) {
  return <ActionItems actions={friendActions(friend, host)} kind="context" />;
}

export async function blockUser(u: Pick<PublicUser, "id" | "name">) {
  const t = tr;
  if (!(await confirm({ title: t("social.friend.block_q", { name: u.name }), text: t("social.friend.block_text"), confirmLabel: t("social.friend.block"), danger: true }))) return;
  try {
    await requireClient().friends.block(u.id);
    removeFriendLocal(u.id);
    toast.success(t("social.friend.blocked", { name: u.name }));
  } catch (e) {
    toast.error(errText(e));
  }
}

export const isActive = (f: Friend) => f.presence.status !== "offline" && (f.presence.activity?.type === "playing" || f.presence.activity?.type === "hosting");
