import { create } from "zustand";
import type { HostSession, Invite } from "@/lib/vibe-sdk";

export type AcceptReq = { inviteId: string } | { invite: Invite } | { host: HostSession };

export interface DialogState {
  inviteFriends: { userIds?: string[]; chatId?: string; serverId?: string } | null;
  accept: AcceptReq | null;
  share: { instanceId: string } | null;
  pack: { code: string } | null;
  newGroup: boolean;
  addMembers: string | null;
  rename: { chatId: string; name: string } | null;
  report: { chatId: string; messageIds: string[] } | null;
}

export const useSocialDialogs = create<DialogState>(() => ({ inviteFriends: null, accept: null, share: null, pack: null, newGroup: false, addMembers: null, rename: null, report: null }));

export const openInviteFriends = (o: DialogState["inviteFriends"]) => useSocialDialogs.setState({ inviteFriends: o ?? {} });
export const openInviteAccept = (o: AcceptReq) => useSocialDialogs.setState({ accept: o });
export const openShare = (instanceId: string) => useSocialDialogs.setState({ share: { instanceId } });
export const openPackImport = (code: string) => useSocialDialogs.setState({ pack: { code: code.trim().toUpperCase() } });
export const openNewGroup = () => useSocialDialogs.setState({ newGroup: true });
export const openAddMembers = (chatId: string) => useSocialDialogs.setState({ addMembers: chatId });
export const openRenameGroup = (chatId: string, name: string) => useSocialDialogs.setState({ rename: { chatId, name } });
export const openChatReport = (chatId: string, messageIds: string[] = []) => useSocialDialogs.setState({ report: { chatId, messageIds } });
