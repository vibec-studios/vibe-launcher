import type { ReactNode } from "react";
import type { ServerView } from "@/api/types";
import { useAgent, useResources } from "@/app/agent";
import { ago, bytes, dateTime, duration, mib } from "@/app/format";
import { useT } from "@/i18n";
import { Card, Meter } from "@/components/ui";
import { JoinCard } from "./JoinCard";

function Fact({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line py-2 text-[13.5px] last:border-b-0">
      <span className="text-muted">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}

export function OverviewTab({ server: s }: { server: ServerView }) {
  const t = useT();
  const { base } = useAgent();
  const res = useResources().data;
  const mine = res?.servers.find((x) => x.id === s.id);
  const running = s.status?.state === "running";
  const memMax = (s.memory_mb ?? 2048) * 1_048_576;
  const players = s.status?.players ?? [];
  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <div className="flex flex-col gap-4">
        <JoinCard server={s} />
        <Card title={t("overview.players")} actions={<a className="text-meta font-semibold text-accent" href={`#${base}/servers/${encodeURIComponent(s.id)}/players`}>{t("overview.manage_players")}</a>}>
          {!running ? (
            <p className="text-[13.5px] text-muted">{t("servers.offline")}</p>
          ) : players.length === 0 ? (
            <p className="text-[13.5px] text-muted">{t("overview.nobody")}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {players.map((p) => (
                <span key={p} className="flex items-center gap-2 rounded-ctl bg-surface2 py-1.5 pr-3 pl-1.5 text-[13px] font-medium">
                  <img src={`https://mc-heads.net/avatar/${encodeURIComponent(p)}/24`} alt="" className="size-6 rounded-xs" loading="lazy" />
                  {p}
                </span>
              ))}
            </div>
          )}
        </Card>
      </div>
      <div className="flex flex-col gap-4">
        <Card title={t("overview.usage")} desc={running ? undefined : t("overview.usage_off")}>
          <div className="flex flex-col gap-4">
            <Meter label={t("res.cpu")} value={mine?.cpu_percent ?? 0} max={100} text={`${Math.round(mine?.cpu_percent ?? 0)} %`} />
            <Meter label={t("res.ram")} value={mine?.mem_bytes ?? 0} max={memMax} text={`${bytes(mine?.mem_bytes ?? 0)} / ${mib(s.memory_mb ?? 2048)}`} />
          </div>
        </Card>
        <Card title={t("overview.facts")}>
          <Fact label={t("overview.status_since")}>{running && s.status?.started_at ? duration((Date.now() - s.status.started_at) / 1000) : "–"}</Fact>
          <Fact label={t("overview.port")}>{s.port}</Fact>
          <Fact label={t("overview.memory")}>{mib(s.memory_mb ?? 2048)}</Fact>
          <Fact label={t("overview.autostart")}>{s.auto_start ? t("common.yes") : t("common.no")}</Fact>
          <Fact label={t("overview.autorestart")}>{s.auto_restart ? t("common.yes") : t("common.no")}</Fact>
          <Fact label={t("overview.created")}>{dateTime(s.created_at)}</Fact>
          <Fact label={t("overview.last_started")}>{s.last_started ? ago(s.last_started) : "–"}</Fact>
        </Card>
      </div>
    </div>
  );
}
