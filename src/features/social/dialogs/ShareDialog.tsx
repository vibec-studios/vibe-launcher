import { useQuery } from "@tanstack/react-query";
import { Share2 } from "lucide-react";
import { useState } from "react";
import { api, errorMessage, isCancelled } from "@/lib/api";
import { useJavaInstances } from "@/lib/queries";
import type { Pack, PackVisibility } from "@/lib/vibe-sdk";
import { Button, Checkbox, Dialog, Field, Segmented, Spinner, Textarea } from "@/components/ui";
import { useT } from "@/i18n";
import { requireClient } from "../service";
import { NeedLogin, useReady } from "./common";
import { ShareResult } from "./ShareResult";

// ------------------------------------------------------------------ Teilen

export function ShareDialog({ instanceId, onClose }: { instanceId: string; onClose: () => void }) {
  const t = useT();
  const ready = useReady();
  const { data: instances = [] } = useJavaInstances();
  const inst = instances.find((i) => i.id === instanceId);
  const link = useQuery({ queryKey: ["vibe", "share-link", instanceId], queryFn: () => api.vibePackLink(instanceId), staleTime: 0 });
  const [visibility, setVisibility] = useState<PackVisibility>("unlisted");
  const [description, setDescription] = useState("");
  const [newVersion, setNewVersion] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Pack | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (!ready) return <NeedLogin title={t("social.share.title")} onClose={onClose} />;
  const existing = link.data?.code ?? null;
  const asVersion = !!existing && newVersion;

  const upload = async () => {
    setBusy(true);
    setErr(null);
    try {
      const token = await requireClient().accessToken();
      if (!token) throw new Error(t("social.err.not_connected"));
      const pack = (await api.vibePackShare(instanceId, token, asVersion ? { code: existing, changelog: description || null } : { visibility, description: description || null })) as Pack;
      setResult(pack);
      link.refetch();
    } catch (e) {
      if (!isCancelled(e)) setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !busy && onClose()}
      locked={busy}
      title={t("social.share.title")}
      description={inst?.name}
      footer={
        result ? (
          <Button variant="primary" onClick={onClose}>
            {t("common.close")}
          </Button>
        ) : (
          <>
            <Button variant="subtle" onClick={onClose} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" icon={<Share2 size={14} />} onClick={upload} loading={busy}>
              {asVersion ? t("social.share.upload_version") : t("social.share.upload")}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <ShareResult pack={result} />
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-[13px] text-muted">{t("social.share.text")}</p>
          {existing && (
            <label className="flex cursor-pointer items-center gap-2.5 rounded-card bg-surface p-3 text-[13px]">
              <Checkbox checked={newVersion} onChange={setNewVersion} />
              <span>
                {t("social.share.as_version")} <span className="font-mono text-brand">{existing}</span>
              </span>
            </label>
          )}
          {!asVersion && (
            <Field label={t("social.share.visibility")}>
              <Segmented
                value={visibility}
                onChange={setVisibility}
                items={[
                  { value: "unlisted", label: t("social.share.vis.unlisted") },
                  { value: "friends", label: t("social.share.vis.friends") },
                  { value: "public", label: t("social.share.vis.public") },
                ]}
                className="w-full [&>button]:flex-1"
              />
              <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
                {t(visibility === "unlisted" ? "uic.share.visibility.link" : visibility === "friends" ? "uic.share.visibility.friends" : "uic.share.visibility.public")}
              </p>
            </Field>
          )}
          <Field label={asVersion ? t("social.share.changelog") : t("social.share.description")}>
            <Textarea rows={3} maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          {busy && <p className="flex items-center gap-2 text-[12px] text-muted"><Spinner size={11} /> {t("social.share.busy")}</p>}
          {err && <p className="text-[12px] text-danger">{err}</p>}
        </div>
      )}
    </Dialog>
  );
}
