import { Dialog } from "@/components/ui";
import { useT } from "@/i18n";
import { AddFriendSearch, BlockedList } from "../FriendsList";
import { closePageDialog as close } from "./store";

// ------------------------------------------------------------------ Dialoge

export function AddFriendDialog() {
  const t = useT();
  return (
    <Dialog open onOpenChange={(o) => !o && close()} title={t("social.action.add")} description={t("social.add.desc")} size="sm">
      <AddFriendSearch />
    </Dialog>
  );
}

export function BlockedDialog() {
  const t = useT();
  return (
    <Dialog open onOpenChange={(o) => !o && close()} title={t("social.blocked.title")} description={t("social.blocked.desc")} size="sm">
      <BlockedList />
    </Dialog>
  );
}
