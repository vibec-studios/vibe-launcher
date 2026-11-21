import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Library, Play } from "lucide-react";
import { Button, Dialog, Field, Select, toast } from "@/components/ui";
import { usePing } from "@/components/instance/motd";
import { useT } from "@/i18n";
import { api } from "@/lib/api";
import { useJavaInstances } from "@/lib/queries";
import type { DiscoveryServer } from "@/lib/vibe-sdk";
import { suggestInstance } from "./match";

export function JoinDialog({ server, onClose }: { server: DiscoveryServer | null; onClose: () => void }) {
  const t = useT();
  const nav = useNavigate();
  const { data: instances = [] } = useJavaInstances();
  const ping = usePing(server?.address ?? null, !!server);
  const suggested = useMemo(() => suggestInstance(instances, ping.data?.version), [instances, ping.data?.version]);
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (server) setPick(null);
  }, [server]);
  const chosen = pick ?? suggested?.id ?? instances[0]?.id ?? null;
  const inst = instances.find((i) => i.id === chosen);

  const play = async () => {
    if (!server || !inst) return;
    setBusy(true);
    try {
      await api.instanceLaunch(inst.id, null, null, server.address);
      toast.info(t("discovery.join.started", { name: inst.name }), server.name);
      onClose();
    } catch (e) {
      toast.error(e, t("discovery.join.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={!!server}
      onOpenChange={(o) => !o && onClose()}
      size="md"
      title={server ? t("discovery.join.title", { name: server.name }) : ""}
      description={t("discovery.join.desc")}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" icon={<Play size={15} />} loading={busy} disabled={!inst} onClick={play}>
            {t("discovery.join.play")}
          </Button>
        </>
      }
    >
      {instances.length === 0 ? (
        <div className="flex flex-col items-start gap-3 pb-2">
          <p className="text-[13px] text-muted">{t("discovery.join.no_instances")}</p>
          <Button icon={<Library size={15} />} onClick={() => (onClose(), nav({ to: "/instances" }))}>
            {t("layout.go_library")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3 pb-2">
          <div className="rounded-card bg-surface px-4 py-3 text-[12.5px] text-muted">
            {ping.data?.online ? t("discovery.join.version", { version: ping.data.version ?? "?" }) : ping.isLoading ? t("discovery.ping.loading") : t("discovery.ping.offline")}
            {ping.data?.online && (suggested ? <span className="mt-1 block text-ok">{t("discovery.join.suggested", { name: suggested.name })}</span> : <span className="mt-1 block text-warn">{t("discovery.join.no_match")}</span>)}
          </div>
          <Field label={t("discovery.join.instance")}>
            <Select<string>
              value={chosen ?? ""}
              onChange={setPick}
              options={instances.map((i) => ({ value: i.id, label: i.name, hint: `${i.mc_version}${i.loader.kind !== "vanilla" ? ` · ${i.loader.kind}` : ""}` }))}
            />
          </Field>
        </div>
      )}
    </Dialog>
  );
}
