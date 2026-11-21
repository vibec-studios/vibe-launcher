import { useNavigate } from "@tanstack/react-router";
import { Copy, FileDown, Link2, Pencil, Share2, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { InstanceBadge } from "@/components/content/InstanceBadge";
import { DropdownItem, DropdownLabel, DropdownMenu, DropdownSeparator, confirm, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { loaderNames } from "@/lib/format";
import { useInstances } from "@/lib/queries";
import { invalidateSets, setsApi, type ModSetInfo } from "../api";
import { copyText, openApplySets } from "../shared";

// ------------------------------------------------------------------ Anwenden-Menü (Instanz wählen)

export function ApplyMenu({ setIds, trigger }: { setIds: string[]; trigger: ReactNode }) {
  const t = useT();
  const instances = useInstances().data ?? [];
  const sorted = [...instances].sort((a, b) => (b.last_played ?? 0) - (a.last_played ?? 0));
  return (
    <DropdownMenu trigger={trigger}>
      <DropdownLabel>{t("sets.apply_pick")}</DropdownLabel>
      <div className="scroll max-h-[340px]">
        {sorted.map((i) => (
          <DropdownItem key={i.id} icon={<InstanceBadge instance={i} size={18} />} shortcut={`${i.mc_version} · ${loaderNames[i.loader.kind]}`} onSelect={() => openApplySets(i.id, setIds)}>
            <span className="max-w-[200px] truncate">{i.name}</span>
          </DropdownItem>
        ))}
      </div>
    </DropdownMenu>
  );
}

export function SetMenuItems({ set, onDeleted }: { set: ModSetInfo; onDeleted?: () => void }) {
  const t = useT();
  const nav = useNavigate();
  const del = async () => {
    if (!(await confirm({ title: t("sets.delete_confirm", { name: set.name }), text: t("sets.delete_text"), danger: true, confirmLabel: t("sets.delete") }))) return;
    try {
      await setsApi.remove(set.id);
      await invalidateSets();
      toast.success(t("sets.deleted", { name: set.name }));
      onDeleted?.();
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <>
      <DropdownItem icon={<Pencil size={14} />} onSelect={() => nav({ to: "/modsets", search: { set: set.id } })}>
        {t("sets.edit")}
      </DropdownItem>
      <DropdownItem
        icon={<Copy size={14} />}
        onSelect={async () => {
          try {
            const s = await setsApi.duplicate(set.id);
            await invalidateSets();
            toast.success(t("sets.duplicated"));
            nav({ to: "/modsets", search: { set: s.id } });
          } catch (e) {
            toast.error(e);
          }
        }}
      >
        {t("sets.duplicate")}
      </DropdownItem>
      <ShareItems set={set} />
      <DropdownSeparator />
      <DropdownItem icon={<Trash2 size={14} />} danger onSelect={() => void del()}>
        {t("sets.delete")}
      </DropdownItem>
    </>
  );
}

export function ShareItems({ set }: { set: ModSetInfo }) {
  const t = useT();
  return (
    <>
      <DropdownSeparator />
      <DropdownLabel>{t("sets.share")}</DropdownLabel>
      <DropdownItem
        icon={<Share2 size={14} />}
        disabled={!set.entries.length}
        onSelect={async () => {
          try {
            await copyText(await setsApi.exportCode(set.id));
            toast.success(t("sets.share.code_copied"));
          } catch (e) {
            toast.error(e);
          }
        }}
      >
        {t("sets.share.code")}
      </DropdownItem>
      <DropdownItem
        icon={<FileDown size={14} />}
        disabled={!set.entries.length}
        onSelect={async () => {
          try {
            const { save } = await import("@tauri-apps/plugin-dialog");
            const path = await save({ defaultPath: `${set.name.replace(/[\\/:*?"<>|]+/g, "_")}.vibeset.json`, filters: [{ name: t("import.file_filter"), extensions: ["json"] }] });
            if (!path) return;
            await setsApi.exportFile(set.id, path);
            toast.success(t("sets.share.file_saved"));
          } catch (e) {
            toast.error(e);
          }
        }}
      >
        {t("sets.share.file")}
      </DropdownItem>
      <DropdownItem
        icon={<Link2 size={14} />}
        disabled={!set.entries.length}
        onSelect={async () => {
          try {
            await copyText(await setsApi.exportLinks(set.id));
            toast.success(t("sets.share.links_copied"));
          } catch (e) {
            toast.error(e);
          }
        }}
      >
        {t("sets.share.links")}
      </DropdownItem>
    </>
  );
}
