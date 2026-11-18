// Plugin-Server-Software wählen: Paper / Purpur / Folia, Minecraft-Version (aus der API der Software) und Build
// (stabil vorausgewählt, experimentelle Builds auf Wunsch). Aufbau wie der VersionPicker der Mod-Loader.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
import type { ServerPlatformKind } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { ErrorState, Field, SearchInput, Segmented, Select, Skeleton, Switch, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { PLATFORMS, addonApi, aqk, platformNames, type PlatformBuild } from "./addonsApi";

export interface PlatformValue {
  kind: ServerPlatformKind;
  mc: string | null;
  build: string | null;
}

const platformColors: Record<ServerPlatformKind, string> = {
  paper: "#e8e8e8",
  purpur: "#c58cff",
  folia: "#7fc8a9",
};

/** Neuester stabiler Build, sonst neuester. */
export function pickBuild(list: PlatformBuild[] | undefined): string | null {
  if (!list?.length) return null;
  return (list.find((b) => b.channel === "stable") ?? list[0]).id;
}

export function PlatformPicker({
  value,
  onChange,
  listHeight = 262,
  render,
}: {
  value: PlatformValue;
  onChange: (v: PlatformValue) => void;
  listHeight?: number;
  render: (parts: { platform: ReactNode; list: ReactNode; build: ReactNode; hint: ReactNode }) => ReactNode;
}) {
  const t = useT();
  const [pre, setPre] = useState(false);
  const [experimental, setExperimental] = useState(false);
  const [query, setQuery] = useState("");
  const versions = useQuery({
    queryKey: aqk.platformVersions(value.kind),
    queryFn: () => addonApi.platformVersions(value.kind),
    staleTime: 10 * 60_000,
  });
  const builds = useQuery({
    queryKey: aqk.platformBuilds(value.kind, value.mc ?? ""),
    queryFn: () => addonApi.platformBuilds(value.kind, value.mc!),
    enabled: !!value.mc,
    staleTime: 5 * 60_000,
  });

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (versions.data ?? []).filter((v) => (pre || v.release) && (!q || v.id.toLowerCase().includes(q)));
  }, [versions.data, pre, query]);

  // Gültige Version halten: beim Wechsel der Software neueste Release wählen
  useEffect(() => {
    const all = versions.data;
    if (!all) return;
    if (!value.mc || !all.some((v) => v.id === value.mc)) {
      const first = all.find((v) => v.release) ?? all[0];
      if (first && first.id !== value.mc) onChange({ ...value, mc: first.id, build: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versions.data, value.kind]);

  const shownBuilds = useMemo(() => {
    const all = builds.data ?? [];
    const stable = all.filter((b) => b.channel === "stable");
    return experimental || stable.length === 0 ? all : stable;
  }, [builds.data, experimental]);

  // Build vorauswählen (neuester stabiler)
  useEffect(() => {
    if (!builds.data) return;
    if (!value.build || !shownBuilds.some((b) => b.id === value.build)) {
      const pick = pickBuild(shownBuilds);
      if (pick !== value.build) onChange({ ...value, build: pick });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [builds.data, shownBuilds, value.mc, value.build]);

  const channelLabel = (c: PlatformBuild["channel"]) =>
    c === "stable" ? t("srv.platform.stable") : c === "beta" ? t("srv.platform.beta") : t("srv.platform.alpha");
  const noStable = !!builds.data?.length && !builds.data.some((b) => b.channel === "stable");

  const platform = (
    <div className="flex flex-col gap-1.5">
      <span className="label">{t("srv.platform.software")}</span>
      <Segmented<ServerPlatformKind>
        value={value.kind}
        onChange={(kind) => kind !== value.kind && onChange({ kind, mc: null, build: null })}
        items={PLATFORMS.map((k) => ({
          value: k,
          label: (
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-dot" style={{ background: platformColors[k] }} />
              {platformNames[k]}
            </span>
          ),
        }))}
        className="w-full [&>button]:flex-1"
      />
    </div>
  );

  const listNode = (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <span className="label flex-1">{t("newinst.version")}</span>
        <label className="flex cursor-pointer items-center gap-2 text-caption font-semibold text-dim">
          {t("srv.platform.prereleases")}
          <Switch checked={pre} onChange={setPre} label={t("srv.platform.prereleases")} />
        </label>
      </div>
      <SearchInput value={query} onChange={setQuery} placeholder={t("newinst.version_search")} />
      <div className="scroll rounded-card bg-surface" style={{ height: listHeight }} role="listbox" aria-label={t("newinst.version")}>
        {versions.isError ? (
          <ErrorState error={versions.error} onRetry={() => versions.refetch()} className="py-8" />
        ) : !versions.data ? (
          <div className="flex flex-col gap-px p-1">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-[33px]" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13px] text-dim">{t("newinst.no_versions")}</div>
        ) : (
          list.map((v) => {
            const active = v.id === value.mc;
            return (
              <button
                key={v.id}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => v.id !== value.mc && onChange({ ...value, mc: v.id, build: null })}
                className={cn(
                  "flex h-[34px] w-full items-center gap-3 px-3 text-left text-[13px] transition-colors duration-100",
                  active ? "bg-white/[.07] text-text" : "text-text hover:bg-white/[.04]",
                )}
              >
                <span className="w-4 text-accent">{active && <Check size={14} />}</span>
                <span className="flex-1 tabular-nums">{v.id}</span>
                {!v.release && <span className="text-caption font-medium text-warn">{t("srv.platform.prerelease")}</span>}
                {v.supported && <span className="text-caption font-medium text-ok">{t("srv.platform.supported")}</span>}
                {v.java_min && <span className="w-[56px] text-right text-caption tabular-nums text-dim">Java {v.java_min}</span>}
              </button>
            );
          })
        )}
      </div>
    </div>
  );

  const buildNode = (
    <Field
      label={
        <span className="flex items-center gap-3">
          <span className="flex-1">{t("srv.platform.build", { name: platformNames[value.kind] })}</span>
          <label className="flex cursor-pointer items-center gap-2 text-caption font-semibold normal-case text-dim">
            {t("srv.platform.experimental")}
            <Switch checked={experimental} onChange={setExperimental} label={t("srv.platform.experimental")} />
          </label>
        </span>
      }
      hint={noStable ? t("srv.platform.no_stable") : undefined}
      error={builds.isError ? String((builds.error as { message?: string })?.message ?? builds.error) : undefined}
    >
      {value.mc && builds.isLoading ? (
        <Skeleton className="h-9" />
      ) : (
        <Select
          value={value.build}
          onChange={(b) => onChange({ ...value, build: b })}
          placeholder={!value.mc ? t("newinst.pick_version_first") : t("srv.platform.no_builds")}
          disabled={!shownBuilds.length}
          options={shownBuilds.slice(0, 80).map((b) => ({
            value: b.id,
            label: `#${b.id} · ${channelLabel(b.channel)}`,
            hint: b.time ? formatDate(b.time) : undefined,
          }))}
        />
      )}
    </Field>
  );

  const hint = (
    <p className="text-[12px] leading-relaxed text-dim">
      {value.kind === "folia" ? t("srv.platform.hint.folia") : value.kind === "purpur" ? t("srv.platform.hint.purpur") : t("srv.platform.hint.paper")}{" "}
      {t("srv.platform.hint.spigot")}
    </p>
  );

  return <>{render({ platform, list: listNode, build: buildNode, hint })}</>;
}
