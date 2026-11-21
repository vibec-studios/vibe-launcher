// Aktionen der Freunde-Seite: Werkzeugleiste der Übersicht (Teilen, Importieren, ⋯, „Freund hinzufügen“),
// Postfach (Anfragen + Einladungen als Popover) und die Popups „Freund hinzufügen“, „Modpack teilen“,
// „Modpack per Code/Link importieren“ und „Blockierte Nutzer“.
import { MoreHorizontal, PackageOpen, Settings as SettingsIcon, Share2, ShieldOff, UserPlus } from "lucide-react";
import { Button, DropdownItem, DropdownMenu, IconButton } from "@/components/ui";
import { useT } from "@/i18n";
import { useVibe } from "@/lib/vibe";
import { openSettings } from "@/features/settings/store";
import { AddFriendDialog, BlockedDialog } from "./page/FriendDialogs";
import { ImportPackDialog } from "./page/ImportPackDialog";
import { SharePackDialog } from "./page/SharePackDialog";
import { openPageDialog, usePageDialog } from "./page/store";

export { openPageDialog } from "./page/store";
export { InboxButton } from "./page/InboxButton";
export { parsePackCode } from "./page/utils";

/** Rechte Seite der Werkzeugleiste: selten Gebrauchtes als Symbol bzw. im ⋯-Menü, „Freund hinzufügen“ als Hauptaktion. */
export function SocialActions({ showAdd = true }: { showAdd?: boolean }) {
  const t = useT();
  const vibe = useVibe();
  return (
    <div className="flex items-center gap-2">
      {vibe.sharing && (
        <>
          <IconButton label={t("social.action.share")} tip variant="ghost" onClick={() => openPageDialog("share")}>
            <Share2 size={15} />
          </IconButton>
          <IconButton label={t("social.action.import")} tip variant="ghost" onClick={() => openPageDialog("import")}>
            <PackageOpen size={15} />
          </IconButton>
        </>
      )}
      <DropdownMenu
        align="end"
        trigger={
          <IconButton label={t("social.chat.more")} tip variant="ghost">
            <MoreHorizontal size={16} />
          </IconButton>
        }
      >
        <DropdownItem icon={<ShieldOff size={14} />} onSelect={() => openPageDialog("blocked")}>
          {t("social.blocked.title")}
        </DropdownItem>
        <DropdownItem icon={<SettingsIcon size={14} />} onSelect={() => openSettings("vibe")}>
          {t("social.action.settings")}
        </DropdownItem>
      </DropdownMenu>
      {showAdd && (
        <Button variant="primary" icon={<UserPlus size={16} />} onClick={() => openPageDialog("add")}>
          {t("social.action.add")}
        </Button>
      )}
    </div>
  );
}

/** Einmal auf der Seite eingebunden (unabhängig davon, ob Übersicht oder Chat offen ist). */
export function PageDialogs() {
  const open = usePageDialog((s) => s.open);
  if (open === "add") return <AddFriendDialog />;
  if (open === "share") return <SharePackDialog />;
  if (open === "import") return <ImportPackDialog />;
  if (open === "blocked") return <BlockedDialog />;
  return null;
}
