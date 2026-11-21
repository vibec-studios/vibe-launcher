import { useState } from "react";
import { Package, Play, Plus, Square, Users } from "lucide-react";
import type { ServerView } from "@/api/types";
import { useAgent, useServers } from "@/app/agent";
import { useT } from "@/i18n";
import { Button, CopyField, Empty, Notice } from "@/components/ui";
import { PageTitle } from "@/components/Shell";
import { usePower } from "./actions";
import { isActive, joinAddress } from "./meta";
import { ServerIcon, SoftwareLabel, StatusBadge } from "./parts";
import { CreateWizard } from "./create/CreateWizard";
import { ModpackDialog } from "./ModpackDialog";

function ServerCard({ s }: { s: ServerView }) {
  const t = useT();
  const { base, can } = useAgent();
  const power = usePower(s.id);
  const active = isActive(s.status);
  const addr = joinAddress(s.status);
  const href = `#${base}/servers/${encodeURIComponent(s.id)}`;
  return (
    <div className="flex flex-col rounded-card bg-surface transition-colors hover:bg-surface2">
      <a href={href} className="flex items-start gap-4 p-5 pb-3">
        <ServerIcon server={s} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15.5px] font-semibold">{s.name}</div>
          <div className="mt-0.5 text-meta text-muted">
            <SoftwareLabel server={s} />
          </div>
        </div>
        <StatusBadge status={s.status} install={s.install_state} />
      </a>
      <div className="flex flex-col gap-3 px-5 pb-5">
        <div className="flex items-center gap-2 text-meta text-muted">
          <Users size={14} />
          {s.status?.state === "running" ? t("servers.players_online", { n: s.status.players.length, max: s.status.max_players ?? "?" }) : t("servers.offline")}
        </div>
        {addr ? <CopyField value={addr} /> : <div className="h-9 truncate rounded-ctl bg-field/60 px-3 text-meta leading-9 text-dim">{active ? t("servers.no_public") : t("servers.start_for_address")}</div>}
        {can("servers.control") && (
          <div className="flex gap-2">
            {active ? (
              <Button className="flex-1" variant="ghost" icon={<Square size={14} />} loading={power.isPending} disabled={s.status?.state === "stopping"} onClick={() => power.mutate("stop")}>
                {t("power.stop")}
              </Button>
            ) : (
              <Button className="flex-1" variant="primary" icon={<Play size={14} />} loading={power.isPending} disabled={s.install_state !== "installed" || !s.eula} onClick={() => power.mutate("start")}>
                {t("power.start")}
              </Button>
            )}
            <a href={href} className="inline-flex h-9 items-center rounded-ctl px-4 text-[13.5px] font-semibold text-muted hover:bg-white/[.06] hover:text-text">
              {t("servers.manage")}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

export function ServersPage() {
  const t = useT();
  const { info, can, remote } = useAgent();
  const servers = useServers();
  const [creating, setCreating] = useState(false);
  const [pack, setPack] = useState(false);
  const manage = can("servers.manage");
  return (
    <>
      <PageTitle
        title={t("servers.title")}
        desc={remote ? t("servers.desc_remote", { name: info.name }) : t("servers.desc", { name: info.name })}
        actions={
          manage && (
            <>
              <Button variant="ghost" icon={<Package size={16} />} onClick={() => setPack(true)}>
                {t("servers.upload_pack")}
              </Button>
              <Button variant="primary" icon={<Plus size={16} />} onClick={() => setCreating(true)}>
                {t("servers.new")}
              </Button>
            </>
          )
        }
      />
      {servers.error && <Notice tone="danger">{(servers.error as Error).message}</Notice>}
      {servers.isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-[212px]" />
          ))}
        </div>
      )}
      {servers.data?.length === 0 && (
        <div className="rounded-card bg-surface">
          <Empty
            icon={<Plus size={34} />}
            title={t("servers.empty")}
            action={
              manage && (
                <div className="flex flex-wrap justify-center gap-2">
                  <Button variant="primary" icon={<Plus size={16} />} onClick={() => setCreating(true)}>
                    {t("servers.new")}
                  </Button>
                  <Button variant="ghost" icon={<Package size={16} />} onClick={() => setPack(true)}>
                    {t("servers.upload_pack")}
                  </Button>
                </div>
              )
            }
          >
            {t("servers.empty_desc")}
          </Empty>
        </div>
      )}
      {!!servers.data?.length && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {servers.data.map((s) => (
            <ServerCard key={s.id} s={s} />
          ))}
        </div>
      )}
      <CreateWizard open={creating} onClose={() => setCreating(false)} />
      <ModpackDialog open={pack} onClose={() => setPack(false)} />
    </>
  );
}
