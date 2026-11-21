import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link2, Unlink } from "lucide-react";
import { useAgent } from "@/app/agent";
import { dateTime } from "@/app/format";
import { useT } from "@/i18n";
import { Badge, Button, Card, CopyField, Dot, Notice, Row, Spinner, Switch, toast, useConfirm } from "@/components/ui";

export function GatewayCard() {
  const t = useT();
  const { api, key, remote } = useAgent();
  const confirm = useConfirm();
  const [pending, setPending] = useState<{ code: string; expires_at?: number } | null>(null);
  const gw = useQuery({ queryKey: [key, "gateway"], queryFn: api.gateway, refetchInterval: pending ? 3000 : false });
  const relay = useQuery({ queryKey: [key, "relay"], queryFn: api.relay, refetchInterval: pending ? 3000 : false });
  const link = useMutation({
    mutationFn: api.gatewayLink,
    onSuccess: (d) => (d.code ? setPending({ code: d.code, expires_at: d.expires_at }) : gw.refetch()),
    onError: (e) => toast.error(e),
  });
  const unlink = useMutation({ mutationFn: api.gatewayUnlink, onSuccess: () => (gw.refetch(), relay.refetch()), onError: (e) => toast.error(e) });
  const toggle = useMutation({ mutationFn: (v: boolean) => api.updateSettings({ gateway_enabled: v }), onSuccess: () => gw.refetch(), onError: (e) => toast.error(e) });
  const g = gw.data;
  useEffect(() => {
    if (pending && g?.linked) {
      setPending(null);
      toast.ok(t("gw.linked_toast"));
    }
  }, [pending, g?.linked, t]);
  return (
    <Card title={t("gw.title")} desc={t("gw.desc")}>
      {g && (
        <>
          <Row title={t("gw.status")}>
            <Badge tone={g.connected ? "ok" : g.linked ? "warn" : "muted"}>
              <Dot tone={g.connected ? "ok" : g.linked ? "warn" : "muted"} />
              {g.connected ? t("gw.connected") : g.linked ? t("gw.disconnected") : t("gw.not_linked")}
            </Badge>
          </Row>
          {g.linked && g.vibe_user && (
            <Row title={t("gw.account")} desc={t("gw.account_desc")}>
              <span className="font-medium">{g.vibe_user.name}</span>
              {!remote && (
                <Button variant="subtle" icon={<Unlink size={15} />} onClick={async () => (await confirm.ask({ title: t("gw.unlink_confirm"), body: t("gw.unlink_desc"), confirm: t("gw.unlink"), danger: true })) && unlink.mutate()}>
                  {t("gw.unlink")}
                </Button>
              )}
            </Row>
          )}
          {g.linked && (
            <Row title={t("gw.enabled")} desc={t("gw.enabled_desc")}>
              <Switch checked={g.enabled} disabled={remote || toggle.isPending} onChange={(v) => toggle.mutate(v)} label={t("gw.enabled")} />
            </Row>
          )}
          {!g.linked && (
            <div className="flex flex-col gap-3 py-3">
              {pending ? (
                <>
                  <p className="text-[13.5px] text-muted">{t("gw.link_code_desc")}</p>
                  <CopyField value={pending.code} big className="sm:w-72" />
                  <div className="flex items-center gap-2 text-meta text-muted">
                    <Spinner size={13} />
                    {t("gw.link_waiting")}
                    {pending.expires_at && <span className="text-dim">· {t("users.invite_expires", { when: dateTime(pending.expires_at) })}</span>}
                  </div>
                </>
              ) : (
                <>
                  <p className="text-[13.5px] text-muted">{t("gw.link_desc")}</p>
                  <Button variant="primary" className="w-fit" icon={<Link2 size={15} />} loading={link.isPending} onClick={() => link.mutate()}>
                    {t("gw.link")}
                  </Button>
                </>
              )}
            </div>
          )}
          {g.last_error && <Notice tone="warn">{g.last_error}</Notice>}
        </>
      )}
      {relay.data && (
        <Row title={t("gw.relay")} desc={relay.data.configured ? t("gw.relay_ok", { name: relay.data.name ?? "?" }) : t("gw.relay_missing")}>
          <Badge tone={relay.data.configured ? "ok" : "warn"}>{relay.data.configured ? t("gw.relay_ready") : t("gw.relay_off")}</Badge>
        </Row>
      )}
      {confirm.node}
    </Card>
  );
}
