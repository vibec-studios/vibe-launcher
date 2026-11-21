import { useQuery } from "@tanstack/react-query";
import { Link2, PackageOpen, SearchX } from "lucide-react";
import { useState } from "react";
import { api, errorMessage, isCancelled } from "@/lib/api";
import { waitForTask } from "@/lib/queries";
import type { LoaderKind } from "@/lib/types";
import { useVibe } from "@/lib/vibe";
import { Button, Dialog, Skeleton, toast } from "@/components/ui";
import { finishNewInstance } from "@/components/content/install";
import { loaderNames } from "@/lib/format";
import { useT } from "@/i18n";
import { GateState } from "../Gate";
import { errText, requireClient, useSocial, vibeClient, vqk } from "../service";
import { PackIcon } from "./PackIcon";

// ------------------------------------------------------------------ Pack importieren

export function PackImportDialog({ code, onClose }: { code: string; onClose: () => void }) {
  const t = useT();
  const vibe = useVibe();
  const conn = useSocial((s) => s.conn);
  const client = vibeClient();
  const q = useQuery({ queryKey: vqk.pack(code), queryFn: () => requireClient().packs.get(code), enabled: !!client && vibe.sharing, retry: 0, staleTime: 30_000 });
  const [busy, setBusy] = useState(false);

  if (!vibe.sharing || !client) {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()} title={t("action.pack.title")} size="sm">
        <GateState conn={vibe.enabled && vibe.sharing ? conn : "off"} compact />
      </Dialog>
    );
  }
  const p = q.data;
  const install = async () => {
    if (!p) return;
    setBusy(true);
    try {
      const token = await client.accessToken().catch(() => null);
      const taskId = await api.vibePackInstall(p.code, null, token);
      toast.info(t("social.pack.importing", { name: p.name }));
      onClose();
      waitForTask(taskId)
        .then((task) => finishNewInstance(task.instance_id, p.name, true))
        .catch((e) => {
          if (!isCancelled(e)) toast.error(t("install.failed", { name: p.name }), errorMessage(e));
        });
    } catch (e) {
      toast.error(errText(e));
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("action.pack.title")}
      size="sm"
      footer={
        <>
          <Button variant="subtle" onClick={onClose} autoFocus={q.isError}>
            {q.isError ? t("common.close") : t("common.cancel")}
          </Button>
          {!q.isError && (
            <Button variant="primary" icon={<PackageOpen size={14} />} onClick={install} loading={busy} disabled={!p}>
              {t("social.pack.install")}
            </Button>
          )}
        </>
      }
    >
      {q.isError ? (
        <div className="flex items-start gap-3 rounded-card border border-danger/30 bg-danger/[.06] px-4 py-3">
          <SearchX size={18} className="mt-0.5 shrink-0 text-danger" />
          <div className="min-w-0">
            <p className="text-[13px] leading-relaxed text-text">{t("uic.pack.not_found", { code })}</p>
            <p className="mt-1 text-[12px] text-dim">{errText(q.error)}</p>
          </div>
        </div>
      ) : !p ? (
        <div className="flex items-center gap-3">
          <Skeleton className="h-12 w-12" />
          <Skeleton className="h-5 w-48" />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <PackIcon pack={p} size={48} />
            <div className="min-w-0">
              <div className="truncate text-[15px] font-semibold text-text">{p.name}</div>
              <div className="truncate text-[12px] text-muted">
                {t("social.pack.by", { name: p.owner.name })} · {p.mcVersion} · {loaderNames[p.loader as LoaderKind] ?? p.loader}
              </div>
            </div>
          </div>
          {p.description && <p className="line-clamp-4 whitespace-pre-wrap text-[13px] text-text">{p.description}</p>}
          <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-dim">
            <span>
              <Link2 size={11} className="mr-1 inline" />
              {p.code}
            </span>
            {p.latestVersion && <span>v{p.latestVersion.version}</span>}
            {p.latestVersion && <span>{t("social.pack.files", { n: p.latestVersion.fileCount })}</span>}
            <span>{t("social.pack.downloads", { n: p.downloads })}</span>
          </div>
        </div>
      )}
    </Dialog>
  );
}
