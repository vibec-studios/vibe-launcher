import { useMemo, useState } from "react";
import { Copy, ImageOff, MessageSquare, MoreHorizontal, Trash2 } from "lucide-react";
import { Button, Dialog, DropdownItem, DropdownMenu, EmptyState, ErrorState, IconButton, Skeleton, confirm, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { formatBytes, formatRelative } from "@/lib/format";
import type { Screenshot, ScreenshotVisibility } from "@/lib/vibe-sdk";
import { ShotThumb } from "@/features/screenshots/shots";
import { deleteShot, setVisibility, useCloudShots, useUploaded, useVibeImage } from "./api";
import { QuotaBar, VisBadge, VisibilitySelect } from "./parts";
import { ChatShareDialog } from "./ChatShareDialog";
import { copyShareLink, shotErr } from "./ShareShotDialog";

function RemoteThumb({ path }: { path: string }) {
  const q = useVibeImage(path);
  if (q.isError)
    return (
      <div className="absolute inset-0 grid place-items-center bg-surface2 text-dim">
        <ImageOff size={18} />
      </div>
    );
  if (!q.data) return <div className="skeleton absolute inset-0" />;
  return <img src={q.data} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover" />;
}

function CloudTile({ s, local, onChat }: { s: Screenshot; local: string | undefined; onChat: (s: Screenshot) => void }) {
  const t = useT();
  const change = (v: ScreenshotVisibility) => setVisibility(s.id, v).catch((e) => toast.error(shotErr(e)));
  const remove = async () => {
    const ok = await confirm({ title: t("shotshare.delete.title"), text: t("shotshare.delete.text"), confirmLabel: t("common.delete"), danger: true });
    if (ok) deleteShot(s.id).then(() => toast.success(t("shotshare.deleted")), (e) => toast.error(shotErr(e)));
  };
  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-card bg-surface">
      <div className="relative aspect-video">
        {local ? <ShotThumb path={local} className="absolute inset-0" /> : <RemoteThumb path={s.imagePath} />}
        <span className="absolute left-2 top-2">
          <VisBadge v={s.visibility} />
        </span>
      </div>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <VisibilitySelect value={s.visibility} onChange={change} />
          <p className="mt-1.5 truncate text-[11.5px] text-dim">
            {formatRelative(s.createdAt)} · {formatBytes(s.size)}
          </p>
        </div>
        <DropdownMenu
          align="end"
          trigger={
            <IconButton label={t("shotshare.more")} variant="ghost" size="sm">
              <MoreHorizontal size={15} />
            </IconButton>
          }
        >
          {s.visibility === "link" && (
            <DropdownItem icon={<Copy size={14} />} onSelect={() => void copyShareLink(s)}>
              {t("shotshare.copy_link")}
            </DropdownItem>
          )}
          <DropdownItem icon={<MessageSquare size={14} />} onSelect={() => onChat(s)}>
            {t("shotshare.to_chat")}
          </DropdownItem>
          <DropdownItem icon={<Trash2 size={14} />} danger onSelect={() => void remove()}>
            {t("shotshare.delete")}
          </DropdownItem>
        </DropdownMenu>
      </div>
    </div>
  );
}

export function CloudShotsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const q = useCloudShots(open);
  const byPath = useUploaded((s) => s.byPath);
  const local = useMemo(() => new Map(Object.entries(byPath).map(([p, id]) => [id, p])), [byPath]);
  const [chat, setChat] = useState<Screenshot | null>(null);
  const shots = q.data?.screenshots ?? [];
  return (
    <>
      <Dialog
        open={open && !chat}
        onOpenChange={(o) => !o && onClose()}
        size="xl"
        title={t("shotshare.cloud.title")}
        description={t("shotshare.cloud.desc")}
        footer={<Button onClick={onClose}>{t("common.close")}</Button>}
      >
        <div className="flex flex-col gap-4 pb-2">
          <div className="rounded-card bg-surface px-4 py-3.5">
            {q.data ? <QuotaBar list={q.data} /> : <Skeleton className="h-10 w-full" />}
          </div>
          {q.isError && !q.data ? (
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          ) : !q.data ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
              {Array.from({ length: 6 }, (_, n) => (
                <Skeleton key={n} className="aspect-video rounded-card" />
              ))}
            </div>
          ) : shots.length === 0 ? (
            <EmptyState icon="cloud" title={t("shotshare.cloud.empty")} text={t("shotshare.cloud.empty_text")} />
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
              {shots.map((s) => (
                <CloudTile key={s.id} s={s} local={local.get(s.id)} onChat={setChat} />
              ))}
            </div>
          )}
        </div>
      </Dialog>
      <ChatShareDialog shot={chat} onClose={() => setChat(null)} />
    </>
  );
}
