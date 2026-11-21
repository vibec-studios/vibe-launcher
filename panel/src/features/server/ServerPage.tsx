import { Archive, FolderOpen, Gauge, Puzzle, Radio, Settings2, SquareTerminal, Users } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { useAgent, useServer } from "@/app/agent";
import { navigate } from "@/app/router";
import { useT, type Key } from "@/i18n";
import { Button, Notice, Spinner, Tabs, toast } from "@/components/ui";
import { TaskProgress } from "@/components/TaskProgress";
import { ServerHeader } from "./ServerHeader";
import { OverviewTab } from "./OverviewTab";
import { ConsoleTab } from "./console/ConsoleTab";
import { PlayersTab } from "./players/PlayersTab";
import { SettingsTab } from "./settings/SettingsTab";
import { FilesTab } from "./files/FilesTab";
import { BackupsTab } from "./BackupsTab";
import { AddonsTab } from "./addons/AddonsTab";
import { ConnectionTab } from "./ConnectionTab";

const TABS = ["overview", "console", "players", "settings", "files", "backups", "addons", "connection"] as const;
export type ServerTab = (typeof TABS)[number];

const ICONS: Record<ServerTab, React.ReactNode> = {
  overview: <Gauge size={15} />,
  console: <SquareTerminal size={15} />,
  players: <Users size={15} />,
  settings: <Settings2 size={15} />,
  files: <FolderOpen size={15} />,
  backups: <Archive size={15} />,
  addons: <Puzzle size={15} />,
  connection: <Radio size={15} />,
};

export function ServerPage({ id, tab }: { id: string; tab: string | undefined }) {
  const t = useT();
  const { base, api, can, tasks } = useAgent();
  const server = useServer(id);
  const eula = useMutation({ mutationFn: () => api.acceptEula(id), onError: (e) => toast.error(e) });
  const current: ServerTab = (TABS as readonly string[]).includes(tab ?? "") ? (tab as ServerTab) : "overview";
  const visible = TABS.filter((k) => (k === "files" ? can("files.read") : true));
  if (server.isLoading) return <div className="flex justify-center py-20 text-muted"><Spinner size={24} /></div>;
  if (server.error || !server.data) {
    return (
      <Notice tone="danger" title={t("server.not_found")} actions={<Button onClick={() => navigate(`${base}/servers`)}>{t("common.back")}</Button>}>
        {(server.error as Error | null)?.message}
      </Notice>
    );
  }
  const s = server.data;
  const installTask = [...tasks.values()].find((x) => x.instance_id === `server:${id}` && x.status === "running");
  const isPlugin = !!s.platform;
  return (
    <div className="flex flex-col gap-5">
      <ServerHeader server={s} />
      {s.install_state === "installing" && installTask && <TaskProgress taskId={installTask.id} />}
      {s.install_state === "installed" && !s.eula && can("servers.manage") && (
        <Notice
          tone="warn"
          title={t("eula.title")}
          actions={
            <Button variant="primary" loading={eula.isPending} onClick={() => eula.mutate()}>
              {t("eula.accept")}
            </Button>
          }
        >
          {t("eula.desc")}{" "}
          <a className="font-semibold underline" href="https://aka.ms/MinecraftEULA" target="_blank" rel="noreferrer">
            {t("eula.read")}
          </a>
        </Notice>
      )}
      <Tabs
        value={current}
        onChange={(k) => navigate(`${base}/servers/${encodeURIComponent(id)}/${k}`, true)}
        items={visible.map((k) => ({ key: k, icon: ICONS[k], label: k === "addons" ? t(isPlugin ? "tab.plugins" : "tab.mods") : t(`tab.${k}` as Key) }))}
      />
      <div>
        {current === "overview" && <OverviewTab server={s} />}
        {current === "console" && <ConsoleTab server={s} />}
        {current === "players" && <PlayersTab server={s} />}
        {current === "settings" && <SettingsTab server={s} />}
        {current === "files" && <FilesTab server={s} />}
        {current === "backups" && <BackupsTab server={s} />}
        {current === "addons" && <AddonsTab server={s} />}
        {current === "connection" && <ConnectionTab server={s} />}
      </div>
    </div>
  );
}
