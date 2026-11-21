import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { useState } from "react";
import { Button, Dialog, ErrorState, Skeleton, toast } from "@/components/ui";
import { Term } from "@/features/help/glossary/Term";
import { copyText } from "@/features/logs/logText";
import { useT } from "@/i18n";
import { api } from "@/lib/api";
import { isRunning, useGameState } from "@/lib/gameStore";
import { formatLoader } from "@/lib/format";
import { waitForTask } from "@/lib/queries";
import type { Instance, QuickMod } from "@/lib/types";

const COMMANDS = ["/sparkc profiler start", "/sparkc profiler stop"];

export function QuickModDialog({ instance, tool, onClose }: { instance: Instance; tool: QuickMod; onClose: () => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const running = isRunning(useGameState(instance.id));
  const [busy, setBusy] = useState(false);
  const query = useQuery({
    queryKey: ["quick-mod", instance.id, instance.mc_version, instance.loader.kind, tool],
    queryFn: () => api.quickModStatus(instance.id, tool),
    retry: false,
  });
  const data = query.data;
  const canInstall = data?.status === "available" || data?.status === "disabled";

  const install = async () => {
    setBusy(true);
    try {
      await waitForTask(await api.quickModInstall(instance.id, tool));
      toast.success(t("quick_mod.ready", { name: t(`quick_mod.${tool}.title`) }));
    } catch (error) {
      toast.error(error);
    } finally {
      void queryClient.invalidateQueries({ queryKey: ["content", instance.id] });
      await query.refetch();
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title={t(`quick_mod.${tool}.title`)}
      description={t(`quick_mod.${tool}.description`)} size="md"
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>{t("common.close")}</Button>
          {canInstall && (
            <Button variant="primary" onClick={() => void install()} disabled={running || query.isError} loading={busy}>
              {t(data.status === "disabled" ? "quick_mod.enable" : "quick_mod.install")}
            </Button>
          )}
        </>
      }>
      <div className="flex flex-col gap-4 text-[13px] text-muted">
        {query.isPending ? <Skeleton className="h-10" /> : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <div className="rounded-ctl bg-surface2 p-3" aria-live="polite">
            {data?.status === "available" ? (
              t("quick_mod.available", { version: data.version, mc: instance.mc_version, loader: formatLoader(instance.loader) })
            ) : data?.status === "unavailable" && instance.loader.kind === "vanilla" ? (
              <>{t("quick_mod.needs_loader")} <Term id="loader" /></>
            ) : t(`quick_mod.${data?.status ?? "unavailable"}`)}
            {running && canInstall && <p className="mt-1 text-warn">{t("quick_mod.stop_first")}</p>}
          </div>
        )}
        {tool === "spark" ? (
          <div className="space-y-2">
            <p>{t("quick_mod.spark.guide")}</p>
            <ol className="flex flex-col gap-1.5">
              {COMMANDS.map((command, index) => (
                <li key={command} className="flex flex-wrap items-center justify-between gap-2 rounded-ctl bg-surface2 px-3 py-1.5">
                  <div>
                    <p className="text-text">{t(index === 0 ? "quick_mod.spark.start" : "quick_mod.spark.stop")}</p>
                    <code className="selectable">{command}</code>
                  </div>
                  <Button size="sm" variant="ghost" icon={<Copy size={13} />} onClick={() => void copyText(command)}>{t("common.copy")}</Button>
                </li>
              ))}
            </ol>
            <p>{t("quick_mod.spark.report")}</p>
          </div>
        ) : <p>{t("quick_mod.replaymod.guide")}</p>}
      </div>
    </Dialog>
  );
}
