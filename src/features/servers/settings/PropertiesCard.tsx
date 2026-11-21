import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { api } from "@/lib/api";
import { sqk, useServerStatus } from "@/lib/queries";
import type { Server } from "@/lib/types";
import { ErrorState, Segmented, SettingsCard, Skeleton, Tooltip } from "@/components/ui";
import { useT } from "@/i18n";
import { PropsForm } from "./PropsForm";
import { RawEditor } from "./RawEditor";

export function PropertiesCard({ server }: { server: Server }) {
  const t = useT();
  const st = useServerStatus(server.id);
  const [mode, setMode] = useState<"form" | "raw">("form");
  const props = useQuery({ queryKey: sqk.properties(server.id), queryFn: () => api.serverPropertiesGet(server.id), staleTime: 30_000 });
  const values = useMemo(() => (props.data ? Object.fromEntries(props.data) : null), [props.data]);
  const active = st?.state === "running" || st?.state === "starting";

  return (
    <SettingsCard
      title={
        <Tooltip content="server.properties">
          <span>{t("srv.settings.props")}</span>
        </Tooltip>
      }
      right={<Segmented value={mode} onChange={setMode} items={[{ value: "form", label: t("srv.prop.form") }, { value: "raw", label: t("srv.prop.raw") }]} />}
    >
      <div className={`flex items-center gap-2 border-b border-line px-4 py-2 text-[12px] ${active ? "text-warn" : "text-dim"}`}>
        <Info size={13} className="shrink-0" />
        {t("srv.prop.next_start")}
      </div>
      {mode === "raw" ? (
        <RawEditor server={server} onSaved={() => {}} />
      ) : props.isError && !values ? (
        <ErrorState error={props.error} onRetry={() => props.refetch()} />
      ) : !values ? (
        <div className="flex flex-col gap-3 px-4 py-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : (
        <PropsForm server={server} values={values} />
      )}
    </SettingsCard>
  );
}
