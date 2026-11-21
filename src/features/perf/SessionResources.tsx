import { useQuery } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Activity, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Dialog, ErrorState, IconButton, toast } from "@/components/ui";
import { Term } from "@/features/help/glossary/Term";
import { useLang, useT } from "@/i18n";
import { api } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import type { GameState } from "@/lib/types";

interface Props {
  runs: GameState[];
  name: (run: GameState) => string;
}

function ResourceDialog({ runs, name, close }: Props & { close: () => void }) {
  const t = useT();
  const lang = useLang((state) => state.lang);
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  const enabled = visible && runs.some((run) => run.state === "running");
  const query = useQuery({
    queryKey: ["game-resources"],
    queryFn: api.gameResources,
    enabled,
    refetchInterval: enabled ? 3000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
    gcTime: 0,
  });
  const readings = new Map(query.data?.map((reading) => [reading.run_id, reading]));
  const number = new Intl.NumberFormat(lang, { maximumFractionDigits: 1, style: "percent" });

  return (
    <Dialog open onOpenChange={(open) => !open && close()} size="md" title={t("monitor.title")}
      description={t("monitor.description")}
      footer={<Button variant="subtle" onClick={close}>{t("common.close")}</Button>}>
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      {runs.length ? (
        <ul className="flex flex-col gap-2">
          {runs.map((run) => {
            const data = readings.get(run.run_id);
            const cpu = data?.cpu_percent;
            const ram = data?.memory_bytes;
            const report = data?.spark_report;
            return (
              <li key={run.run_id} className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-surface2 p-3">
                <div className="min-w-0">
                  <h3 className="break-words text-sm font-semibold text-text">{name(run)}</h3>
                  {run.account_name && <p className="text-caption text-muted">{run.account_name}</p>}
                </div>
                {run.state === "preparing" ? <p className="text-caption text-muted">{t("sess.preparing")}</p> : (
                  <dl className="grid grid-cols-2 gap-4 text-caption tabular-nums">
                    <div>
                      <dt className="text-muted">{t("monitor.cpu")}</dt>
                      <dd className="text-sm font-medium text-text">{cpu == null ? "–" : number.format(cpu / 100)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted"><Term id="ram">{t("monitor.ram")}</Term></dt>
                      <dd className="text-sm font-medium text-text">{ram == null ? "–" : formatBytes(ram)}</dd>
                    </div>
                  </dl>
                )}
                {report && (
                  <Button size="sm" variant="ghost" icon={<ExternalLink size={13} />} onClick={() => void openUrl(report).catch((e) => toast.error(e))}>
                    {t("monitor.report")}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      ) : <p className="text-sm text-muted">{t("monitor.empty")}</p>}
      {!!runs.length && <p className="mt-3 text-caption text-muted">{t("monitor.cpu_hint")}</p>}
    </Dialog>
  );
}

export function SessionResources({ runs, name }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      {!!runs.length && (
        <IconButton label={t("monitor.title")} tip variant="ghost" size="sm" onClick={() => setOpen(true)}>
          <Activity size={16} />
        </IconButton>
      )}
      {open && <ResourceDialog runs={runs} name={name} close={() => setOpen(false)} />}
    </>
  );
}
