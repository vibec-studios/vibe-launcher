// Sprachchat beim Hosten einer Welt aus dem Spiel (Vibey Client, Vertrag 04): Simple Voice Chat per Klick in die
// Instanz installieren. Den Relay-Teil (Voice-Host) übernimmt der Vibey Client selbst.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Mic } from "lucide-react";
import { api } from "@/lib/api";
import type { Instance } from "@/lib/types";
import { Button, toast } from "@/components/ui";
import { useT } from "@/i18n";

export const SVC_PROJECT_ID = "9eGKb6K1";
const LOADERS = new Set(["fabric", "quilt", "neoforge", "forge"]);

export function VoiceWorldHint({ instance }: { instance: Instance }) {
  const t = useT();
  const qc = useQueryClient();
  const supported = LOADERS.has(instance.loader.kind);
  const q = useQuery({
    queryKey: ["instance", instance.id, "voicechat"],
    queryFn: async () => (await api.contentList(instance.id, "mod")).some((m) => m.project_id === SVC_PROJECT_ID || m.file_name.toLowerCase().startsWith("voicechat")),
    enabled: supported,
    staleTime: 30_000,
  });
  const [busy, setBusy] = useState(false);
  if (!supported || q.data === undefined) return null;

  const install = async () => {
    setBusy(true);
    try {
      await api.contentInstall(instance.id, "modrinth", SVC_PROJECT_ID, null);
      toast.info(t("srvx.world.installing"), "Simple Voice Chat");
      qc.setQueryData(["instance", instance.id, "voicechat"], true);
    } catch (e) {
      toast.error(e, t("srvx.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-6 mt-3 flex items-center gap-3 rounded-card bg-surface px-4 py-3">
      <Mic size={16} className="shrink-0 text-muted" />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-text">{t("srvx.world.title")}</div>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{q.data ? t("srvx.world.ready") : t("srvx.world.text")}</p>
      </div>
      {q.data ? (
        <span className="flex shrink-0 items-center gap-1.5 text-[12.5px] font-medium text-ok">
          <CheckCircle2 size={14} />
          {t("srvx.world.installed")}
        </span>
      ) : (
        <Button size="sm" variant="subtle" loading={busy} onClick={install}>
          {t("srvx.world.install")}
        </Button>
      )}
    </div>
  );
}
