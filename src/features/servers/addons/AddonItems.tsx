import { ArrowUpCircle, ExternalLink, FolderOpen, Trash2 } from "lucide-react";
import type { Server } from "@/lib/types";
import { ContextItem, ContextSeparator, DropdownItem, DropdownSeparator, type MenuItemProps } from "@/components/ui";
import { openExternal } from "@/components/content/util";
import { useT } from "@/i18n";
import { openServerFolder } from "../actions";
import type { Addon, AddonUpdate } from "../addonsApi";
import { folderOf, removeAddon, updateAddons } from "./addonActions";

export interface Kit {
  Item: (p: MenuItemProps) => React.ReactNode;
  Sep: () => React.ReactNode;
}
export const contextKit: Kit = { Item: ContextItem, Sep: ContextSeparator };
export const dropdownKit: Kit = { Item: DropdownItem, Sep: DropdownSeparator };

export function AddonItems({ server, addon, update, kit: { Item, Sep } }: { server: Server; addon: Addon; update?: AddonUpdate; kit: Kit }) {
  const t = useT();
  return (
    <>
      {update && (
        <Item icon={<ArrowUpCircle size={14} />} onSelect={() => updateAddons(server, [addon.file_name])}>
          {t("srv.addons.update_to", { v: update.latest })}
        </Item>
      )}
      {addon.page_url && (
        <Item icon={<ExternalLink size={14} />} onSelect={() => openExternal(addon.page_url!)}>
          {t("srv.addons.open_page")}
        </Item>
      )}
      <Item icon={<FolderOpen size={14} />} onSelect={() => openServerFolder(server, folderOf(server))}>
        {t("common.open_folder")}
      </Item>
      <Sep />
      <Item icon={<Trash2 size={14} />} danger onSelect={() => removeAddon(server, addon)}>
        {t("common.delete")}
      </Item>
    </>
  );
}
