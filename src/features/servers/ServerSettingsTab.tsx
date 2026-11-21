// Einstellungen eines Servers: Server-Modell (automatisch gespeichert) und server.properties als Formular
// oder Rohtext. Änderungen an server.properties wirken beim nächsten Start.
import { useNavigate } from "@tanstack/react-router";
import { FolderOpen, Trash2, Wrench } from "lucide-react";
import { useServerStatus } from "@/lib/queries";
import type { Server } from "@/lib/types";
import { Button, SettingRow, SettingsCard } from "@/components/ui";
import { useT } from "@/i18n";
import { openServerFolder, removeServer, repairServer, useServerTask } from "./actions";
import { PlatformCard } from "./PlatformCard";
import { ModelCards } from "./settings/ModelCards";
import { PropertiesCard } from "./settings/PropertiesCard";

// ------------------------------------------------------------------ Tab

export function ServerSettingsTab({ server }: { server: Server }) {
  const t = useT();
  const nav = useNavigate();
  const st = useServerStatus(server.id);
  const task = useServerTask(server.id);
  const active = !!st && st.state !== "stopped" && st.state !== "crashed";

  return (
    <div className="relative h-full">
      <div className="scroll h-full">
        <div className="grid w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-5 px-6 py-5">
          <div className="flex flex-col gap-5">
            <ModelCards server={server} />
            <SettingsCard title={t("isettings.danger")} danger>
              <SettingRow title={t("srv.repair")} description={t("srv.repair.desc")}>
                <Button icon={<Wrench size={14} />} disabled={active || !!task} onClick={() => repairServer(server)}>
                  {t("srv.repair")}
                </Button>
              </SettingRow>
              <SettingRow title={t("common.open_folder")} description={t("srv.folder.desc")}>
                <Button icon={<FolderOpen size={14} />} onClick={() => openServerFolder(server)}>
                  {t("common.open_folder")}
                </Button>
              </SettingRow>
              <SettingRow title={t("srv.delete")} description={t("srv.delete.desc")}>
                <Button variant="danger" icon={<Trash2 size={14} />} disabled={active} onClick={() => removeServer(server, () => nav({ to: "/servers" }))}>
                  {t("common.delete")}
                </Button>
              </SettingRow>
            </SettingsCard>
          </div>
          <div className="flex flex-col gap-5">
            {server.platform && <PlatformCard server={server} />}
            <PropertiesCard server={server} />
          </div>
        </div>
      </div>
    </div>
  );
}
