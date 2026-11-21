import { cn } from "@/components/ui";
import { useT } from "@/i18n";
import { useRemote } from "./store";

const tone = { online: "bg-ok", connecting: "bg-warn animate-pulse", offline: "bg-dim", failed: "bg-danger" } as const;

export function useAgentConn(key: string) {
  return useRemote((s) => s.conn[key]);
}

export function ConnDot({ agent, withLabel, className }: { agent: string; withLabel?: boolean; className?: string }) {
  const t = useT();
  const c = useAgentConn(agent);
  const state = c?.state ?? "connecting";
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)} title={c?.error ?? undefined}>
      <span className={cn("h-2 w-2 shrink-0 rounded-dot", tone[state])} />
      {withLabel && <span className="text-meta text-muted">{t(`rmt.conn.${state}`)}</span>}
    </span>
  );
}
