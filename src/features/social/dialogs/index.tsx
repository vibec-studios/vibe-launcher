// Dialoge der Vibe-Dienste (global eingebunden über <SocialDialogs/>):
// Freunde einladen (gehosteter Server), Einladung annehmen (Instanz finden/installieren + direkt joinen),
// Instanz als Pack teilen, Pack per Code importieren, Gruppen anlegen/umbenennen/Mitglieder hinzufügen.
import { useSocialDialogs, type DialogState } from "../dialogStore";
import { AcceptDialog } from "./AcceptDialog";
import { GroupDialog } from "./GroupDialog";
import { InviteFriendsDialog } from "./InviteFriendsDialog";
import { PackImportDialog } from "./PackImportDialog";
import { RenameDialog } from "./RenameDialog";
import { ShareDialog } from "./ShareDialog";
import { ReportChatDialog } from "@/features/tickets/components/ReportChatDialog";

export { PackIcon } from "./PackIcon";
export { PackImportDialog } from "./PackImportDialog";

export function SocialDialogs() {
  const d = useSocialDialogs();
  const close = (k: keyof DialogState) => () => useSocialDialogs.setState({ [k]: k === "newGroup" ? false : null } as Partial<DialogState>);
  return (
    <>
      {d.inviteFriends && <InviteFriendsDialog init={d.inviteFriends} onClose={close("inviteFriends")} />}
      {d.accept && <AcceptDialog req={d.accept} onClose={close("accept")} />}
      {d.share && <ShareDialog instanceId={d.share.instanceId} onClose={close("share")} />}
      {d.pack && <PackImportDialog code={d.pack.code} onClose={close("pack")} />}
      {d.newGroup && <GroupDialog onClose={close("newGroup")} />}
      {d.addMembers && <GroupDialog chatId={d.addMembers} onClose={close("addMembers")} />}
      {d.rename && <RenameDialog {...d.rename} onClose={close("rename")} />}
      {d.report && <ReportChatDialog {...d.report} onClose={close("report")} />}
    </>
  );
}
