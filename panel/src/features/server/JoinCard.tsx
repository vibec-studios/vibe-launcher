import { ExternalLink, Radio } from "lucide-react";
import type { ServerView } from "@/api/types";
import { useAgent } from "@/app/agent";
import { useT } from "@/i18n";
import { Badge, Card, CopyField, Dot, Spinner } from "@/components/ui";
import { isActive } from "@/features/servers/meta";

export function TunnelState({ server: s }: { server: ServerView }) {
  const t = useT();
  const tn = s.status?.tunnel;
  if (s.connection === "local") return <Badge tone="muted">{t("conn.kind.local")}</Badge>;
  if (!tn || !isActive(s.status)) return <Badge tone="muted">{t("conn.state.stopped")}</Badge>;
  const tone = tn.state === "online" ? "ok" : tn.state === "error" ? "danger" : "warn";
  return (
    <Badge tone={tone}>
      {tn.state === "connecting" ? <Spinner size={10} /> : <Dot tone={tone} />}
      {t(`conn.state.${tn.state}`)}
    </Badge>
  );
}

export function JoinCard({ server: s }: { server: ServerView }) {
  const t = useT();
  const { base } = useAgent();
  const tn = s.status?.tunnel;
  const running = s.status?.state === "running";
  return (
    <Card title={t("join.title")} desc={t("join.desc")} actions={<TunnelState server={s} />}>
      {!running ? (
        <p className="text-[13.5px] text-muted">{t("join.start_first")}</p>
      ) : s.connection === "local" ? (
        <div className="flex flex-col gap-2 text-[13.5px] text-muted">
          <p>{t("join.local")}</p>
          <a href={`#${base}/servers/${encodeURIComponent(s.id)}/connection`} className="flex w-fit items-center gap-1.5 font-semibold text-accent">
            <Radio size={14} />
            {t("join.enable_tunnel")}
          </a>
        </div>
      ) : tn?.state === "online" && tn.address ? (
        <div className="flex flex-col gap-3">
          <CopyField value={tn.address} big />
          <ol className="flex list-decimal flex-col gap-1 pl-5 text-meta text-muted">
            <li>{t("join.step1")}</li>
            <li>{t("join.step2")}</li>
            <li>{t("join.step3")}</li>
          </ol>
          {tn.udp?.voice && <div className="text-meta text-muted">{t("join.voice", { addr: tn.udp.voice.address })}</div>}
        </div>
      ) : tn?.state === "claim" && tn.claim_url ? (
        <div className="flex flex-col gap-2 text-[13.5px]">
          <p className="text-muted">{tn.message ?? t("join.claim")}</p>
          <a href={tn.claim_url} target="_blank" rel="noreferrer" className="flex w-fit items-center gap-1.5 font-semibold text-accent">
            <ExternalLink size={14} />
            {t("join.claim_open")}
          </a>
        </div>
      ) : (
        <p className="text-[13.5px] text-muted">{tn?.message ?? t("join.connecting")}</p>
      )}
    </Card>
  );
}
