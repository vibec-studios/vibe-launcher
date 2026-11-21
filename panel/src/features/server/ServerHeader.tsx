import { ArrowLeft, Play, RotateCw, Square, Zap } from "lucide-react";
import type { ServerView } from "@/api/types";
import { useAgent } from "@/app/agent";
import { useT } from "@/i18n";
import { Button, CopyField, useConfirm } from "@/components/ui";
import { usePower } from "@/features/servers/actions";
import { isActive, joinAddress } from "@/features/servers/meta";
import { ServerIcon, SoftwareLabel, StatusBadge } from "@/features/servers/parts";

export function ServerHeader({ server: s }: { server: ServerView }) {
  const t = useT();
  const { base, can } = useAgent();
  const power = usePower(s.id);
  const confirm = useConfirm();
  const state = s.status?.state ?? "stopped";
  const active = isActive(s.status);
  const addr = joinAddress(s.status);
  const control = can("servers.control");
  return (
    <div className="flex flex-col gap-4">
      <a href={`#${base}/servers`} className="flex w-fit items-center gap-1.5 text-meta text-muted hover:text-text">
        <ArrowLeft size={14} />
        {t("nav.servers")}
      </a>
      <div className="flex flex-col gap-4 rounded-card bg-surface p-5 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <ServerIcon server={s} size={52} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-title font-bold">{s.name}</h1>
              <StatusBadge status={s.status} install={s.install_state} />
            </div>
            <div className="mt-0.5 text-meta text-muted">
              <SoftwareLabel server={s} />
              {state === "running" && ` · ${t("servers.players_online", { n: s.status?.players.length ?? 0, max: s.status?.max_players ?? "?" })}`}
            </div>
          </div>
        </div>
        {addr && (
          <div className="flex min-w-0 flex-col gap-1 lg:w-80">
            <span className="text-caption font-semibold text-muted">{t("server.join_address")}</span>
            <CopyField value={addr} />
          </div>
        )}
        {control && (
          <div className="flex flex-wrap gap-2">
            {!active ? (
              <Button variant="primary" size="lg" icon={<Play size={16} />} loading={power.isPending} disabled={s.install_state !== "installed" || !s.eula} onClick={() => power.mutate("start")}>
                {t("power.start")}
              </Button>
            ) : (
              <>
                <Button variant="ghost" size="lg" icon={<RotateCw size={16} />} disabled={state !== "running" || power.isPending} onClick={() => power.mutate("restart")}>
                  {t("power.restart")}
                </Button>
                <Button variant="ghost" size="lg" icon={<Square size={15} />} disabled={state === "stopping" || power.isPending} onClick={() => power.mutate("stop")}>
                  {t("power.stop")}
                </Button>
                {state === "stopping" && (
                  <Button
                    variant="danger"
                    size="lg"
                    icon={<Zap size={15} />}
                    onClick={async () => (await confirm.ask({ title: t("power.kill_title"), body: t("power.kill_desc"), confirm: t("power.kill"), danger: true })) && power.mutate("kill")}
                  >
                    {t("power.kill")}
                  </Button>
                )}
              </>
            )}
          </div>
        )}
      </div>
      {confirm.node}
    </div>
  );
}
