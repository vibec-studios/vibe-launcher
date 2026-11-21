import { useState } from "react";
import { CloudUpload, Copy, MessageSquare, Trash2 } from "lucide-react";
import { Button, Dialog, Steps, confirm, toast } from "@/components/ui";
import { copyText } from "@/components/content/util";
import { useT, t as tt } from "@/i18n";
import type { Screenshot as LocalShot } from "@/lib/types";
import type { Screenshot, ScreenshotVisibility } from "@/lib/vibe-sdk";
import { VibeError } from "@/lib/vibe-sdk";
import { errText } from "@/features/social/service";
import { ShotThumb } from "@/features/screenshots/shots";
import { deleteShot, setVisibility, shareUrl, uploadShot, useCloudShots, useUploaded } from "./api";
import { QuotaBar, VisibilityCards, VisibilitySelect } from "./parts";
import { ChatShareDialog } from "./ChatShareDialog";

export function shotErr(e: unknown): string {
  const msg = errText(e);
  if (msg.startsWith("shot:")) return tt(`shotshare.err.${msg.slice(5)}`);
  if (e instanceof VibeError && e.code === "screenshot_quota") return tt("shotshare.err.quota");
  return msg;
}

export async function copyShareLink(s: Screenshot) {
  const url = shareUrl(s);
  if (!url) return;
  await copyText(url);
  toast.success(tt("shotshare.copied"));
}

export function ShareShotDialog({ shot, onClose }: { shot: LocalShot | null; onClose: () => void }) {
  const t = useT();
  const list = useCloudShots(!!shot);
  const known = useUploaded((s) => (shot ? s.byPath[shot.path] : undefined));
  const existing = known ? list.data?.screenshots.find((s) => s.id === known) : undefined;
  const [vis, setVis] = useState<ScreenshotVisibility>("friends");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Screenshot | null>(null);
  const [chat, setChat] = useState(false);
  const cloud = done ?? existing ?? null;

  const close = () => {
    setDone(null);
    setBusy(false);
    onClose();
  };

  const upload = async () => {
    if (!shot) return;
    setBusy(true);
    try {
      setDone(await uploadShot(shot.path, vis));
      toast.success(t("shotshare.uploaded"));
    } catch (e) {
      toast.error(shotErr(e), t("shotshare.upload_failed"));
    } finally {
      setBusy(false);
    }
  };

  const changeVis = async (v: ScreenshotVisibility) => {
    if (!cloud) return;
    try {
      setDone(await setVisibility(cloud.id, v));
    } catch (e) {
      toast.error(shotErr(e));
    }
  };

  const remove = async () => {
    if (!cloud) return;
    const ok = await confirm({ title: t("shotshare.delete.title"), text: t("shotshare.delete.text"), confirmLabel: t("common.delete"), danger: true });
    if (!ok) return;
    try {
      await deleteShot(cloud.id);
      toast.success(t("shotshare.deleted"));
      close();
    } catch (e) {
      toast.error(shotErr(e));
    }
  };

  const tooBig = !!(shot && list.data && shot.size > list.data.maxUploadBytes);
  const full = !!(shot && list.data && list.data.usedBytes + shot.size > list.data.quotaBytes);

  return (
    <>
      <Dialog
        open={!!shot && !chat}
        onOpenChange={(o) => !o && close()}
        size="lg"
        locked={busy}
        title={cloud ? t("shotshare.done.title") : t("shotshare.title")}
        description={cloud ? t("shotshare.done.desc") : t("shotshare.desc")}
        footer={
          cloud ? (
            <>
              <Button variant="danger" icon={<Trash2 size={14} />} onClick={remove} className="mr-auto">
                {t("shotshare.delete")}
              </Button>
              <Button onClick={close}>{t("common.close")}</Button>
            </>
          ) : (
            <>
              <Button onClick={close} disabled={busy}>
                {t("common.cancel")}
              </Button>
              <Button variant="primary" icon={<CloudUpload size={15} />} loading={busy} disabled={tooBig || full || !list.data} onClick={upload}>
                {t("shotshare.upload")}
              </Button>
            </>
          )
        }
      >
        {shot && (
          <div className="flex flex-col gap-4 pb-2">
            <Steps steps={[t("shotshare.step.choose"), t("shotshare.step.share")]} current={cloud ? 1 : 0} />
            <div className="grid grid-cols-[200px_minmax(0,1fr)] gap-4 max-[700px]:grid-cols-1">
              <ShotThumb path={shot.path} className="relative aspect-video rounded-card" />
              <div className="flex min-w-0 flex-col justify-center gap-1">
                <p className="truncate text-[13.5px] font-medium text-text">{shot.file_name}</p>
                <QuotaBar list={list.data} />
              </div>
            </div>
            {!cloud ? (
              <>
                <p className="text-[13px] font-medium text-text">{t("shotshare.who")}</p>
                <VisibilityCards value={vis} onChange={setVis} />
                {tooBig && <p className="text-[12.5px] text-danger">{t("shotshare.err.too_large")}</p>}
                {full && !tooBig && <p className="text-[12.5px] text-danger">{t("shotshare.err.quota")}</p>}
              </>
            ) : (
              <div className="flex flex-col gap-3 rounded-card bg-surface px-4 py-3.5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-text">{t("shotshare.who")}</p>
                    <p className="text-[12.5px] text-muted">{t(`shotshare.vis.${cloud.visibility}.desc`)}</p>
                  </div>
                  <div className="w-[180px]">
                    <VisibilitySelect value={cloud.visibility} onChange={changeVis} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {cloud.visibility === "link" && (
                    <Button variant="primary" icon={<Copy size={14} />} onClick={() => void copyShareLink(cloud)}>
                      {t("shotshare.copy_link")}
                    </Button>
                  )}
                  <Button icon={<MessageSquare size={14} />} onClick={() => setChat(true)}>
                    {t("shotshare.to_chat")}
                  </Button>
                </div>
                {cloud.visibility === "private" && <p className="text-[12px] text-dim">{t("shotshare.private_hint")}</p>}
              </div>
            )}
          </div>
        )}
      </Dialog>
      <ChatShareDialog shot={chat ? cloud : null} onClose={() => setChat(false)} onShared={(s) => setDone(s)} />
    </>
  );
}
