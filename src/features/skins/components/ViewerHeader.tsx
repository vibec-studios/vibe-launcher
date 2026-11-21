import { FileUp, MoreHorizontal, Paintbrush, RotateCcw, Save } from "lucide-react";
import { DropdownItem, DropdownMenu, DropdownSeparator, IconButton, Segmented, Spinner } from "@/components/ui";
import { useT } from "@/i18n";
import type { SkinsPageState } from "../hooks/useSkinsPage";

export function ViewerHeader({ c }: { c: SkinsPageState }) {
  const t = useT();
  const { preview, account, viewerVariant, changeVariant, canEdit, uploadFile, busy, profile, saveCurrent, openEditor, resetSkin } = c;
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 pl-4 pr-2">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-semibold text-text">
          {preview?.skin ? t("skins.preview_of", { name: preview.skin.name }) : preview ? t("skins.preview") : (account?.username ?? t("skins.preview"))}
        </div>
        <div className="truncate text-caption text-dim">{preview ? t("skins.preview") : account ? t("skins.current") : t("skins.no_account_title")}</div>
      </div>
      <Segmented
        value={viewerVariant}
        onChange={changeVariant}
        items={[
          { value: "classic", label: t("skins.classic"), disabled: !preview?.skin && !canEdit },
          { value: "slim", label: t("skins.slim"), disabled: !preview?.skin && !canEdit },
        ]}
      />
      {account && (
        <>
          <IconButton label={t("skins.upload")} tip variant="ghost" size="sm" onClick={() => void uploadFile()} disabled={!canEdit}>
            {busy === "upload" ? <Spinner size={13} /> : <FileUp size={15} />}
          </IconButton>
          <DropdownMenu
            trigger={
              <IconButton label={t("common.more")} tip variant="ghost" size="sm">
                <MoreHorizontal size={16} />
              </IconButton>
            }
          >
            <DropdownItem icon={<FileUp size={14} />} disabled={!canEdit} onSelect={() => void uploadFile()}>
              {t("skins.upload")}
            </DropdownItem>
            <DropdownItem icon={<Save size={14} />} disabled={!profile?.skin || !!busy} onSelect={() => void saveCurrent()}>
              {t("skins.save_current")}
            </DropdownItem>
            <DropdownItem
              icon={<Paintbrush size={14} />}
              disabled={!profile?.skin?.data_url}
              onSelect={() => openEditor({ dataUrl: profile!.skin!.data_url!, name: account.username, variant: profile!.skin!.variant })}
            >
              {t("skined.edit_current")}
            </DropdownItem>
            <DropdownSeparator />
            <DropdownItem icon={<RotateCcw size={14} />} danger disabled={!canEdit} onSelect={() => void resetSkin()}>
              {t("skins.reset")}
            </DropdownItem>
          </DropdownMenu>
        </>
      )}
    </div>
  );
}
