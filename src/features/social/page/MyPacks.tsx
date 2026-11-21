import { useQuery } from "@tanstack/react-query";
import { copyText as writeText } from "@/components/content/util";
import { Copy, MoreHorizontal, Trash2 } from "lucide-react";
import { ContextItem, ContextMenu, ContextSeparator, DropdownItem, DropdownMenu, DropdownSeparator, IconButton, Skeleton, confirm, toast } from "@/components/ui";
import { useT } from "@/i18n";
import type { Pack } from "@/lib/vibe-sdk";
import { PackIcon } from "../dialogs";
import { errText, requireClient, vqk } from "../service";

export function MyPacks() {
  const t = useT();
  const q = useQuery({
    queryKey: vqk.packsMine,
    queryFn: () => requireClient().packs.mine(),
    staleTime: 60_000,
  });
  if (q.isLoading) return <Skeleton className="h-12" />;
  if (q.isError) return <p className="text-[12px] text-danger">{errText(q.error)}</p>;
  if (!q.data?.length) return <p className="rounded-card bg-surface px-4 py-4 text-center text-[12.5px] text-dim">{t("social.pack.none_short")}</p>;
  return (
    <div className="rounded-card bg-surface">
      {q.data.map((p) => (
        <PackRow key={p.id} pack={p} onDeleted={() => q.refetch()} />
      ))}
    </div>
  );
}

/** Eigenes Pack: sichtbar „Link kopieren“, Löschen im ⋯-Menü und per Rechtsklick. */
function PackRow({ pack: p, onDeleted }: { pack: Pack; onDeleted: () => void }) {
  const t = useT();
  const copy = () => void writeText(p.url).then(() => toast.success(t("social.copied"), p.url));
  const remove = async () => {
    if (!(await confirm({ title: t("social.pack.delete_q", { name: p.name }), confirmLabel: t("social.pack.delete"), danger: true }))) return;
    try {
      await requireClient().packs.delete(p.code);
      onDeleted();
    } catch (e) {
      toast.error(errText(e));
    }
  };
  return (
    <ContextMenu
      content={
        <>
          <ContextItem icon={<Copy size={14} />} onSelect={copy}>
            {t("social.share.copy_link")}
          </ContextItem>
          <ContextSeparator />
          <ContextItem icon={<Trash2 size={14} />} danger onSelect={() => void remove()}>
            {t("social.pack.delete")}
          </ContextItem>
        </>
      }
    >
      <div className="flex items-center gap-3 border-line px-3 py-2 data-[state=open]:bg-white/[.04] [&+&]:border-t">
        <PackIcon pack={p} size={32} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold leading-tight text-text">{p.name}</div>
          <div className="truncate text-caption text-dim">
            <span className="font-mono">{p.code}</span> · {t(`social.share.vis.${p.visibility}`)} · {t("social.pack.downloads", { n: p.downloads })}
          </div>
        </div>
        <IconButton label={t("social.share.copy_link")} tip variant="ghost" size="sm" onClick={copy}>
          <Copy size={14} />
        </IconButton>
        <DropdownMenu
          align="end"
          trigger={
            <IconButton label={t("social.chat.more")} variant="ghost" size="sm">
              <MoreHorizontal size={15} />
            </IconButton>
          }
        >
          <DropdownItem icon={<Copy size={14} />} onSelect={copy}>
            {t("social.share.copy_link")}
          </DropdownItem>
          <DropdownSeparator />
          <DropdownItem icon={<Trash2 size={14} />} danger onSelect={() => void remove()}>
            {t("social.pack.delete")}
          </DropdownItem>
        </DropdownMenu>
      </div>
    </ContextMenu>
  );
}
