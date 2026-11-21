import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Home, Laptop, Plus, RefreshCw, Server } from "lucide-react";
import type { AccountApi } from "@/api/gateway";
import type { GatewayAgent } from "@/api/types";
import { ago } from "@/app/format";
import { navigate } from "@/app/router";
import { useT } from "@/i18n";
import { Badge, Button, Dot, Empty, Notice, cn } from "@/components/ui";
import { PageTitle } from "@/components/Shell";
import { AddAgentDialog } from "./AddAgentDialog";
import { Waitlist, isAccessError } from "@/features/auth/Waitlist";

function AgentIcon({ a }: { a: GatewayAgent }) {
  const home = /hause|home/i.test(a.name);
  const Icon = home ? Home : a.os === "linux" ? Server : Laptop;
  return (
    <span className={cn("grid size-12 shrink-0 place-items-center rounded-card", a.online ? "bg-brand/15 text-accent" : "bg-white/[.06] text-dim")}>
      <Icon size={22} />
    </span>
  );
}

function AgentCard({ a }: { a: GatewayAgent }) {
  const t = useT();
  const s = a.summary;
  const open = () => a.online && navigate(`/a/${encodeURIComponent(a.id)}/servers`);
  return (
    <button
      onClick={open}
      disabled={!a.online || a.disabled}
      className={cn("group flex w-full items-center gap-4 rounded-card bg-surface p-5 text-left transition-colors", a.online ? "hover:bg-surface2" : "cursor-default opacity-80")}
    >
      <AgentIcon a={a} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[15.5px] font-semibold">{a.name}</span>
          {a.myRole !== "owner" && <Badge tone="accent">{t(`role.${a.myRole}`)}</Badge>}
          {a.disabled && <Badge tone="danger">{t("agents.disabled")}</Badge>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-muted">
          <span className="flex items-center gap-1.5">
            <Dot tone={a.online ? "ok" : "muted"} />
            {a.online ? t("agents.online") : a.lastSeenAt ? t("agents.offline_since", { when: ago(a.lastSeenAt) }) : t("agents.never")}
          </span>
          {a.hostname && <span className="font-mono text-[12px]">{a.hostname}</span>}
          {a.myRole !== "owner" && a.owner && <span>{t("agents.owner", { name: a.owner.name })}</span>}
        </div>
        {!a.online && <div className="mt-2 text-meta text-dim">{t("agents.offline_hint")}</div>}
      </div>
      {s && a.online && (
        <div className="hidden shrink-0 text-right text-meta sm:block">
          <div className="font-semibold text-text">{t("agents.running", { n: s.running ?? 0, total: s.servers ?? 0 })}</div>
          {s.players != null && <div className="text-muted">{t("agents.players", { n: s.players })}</div>}
        </div>
      )}
      {a.online && <ChevronRight size={18} className="shrink-0 text-dim group-hover:text-text" />}
    </button>
  );
}

export function AgentsPage({ account, accountName }: { account: AccountApi; accountName: string }) {
  const t = useT();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const agents = useQuery({ queryKey: ["gateway-agents"], queryFn: account.agents, refetchInterval: 15_000 });
  const list = agents.data ?? [];
  const mine = list.filter((a) => a.myRole === "owner");
  const shared = list.filter((a) => a.myRole !== "owner");
  if (isAccessError(agents.error)) return <Waitlist error={agents.error} />;
  return (
    <>
      <PageTitle
        title={t("agents.title", { name: accountName })}
        desc={t("agents.desc")}
        actions={
          <>
            <Button variant="subtle" icon={<RefreshCw size={15} />} onClick={() => agents.refetch()} loading={agents.isFetching && !agents.isLoading}>
              {t("common.refresh")}
            </Button>
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => setAdding(true)}>
              {t("agents.add")}
            </Button>
          </>
        }
      />
      {agents.error && <Notice tone="danger">{(agents.error as Error).message}</Notice>}
      {agents.isLoading && (
        <div className="flex flex-col gap-3">
          {[0, 1].map((i) => (
            <div key={i} className="skeleton h-[88px]" />
          ))}
        </div>
      )}
      {agents.data && list.length === 0 && (
        <div className="rounded-card bg-surface">
          <Empty icon={<Server size={34} />} title={t("agents.empty")} action={<Button variant="primary" icon={<Plus size={16} />} onClick={() => setAdding(true)}>{t("agents.add")}</Button>}>
            {t("agents.empty_desc")}
          </Empty>
        </div>
      )}
      {mine.length > 0 && (
        <div className="flex flex-col gap-3">
          {mine.map((a) => (
            <AgentCard key={a.id} a={a} />
          ))}
        </div>
      )}
      {shared.length > 0 && (
        <>
          <h2 className="mt-8 mb-3 label">{t("agents.shared")}</h2>
          <div className="flex flex-col gap-3">
            {shared.map((a) => (
              <AgentCard key={a.id} a={a} />
            ))}
          </div>
        </>
      )}
      <AddAgentDialog open={adding} onClose={() => setAdding(false)} account={account} onAdded={() => qc.invalidateQueries({ queryKey: ["gateway-agents"] })} />
    </>
  );
}
