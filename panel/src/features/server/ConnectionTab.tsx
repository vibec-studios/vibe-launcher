import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Globe2, House, RefreshCw, Router } from "lucide-react";
import type { ServerConnection, ServerView } from "@/api/types";
import { qk, useAgent } from "@/app/agent";
import { useT } from "@/i18n";
import { Button, Card, CopyField, Notice, cn, toast } from "@/components/ui";
import { JoinCard } from "./JoinCard";

const KINDS: { key: ServerConnection; icon: React.ReactNode }[] = [
  { key: "relay", icon: <Globe2 size={20} /> },
  { key: "playit", icon: <Router size={20} /> },
  { key: "local", icon: <House size={20} /> },
];

export function ConnectionTab({ server: s }: { server: ServerView }) {
  const t = useT();
  const { api, key, can } = useAgent();
  const qc = useQueryClient();
  const addresses = useQuery({ queryKey: [key, s.id, "addresses", s.status?.state ?? ""], queryFn: () => api.addresses(s.id) });
  const manage = can("servers.manage");
  const setKind = useMutation({
    mutationFn: (connection: ServerConnection) => api.patchServer(s.id, { connection }),
    onSuccess: (srv) => {
      qc.setQueryData<ServerView>(qk.server(key, s.id), (old) => (old ? { ...old, ...srv } : old));
      toast.ok(t("conn.saved"));
    },
    onError: (e) => toast.error(e),
  });
  const reset = useMutation({ mutationFn: () => api.resetTunnel(s.id), onSuccess: () => toast.ok(t("conn.reset_done")), onError: (e) => toast.error(e) });
  const udp = s.status?.tunnel?.udp;
  return (
    <div className="flex flex-col gap-4">
      <JoinCard server={s} />
      <Card title={t("conn.title")} desc={t("conn.desc")}>
        <div className="grid gap-2 md:grid-cols-3">
          {KINDS.map((k) => (
            <button
              key={k.key}
              role="radio"
              aria-checked={s.connection === k.key}
              disabled={!manage || setKind.isPending}
              onClick={() => s.connection !== k.key && setKind.mutate(k.key)}
              className={cn(
                "relative flex flex-col items-start gap-2 rounded-card p-4 text-left transition-colors disabled:cursor-default",
                s.connection === k.key ? "bg-brand/12 shadow-[inset_0_0_0_1.5px_var(--ui-accent)]" : "bg-surface2 hover:bg-surface3",
              )}
            >
              <span className="text-accent">{k.icon}</span>
              <span className="font-semibold">
                {t(`conn.kind.${k.key}`)}
                {k.key === "relay" && <span className="ml-2 rounded-pill bg-ok/15 px-1.5 py-px text-[10.5px] font-bold text-ok">{t("create.recommended")}</span>}
              </span>
              <span className="text-meta text-muted">{t(`conn.kind.${k.key}.desc`)}</span>
              {s.connection === k.key && <Check size={16} className="absolute top-3 right-3 text-accent" />}
            </button>
          ))}
        </div>
        {s.connection === "relay" && manage && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <p className="text-meta text-muted">{t("conn.reset_desc")}</p>
            <Button variant="ghost" icon={<RefreshCw size={15} />} loading={reset.isPending} onClick={() => reset.mutate()}>
              {t("conn.reset")}
            </Button>
          </div>
        )}
        {s.status?.tunnel?.state === "error" && s.status.tunnel.message && (
          <div className="mt-4">
            <Notice tone="danger">{s.status.tunnel.message}</Notice>
          </div>
        )}
      </Card>
      {udp && udp.state !== "off" && (
        <Card title={t("conn.udp")} desc={t("conn.udp_desc")}>
          <div className="grid gap-3 sm:grid-cols-2">
            {udp.voice && (
              <div>
                <div className="label mb-1.5">{t("conn.voice")}</div>
                <CopyField value={udp.voice.address} />
              </div>
            )}
            {udp.bedrock && (
              <div>
                <div className="label mb-1.5">{t("conn.bedrock")}</div>
                <CopyField value={udp.bedrock.address} />
              </div>
            )}
          </div>
        </Card>
      )}
      <Card title={t("conn.addresses")} desc={t("conn.addresses_desc")}>
        {addresses.data && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className="label mb-1.5">{t("conn.addr.lan")}</div>
              {addresses.data.lan.map((a) => (
                <CopyField key={a} value={a} className="mb-2" />
              ))}
            </div>
            {addresses.data.public && (
              <div>
                <div className="label mb-1.5">{t("conn.addr.public")}</div>
                <CopyField value={addresses.data.public} />
                <p className="mt-1.5 text-meta text-dim">{t("conn.addr.public_hint")}</p>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
