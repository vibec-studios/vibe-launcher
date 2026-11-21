import type { ContentItem } from "@/lib/types";
import { CleanupDialog } from "./CleanupDialog";
import { settleRemove, useOrgDialog } from "./dialogs";
import { GroupDialog } from "./GroupDialog";
import { RemoveDialog } from "./RemoveDialog";
import { TagsDialog } from "./TagsDialog";

export function OrgDialogsHost({ instanceId, items }: { instanceId: string; items: ContentItem[] }) {
  const dialog = useOrgDialog((s) => s.dialog);
  const close = useOrgDialog((s) => s.close);
  if (!dialog) return null;
  switch (dialog.type) {
    case "group":
      return <GroupDialog instanceId={instanceId} group={dialog.group} targets={dialog.targets} onClose={close} />;
    case "tags":
      return <TagsDialog instanceId={instanceId} targets={dialog.targets} names={dialog.names} onClose={close} />;
    case "cleanup":
      return <CleanupDialog instanceId={instanceId} items={items} onClose={close} />;
    case "remove":
      return <RemoveDialog title={dialog.title} text={dialog.text} extras={dialog.extras} items={items} onDone={settleRemove} />;
  }
}
