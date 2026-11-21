import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpCircle, Save } from "lucide-react";
import { useAgent } from "@/app/agent";
import { useT } from "@/i18n";
import { Badge, Button, Card, Input, Row, toast } from "@/components/ui";
import { TaskProgress } from "@/components/TaskProgress";

export function AgentCard() {
  const t = useT();
  const { api, key, info } = useAgent();
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: [key, "settings"], queryFn: api.settings });
  const update = useQuery({ queryKey: [key, "update"], queryFn: api.update, staleTime: 300_000 });
  const [name, setName] = useState("");
  const [taskId, setTaskId] = useState<string | null>(null);
  useEffect(() => setName(settings.data?.name ?? ""), [settings.data?.name]);
  const save = useMutation({
    mutationFn: () => api.updateSettings({ name }),
    onSuccess: (s) => {
      qc.setQueryData([key, "settings"], s);
      qc.invalidateQueries({ queryKey: ["info", key] });
      toast.ok(t("common.saved"));
    },
    onError: (e) => toast.error(e),
  });
  const runUpdate = useMutation({ mutationFn: api.runUpdate, onSuccess: (r) => setTaskId(r.task_id), onError: (e) => toast.error(e) });
  return (
    <Card title={t("agent.title")} desc={t("agent.desc")}>
      <Row title={t("agent.name")} desc={t("agent.name_desc")}>
        <Input value={name} onChange={(e) => setName(e.target.value)} className="w-full sm:w-56" />
        <Button variant="ghost" icon={<Save size={15} />} disabled={!name.trim() || name === settings.data?.name} loading={save.isPending} onClick={() => save.mutate()}>
          {t("common.save")}
        </Button>
      </Row>
      <Row title={t("agent.system")}>
        <span className="text-[13.5px] text-muted">
          {info.os} · {info.arch}
        </span>
      </Row>
      <Row title={t("agent.port")} desc={t("agent.port_desc")}>
        <span className="font-mono text-[13px]">{settings.data?.port ?? "–"}</span>
        {settings.data?.tls && <Badge tone="ok">HTTPS</Badge>}
      </Row>
      {info.fingerprint && (
        <Row title={t("agent.fingerprint")} desc={t("agent.fingerprint_desc")}>
          <code className="max-w-[260px] truncate font-mono text-[12px] text-muted" title={info.fingerprint}>
            {info.fingerprint.match(/.{2}/g)?.slice(0, 8).join(":")}…
          </code>
        </Row>
      )}
      <Row title={t("agent.version")} desc={update.data?.available ? t("agent.update_available", { v: update.data.latest }) : t("agent.up_to_date")}>
        <span className="font-mono text-[13px]">{info.version}</span>
        {update.data?.available && (
          <Button variant="primary" icon={<ArrowUpCircle size={15} />} loading={runUpdate.isPending} disabled={!!taskId} onClick={() => runUpdate.mutate()}>
            {t("agent.update")}
          </Button>
        )}
      </Row>
      {taskId && <TaskProgress taskId={taskId} />}
    </Card>
  );
}
