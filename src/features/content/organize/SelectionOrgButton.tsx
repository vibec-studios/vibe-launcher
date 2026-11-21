import { FolderPlus } from "lucide-react";
import { DropdownMenu } from "@/components/ui";
import { useT } from "@/i18n";
import type { ContentItem } from "@/lib/types";
import { OrgMenuItems } from "./OrgMenuItems";

export function SelectionOrgButton({ instanceId, items }: { instanceId: string; items: ContentItem[] }) {
  const t = useT();
  return (
    <DropdownMenu
      align="center"
      side="top"
      trigger={
        <button className="flex h-8 items-center gap-1.5 rounded-ctl px-2.5 text-[13px] font-medium text-text transition-colors duration-100 hover:bg-white/[.07] data-[state=open]:bg-white/[.07]">
          <FolderPlus size={14} />
          {t("org.menu.organize")}
        </button>
      }
    >
      <OrgMenuItems instanceId={instanceId} items={items} menu="dropdown" />
    </DropdownMenu>
  );
}
