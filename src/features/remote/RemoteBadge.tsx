import { Cloud, ExternalLink, FolderOpen, Network } from "lucide-react";
import { Button, Tooltip, cn } from "@/components/ui";
import type { Server } from "@/lib/types";
import { useT } from "@/i18n";
import { useAgentConn } from "./ConnDot";
import { openAgentPanel } from "./panel";
import { agentByKey } from "./store";

export function RemoteBadge({ server, className }: { server: Server; className?: string }) {
  const t = useT();
  const r = server.remote;
  const conn = useAgentConn(r?.agent ?? "");
  if (!r) return null;
  const off = conn && conn.state !== "online" && conn.state !== "connecting";
  return (
    <Tooltip content={conn?.error && off ? conn.error : t("rmt.badge.tip", { name: r.agent_name })}>
      <span
        className={cn(
          "vl-tag inline-flex h-5 shrink-0 items-center gap-1 rounded-xs px-1.5 text-[11px] font-medium",
          off ? "bg-white/[.06] text-dim" : "bg-accent/12 text-accent",
          className,
        )}
      >
        {r.via === "vibe" ? <Cloud size={11} /> : <Network size={11} />}
        {t("rmt.badge", { name: r.agent_name })}
        {off && <span className="text-dim">· {t("rmt.offline")}</span>}
      </span>
    </Tooltip>
  );
}

export function PanelButton({ server, size = "sm" }: { server: Server; size?: "sm" | "md" }) {
  const t = useT();
  const r = server.remote;
  if (!r) return null;
  const open = () => {
    const a = agentByKey(r.agent);
    if (a) void openAgentPanel(a);
  };
  return (
    <Tooltip content={t("rmt.panel.tip")}>
      <Button size={size} variant="ghost" icon={<ExternalLink size={14} />} onClick={open}>
        {t("rmt.panel")}
      </Button>
    </Tooltip>
  );
}

export function RemoteFilesHint({ server }: { server: Server }) {
  const t = useT();
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="flex max-w-[480px] flex-col items-center gap-3 rounded-panel bg-surface px-8 py-10 text-center">
        <FolderOpen size={34} strokeWidth={1.5} className="text-dim" />
        <div className="text-[15px] font-semibold text-text">{t("rmt.files.title")}</div>
        <p className="text-[13px] leading-relaxed text-muted">{t("rmt.files.text", { name: server.remote?.agent_name ?? "" })}</p>
        <PanelButton server={server} size="md" />
      </div>
    </div>
  );
}
