import type { ReactNode } from "react";
import { Dot, Spinner } from "@/components/ui";
import { Shell, useAgentNav } from "@/components/Shell";
import { useT } from "@/i18n";
import { ServersPage } from "@/features/servers/ServersPage";
import { ServerPage } from "@/features/server/ServerPage";
import { ResourcesPage } from "@/features/resources/ResourcesPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { useAgent } from "./agent";

function AgentBadge() {
  const t = useT();
  const { info, socketState, remote } = useAgent();
  return (
    <div className="flex items-center gap-3 rounded-card bg-surface p-3">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-semibold">{info.name}</div>
        <div className="flex items-center gap-1.5 text-caption text-muted">
          <Dot tone={socketState === "open" ? "ok" : socketState === "connecting" ? "warn" : "danger"} />
          {socketState === "open" ? (remote ? t("agent.live_remote") : t("agent.live")) : socketState === "connecting" ? t("agent.connecting") : t("agent.reconnecting")}
        </div>
      </div>
    </div>
  );
}

export function AgentArea({ rest, back, onLogout, account }: { rest: string[]; back?: { href: string; label: string }; onLogout?: () => void; account?: string }) {
  const { base } = useAgent();
  const nav = useAgentNav(base);
  const [section, id, tab] = rest;
  let page: ReactNode;
  let active = "servers";
  if (section === "resources") {
    page = <ResourcesPage />;
    active = "resources";
  } else if (section === "settings") {
    page = <SettingsPage />;
    active = "settings";
  } else if (section === "servers" && id) page = <ServerPage key={id} id={id} tab={tab} />;
  else page = <ServersPage />;
  return (
    <Shell nav={nav} active={active} header={<AgentBadge />} back={back} onLogout={onLogout} account={account}>
      {page}
    </Shell>
  );
}

export function FullscreenSpinner() {
  return (
    <div className="flex h-full items-center justify-center text-muted">
      <Spinner size={26} />
    </div>
  );
}
