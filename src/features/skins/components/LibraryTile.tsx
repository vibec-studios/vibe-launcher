import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { Check, Download, FolderOpen, Paintbrush, Pencil, Shirt, Trash2 } from "lucide-react";
import { memo, type ReactNode } from "react";
import { ContextItem, ContextMenu, ContextSeparator, Skeleton, cn, confirm, toast } from "@/components/ui";
import { useT, t as tt } from "@/i18n";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/queries";
import type { LibrarySkin, SkinVariant } from "@/lib/types";
import { useSkinFront } from "../render";
import { skq, sourceLabel } from "../library";

export const LibraryTile = memo(function LibraryTile({
  skin: s,
  selected,
  canApply,
  onPreview,
  onApply,
  onRename,
  onEdit,
}: {
  skin: LibrarySkin;
  selected: boolean;
  canApply: boolean;
  onPreview: () => void;
  onApply: () => void;
  onRename: () => void;
  onEdit: () => void;
}) {
  const t = useT();
  const img = useSkinFront(s.data_url, s.variant, 6);
  const src = sourceLabel(s.source);
  const exportSkin = async () => {
    const path = await saveDialog({ defaultPath: `${s.name}.png`, filters: [{ name: "PNG", extensions: ["png"] }] });
    if (!path) return;
    api
      .skinLibraryExport(s.id, path)
      .then(() => toast.success(tt("skins.exported")))
      .catch((e) => toast.error(e, tt("skins.error.library")));
  };
  const remove = async () => {
    const ok = await confirm({ title: tt("skins.delete_title", { name: s.name }), text: tt("skins.delete_text"), confirmLabel: tt("skins.delete"), danger: true });
    if (ok) api.skinLibraryRemove(s.id).then(() => queryClient.invalidateQueries({ queryKey: skq.library })).catch((e) => toast.error(e, tt("skins.error.library")));
  };
  const setVariant = (v: SkinVariant) =>
    api
      .skinLibrarySetVariant(s.id, v)
      .then(() => queryClient.invalidateQueries({ queryKey: skq.library }))
      .catch((e) => toast.error(e, tt("skins.error.library")));
  const menu: ReactNode = (
    <>
      <ContextItem icon={<Check size={14} />} disabled={!canApply} onSelect={onApply}>
        {t("skins.apply")}
      </ContextItem>
      <ContextItem icon={<Paintbrush size={14} />} onSelect={onEdit}>
        {t("skined.edit")}
      </ContextItem>
      <ContextItem icon={<Pencil size={14} />} onSelect={onRename}>
        {t("skins.rename")}
      </ContextItem>
      <ContextItem icon={<Shirt size={14} />} onSelect={() => void setVariant(s.variant === "slim" ? "classic" : "slim")}>
        {s.variant === "slim" ? t("skins.set_classic") : t("skins.set_slim")}
      </ContextItem>
      <ContextSeparator />
      <ContextItem icon={<Download size={14} />} onSelect={() => void exportSkin()}>
        {t("skins.export")}
      </ContextItem>
      <ContextItem icon={<FolderOpen size={14} />} onSelect={() => void api.skinLibraryReveal(s.id).catch((e) => toast.error(e))}>
        {t("skins.reveal")}
      </ContextItem>
      <ContextSeparator />
      <ContextItem icon={<Trash2 size={14} />} danger onSelect={() => void remove()}>
        {t("skins.delete")}
      </ContextItem>
    </>
  );
  return (
    <ContextMenu content={menu}>
      <button
        type="button"
        onClick={onPreview}
        onDoubleClick={() => canApply && onApply()}
        aria-pressed={selected}
        className={cn(
          "group flex flex-col items-stretch overflow-hidden rounded-card text-left transition-colors duration-150",
          selected ? "bg-surface3 outline outline-2 outline-accent" : "bg-surface hover:bg-surface2 data-[state=open]:bg-surface2",
        )}
      >
        <div className="grid h-[118px] place-items-center">
          {img ? (
            <img src={img} alt="" draggable={false} loading="lazy" decoding="async" className="h-[104px] w-[52px] [image-rendering:pixelated]" />
          ) : (
            <Skeleton className="h-[104px] w-[52px]" />
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-0.5 px-2 pb-2 pt-1">
          <span className="truncate text-[12.5px] font-semibold text-text" title={s.name}>
            {s.name}
          </span>
          {/* Modell und Herkunft je eine Zeile – sonst schneidet die schmale Kachel die Herkunft ab */}
          <span className="truncate text-[11.5px] text-muted">{s.variant === "slim" ? t("skins.slim") : t("skins.classic")}</span>
          {src && (
            <span className="truncate text-[11.5px] text-dim" title={src}>
              {src}
            </span>
          )}
        </div>
      </button>
    </ContextMenu>
  );
});
