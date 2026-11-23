import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, UploadCloud } from "lucide-react";
import { useState } from "react";
import { Button, Dialog, Skeleton } from "@/components/ui";
import { crashLogContent } from "@/features/logs/source";
import { uploadToMclogs } from "@/features/logs/logText";
import { useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { closeShareLog, useShareLog, type ShareRequest } from "./shareStore";

const SHOWN = 1500;

function Preview({ req, onClose }: { req: ShareRequest; onClose: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ["share-log", req.instanceId, req.crashReport],
    queryFn: async () => {
      const content = await crashLogContent(req.instanceId, req.crashReport);
      return { content, preview: content.trim() ? await api.mclogsPreview(content) : "" };
    },
    staleTime: 0,
    gcTime: 0,
    retry: 0,
  });
  const lines = q.data?.preview.split("\n") ?? [];
  const hidden = Math.max(0, lines.length - SHOWN);
  const upload = async () => {
    if (!q.data) return;
    setBusy(true);
    const url = await uploadToMclogs(q.data.content);
    setBusy(false);
    if (url) onClose();
  };
  return (
    <Dialog
      open
      protect
      onOpenChange={(o) => !o && !busy && onClose()}
      title={t("vibefix.share.title")}
      description={t("vibefix.share.desc")}
      size="lg"
      locked={busy}
      footer={
        <>
          <Button variant="subtle" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="accent" icon={<UploadCloud size={14} />} loading={busy} disabled={!q.data?.preview.trim()} onClick={() => void upload()}>
            {t("vibefix.share.confirm")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2.5">
        <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-muted">
          <ShieldCheck size={14} className="mt-0.5 shrink-0 text-ok" />
          {t("vibefix.share.redacted")}
        </p>
        {q.isPending ? (
          <Skeleton className="h-[280px]" />
        ) : q.isError ? (
          <p className="selectable text-[13px] text-danger">{errorMessage(q.error)}</p>
        ) : !q.data.preview.trim() ? (
          <p className="text-[13px] text-muted">{t("logs.upload_empty")}</p>
        ) : (
          <>
            <pre className="selectable max-h-[46vh] overflow-auto whitespace-pre-wrap break-all rounded-xs bg-black/25 px-2.5 py-2 font-mono text-[11px] leading-snug text-muted">
              {lines.slice(-SHOWN).join("\n")}
            </pre>
            <span className="text-[11.5px] text-dim">
              {hidden ? t("vibefix.share.more", { n: hidden, total: lines.length }) : t("vibefix.share.lines", { n: lines.length })}
            </span>
          </>
        )}
      </div>
    </Dialog>
  );
}

export function ShareLogHost() {
  const req = useShareLog((s) => s.req);
  return req ? <Preview key={`${req.instanceId}:${req.crashReport ?? ""}`} req={req} onClose={closeShareLog} /> : null;
}
