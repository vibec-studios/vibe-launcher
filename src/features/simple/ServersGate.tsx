import { useT } from "@/i18n";
import { ServersPage as RealServersPage } from "@/features/servers/ServersPage";
import { ServerPage as RealServerPage } from "@/features/servers/ServerPage";
import { ExpertGate } from "./ExpertHint";

function Gate({ children }: { children: React.ReactNode }) {
  const t = useT();
  return (
    <ExpertGate title={t("usab.servers.title")} text={t("usab.servers.text")}>
      {children}
    </ExpertGate>
  );
}

export function ServersPage() {
  return (
    <Gate>
      <RealServersPage />
    </Gate>
  );
}

export function ServerPage() {
  return (
    <Gate>
      <RealServerPage />
    </Gate>
  );
}
