// Einstellungen eines Plugin-Servers: installierter Build der Software und Update auf einen neueren Build.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpCircle } from "lucide-react";
import { waitForTask, useServerStatus } from "@/lib/queries";
import type { Server } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { Button, Select, SettingRow, SettingsCard, Skeleton, Switch, toast } from "@/components/ui";
import { useT, t as tt } from "@/i18n";
import { useServerTask } from "./actions";
import { addonApi, aqk, platformNames } from "./addonsApi";

export function PlatformCard({ server }: { server: Server }) {
  const t = useT();
  const p = server.platform!;
  const st = useServerStatus(server.id);
  const task = useServerTask(server.id);
  const active = !!st && st.state !== "stopped" && st.state !== "crashed";
  const [experimental, setExperimental] = useState(false);
  const [pick, setPick] = useState<string | null>(null);
  const builds = useQuery({
    queryKey: aqk.platformBuilds(p.kind, server.mc_version),
    queryFn: () => addonApi.platformBuilds(p.kind, server.mc_version),
    staleTime: 5 * 60_000,
  });
  const current = builds.data?.find((b) => b.id === p.build);
  const latestStable = builds.data?.find((b) => b.channel === "stable");
  const shown = useMemo(
    () => (builds.data ?? []).filter((b) => experimental || b.channel === "stable" || b.id === p.build),
    [builds.data, experimental, p.build],
  );
  const newer = latestStable && p.build && Number(latestStable.id) > Number(p.build) ? latestStable : null;
  const target = pick ?? newer?.id ?? null;

  const apply = async (build: string) => {
    try {
      const id = await addonApi.platformSetBuild(server.id, build);
      toast.info(tt("srv.platform.updating", { build }), server.name);
      waitForTask(id)
        .then(() => toast.success(tt("srv.platform.updated", { build }), server.name))
        .catch((e) => toast.error(e, tt("srv.platform.update_failed")));
      setPick(null);
    } catch (e) {
      toast.error(e, tt("srv.platform.update_failed"));
    }
  };

  const ch = (c: string) => (c === "stable" ? t("srv.platform.stable") : c === "beta" ? t("srv.platform.beta") : t("srv.platform.alpha"));

  return (
    <SettingsCard title={t("srv.platform.card", { name: platformNames[p.kind] })}>
      <SettingRow
        title={t("srv.platform.current", {
          name: platformNames[p.kind],
          mc: server.mc_version,
        })}
        description={
          builds.isLoading
            ? undefined
            : current
              ? `#${current.id} · ${ch(current.channel)}${current.time ? ` · ${formatDate(current.time)}` : ""}`
              : p.build
                ? `#${p.build}`
                : t("srv.platform.not_installed")
        }
      >
        {newer ? (
          <span className="text-[12.5px] font-medium text-accent">{t("srv.platform.newer", { build: newer.id })}</span>
        ) : builds.data && p.build ? (
          <span className="text-[12.5px] text-dim">{t("srv.platform.up_to_date")}</span>
        ) : null}
      </SettingRow>
      <SettingRow title={t("srv.platform.change")} description={active ? t("srv.platform.stop_first") : t("srv.platform.change.desc")} stacked>
        {builds.isLoading ? (
          <Skeleton className="h-9" />
        ) : (
          <div className="flex items-center gap-3">
            <Select
              className="min-w-0 flex-1"
              value={target}
              onChange={setPick}
              placeholder={t("srv.platform.pick_build")}
              options={shown.slice(0, 80).map((b) => ({
                value: b.id,
                label: `#${b.id} · ${ch(b.channel)}${b.id === p.build ? ` · ${t("srv.platform.installed")}` : ""}`,
                hint: b.time ? formatDate(b.time) : undefined,
              }))}
            />
            <label className="flex shrink-0 cursor-pointer items-center gap-2 text-caption font-semibold text-dim">
              {t("srv.platform.experimental")}
              <Switch checked={experimental} onChange={setExperimental} label={t("srv.platform.experimental")} />
            </label>
            <Button icon={<ArrowUpCircle size={14} />} disabled={!target || target === p.build || active || !!task} onClick={() => target && apply(target)}>
              {t("srv.platform.install_build")}
            </Button>
          </div>
        )}
      </SettingRow>
    </SettingsCard>
  );
}
