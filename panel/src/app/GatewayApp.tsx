import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { WifiOff } from "lucide-react";
import { ApiError } from "@/api/transport";
import type { AccountApi } from "@/api/gateway";
import { useT } from "@/i18n";
import { Button, Notice } from "@/components/ui";
import { Shell } from "@/components/Shell";
import { GatewayWelcome } from "@/features/auth/GatewayWelcome";
import { Waitlist, isAccessError } from "@/features/auth/Waitlist";
import { AgentsPage } from "@/features/agents/AgentsPage";
import { AgentArea, FullscreenSpinner } from "./AgentArea";
import { AgentProvider } from "./agent";
import { navigate, segments, useHashPath } from "./router";
import { accountApi } from "./runtime";

function RemoteAgent({ account, agentId, rest, onLogout, accountName }: { account: AccountApi; agentId: string; rest: string[]; onLogout: () => void; accountName: string }) {
  const t = useT();
  const transport = useMemo(() => account.agentTransport(agentId), [account, agentId]);
  const back = { href: "/agents", label: t("nav.all_agents") };
  return (
    <AgentProvider
      key={agentId}
      agentKey={`gw:${agentId}`}
      transport={transport}
      base={`/a/${encodeURIComponent(agentId)}`}
      remote
      fallback={({ error, loading, retry }) =>
        loading || !error ? (
          <FullscreenSpinner />
        ) : (
          <Shell nav={[]} active="" header={null} back={back} onLogout={onLogout} account={accountName}>
            <Notice
              tone={error instanceof ApiError && error.code === "agent_offline" ? "warn" : "danger"}
              title={error instanceof ApiError && error.code === "agent_offline" ? t("agents.offline_title") : t("error.generic")}
              actions={
                <>
                  <Button onClick={retry}>{t("common.retry")}</Button>
                  <Button variant="subtle" onClick={() => navigate("/agents")}>
                    {t("nav.all_agents")}
                  </Button>
                </>
              }
            >
              <span className="flex items-center gap-2">
                {error instanceof ApiError && error.code === "agent_offline" && <WifiOff size={15} />}
                {(error as Error).message}
              </span>
            </Notice>
          </Shell>
        )
      }
    >
      <AgentArea rest={rest} back={back} onLogout={onLogout} account={accountName} />
    </AgentProvider>
  );
}

export function GatewayApp() {
  const t = useT();
  const qc = useQueryClient();
  const path = useHashPath();
  const account = useMemo(() => accountApi(() => qc.invalidateQueries({ queryKey: ["vibe-me"] })), [qc]);
  const me = useQuery({ queryKey: ["vibe-me"], queryFn: account.me, retry: false, staleTime: 300_000 });
  const signedIn = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["vibe-me"] });
    navigate("/agents", true);
  }, [qc]);
  const logout = useCallback(async () => {
    await account.logout();
    qc.clear();
    navigate("/", true);
    qc.invalidateQueries({ queryKey: ["vibe-me"] });
  }, [account, qc]);

  if (me.isLoading) return <FullscreenSpinner />;
  if (me.error || !me.data) {
    if (isAccessError(me.error)) return <Waitlist error={me.error} onLogout={logout} />;
    const unauth = me.error instanceof ApiError && (me.error.status === 401 || me.error.status === 403);
    if (unauth || !me.error) return <GatewayWelcome account={account} onSignedIn={signedIn} />;
    return (
      <div className="mx-auto mt-24 max-w-md px-4">
        <Notice tone="danger" title={t("error.unreachable")} actions={<Button onClick={() => me.refetch()}>{t("common.retry")}</Button>}>
          {(me.error as Error).message}
        </Notice>
      </div>
    );
  }
  const seg = segments(path);
  if (seg[0] === "a" && seg[1]) return <RemoteAgent account={account} agentId={seg[1]} rest={seg.slice(2)} onLogout={logout} accountName={me.data.name} />;
  return (
    <Shell nav={[]} active="" header={null} onLogout={logout} account={me.data.name}>
      <AgentsPage account={account} accountName={me.data.name} />
    </Shell>
  );
}
