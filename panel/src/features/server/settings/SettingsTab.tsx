import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, Save, Trash2 } from "lucide-react";
import type { ServerPatch, ServerView } from "@/api/types";
import { qk, useAgent } from "@/app/agent";
import { mib } from "@/app/format";
import { navigate } from "@/app/router";
import { useT } from "@/i18n";
import { Button, Card, Input, Row, Switch, toast, useConfirm } from "@/components/ui";
import { isActive } from "@/features/servers/meta";
import { PropertiesCard } from "./PropertiesCard";

function ServerCard({ server: s }: { server: ServerView }) {
  const t = useT();
  const { api, key, can } = useAgent();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<ServerPatch>({});
  useEffect(() => setDraft({}), [s.id]);
  const manage = can("servers.manage");
  const v = { name: s.name, memory_mb: s.memory_mb ?? 2048, auto_start: s.auto_start, auto_restart: s.auto_restart, port: s.port, ...draft };
  const dirty = Object.keys(draft).length > 0;
  const save = useMutation({
    mutationFn: () => api.patchServer(s.id, draft),
    onSuccess: (srv) => {
      qc.setQueryData<ServerView>(qk.server(key, s.id), (old) => (old ? { ...old, ...srv } : old));
      qc.invalidateQueries({ queryKey: qk.servers(key) });
      setDraft({});
      toast.ok(t("common.saved"));
    },
    onError: (e) => toast.error(e),
  });
  return (
    <Card title={t("ssettings.title")} desc={t("ssettings.desc")}>
      <Row title={t("ssettings.name")}>
        <Input value={v.name} disabled={!manage} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} className="w-full sm:w-64" />
      </Row>
      <Row title={t("create.memory")} desc={t("ssettings.memory_desc")}>
        <input type="range" min={1024} max={32768} step={512} value={v.memory_mb ?? 2048} disabled={!manage} onChange={(e) => setDraft((d) => ({ ...d, memory_mb: Number(e.target.value) }))} className="w-full accent-[var(--ui-accent)] sm:w-44" aria-label={t("create.memory")} />
        <span className="w-16 text-right font-semibold tabular-nums">{mib(v.memory_mb ?? 2048)}</span>
      </Row>
      <Row title={t("overview.autostart")} desc={t("ssettings.autostart_desc")}>
        <Switch checked={v.auto_start} disabled={!manage} onChange={(x) => setDraft((d) => ({ ...d, auto_start: x }))} label={t("overview.autostart")} />
      </Row>
      <Row title={t("overview.autorestart")} desc={t("ssettings.autorestart_desc")}>
        <Switch checked={v.auto_restart} disabled={!manage} onChange={(x) => setDraft((d) => ({ ...d, auto_restart: x }))} label={t("overview.autorestart")} />
      </Row>
      <Row title={t("overview.port")} desc={t("ssettings.port_desc")}>
        <Input type="number" min={1024} max={65535} value={v.port} disabled={!manage} onChange={(e) => setDraft((d) => ({ ...d, port: Number(e.target.value) }))} className="w-full sm:w-28" />
      </Row>
      {manage && (
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="subtle" disabled={!dirty} onClick={() => setDraft({})}>
            {t("common.discard")}
          </Button>
          <Button variant="primary" icon={<Save size={15} />} disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
            {t("common.save")}
          </Button>
        </div>
      )}
    </Card>
  );
}

function DangerCard({ server: s }: { server: ServerView }) {
  const t = useT();
  const { api, base } = useAgent();
  const confirm = useConfirm();
  const active = isActive(s.status);
  const reinstall = useMutation({ mutationFn: () => api.install(s.id, true), onSuccess: () => toast.ok(t("danger.reinstall_started")), onError: (e) => toast.error(e) });
  const remove = useMutation({
    mutationFn: () => api.deleteServer(s.id),
    onSuccess: () => {
      toast.ok(t("danger.deleted", { name: s.name }));
      navigate(`${base}/servers`);
    },
    onError: (e) => toast.error(e),
  });
  return (
    <Card title={t("danger.title")} className="shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--ui-danger)_30%,transparent)]">
      <Row title={t("danger.reinstall")} desc={t("danger.reinstall_desc")}>
        <Button variant="ghost" icon={<Download size={15} />} disabled={active} loading={reinstall.isPending} onClick={async () => (await confirm.ask({ title: t("danger.reinstall"), body: t("danger.reinstall_desc") })) && reinstall.mutate()}>
          {t("danger.reinstall")}
        </Button>
      </Row>
      <Row title={t("danger.delete")} desc={active ? t("danger.stop_first") : t("danger.delete_desc")}>
        <Button
          variant="danger"
          icon={<Trash2 size={15} />}
          disabled={active}
          loading={remove.isPending}
          onClick={async () => (await confirm.ask({ title: t("danger.delete_confirm", { name: s.name }), body: t("danger.delete_desc"), confirm: t("danger.delete"), danger: true })) && remove.mutate()}
        >
          {t("danger.delete")}
        </Button>
      </Row>
      {confirm.node}
    </Card>
  );
}

export function SettingsTab({ server }: { server: ServerView }) {
  const { can } = useAgent();
  return (
    <div className="flex flex-col gap-4">
      <ServerCard server={server} />
      <PropertiesCard server={server} />
      {can("servers.manage") && <DangerCard server={server} />}
    </div>
  );
}
