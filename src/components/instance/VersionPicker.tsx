// Minecraft-Version + Loader + Loader-Version wählen. Wird im „Neue Instanz“-Dialog und in den
// Instanz-Einstellungen („Version ändern“) benutzt.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Check } from "lucide-react";
import { api } from "@/lib/api";
import { qk, useGameVersions, useSettings } from "@/lib/queries";
import type { LoaderKind, LoaderVersion, McVersion } from "@/lib/types";
import { loaderColors, loaderNames } from "@/lib/format";
import { ErrorState, Field, SearchInput, Segmented, Select, Skeleton, Switch, cn } from "@/components/ui";
import { useT } from "@/i18n";

export const LOADERS: LoaderKind[] = ["vanilla", "fabric", "quilt", "forge", "neoforge"];

export function useLoaderGameVersions(loader: LoaderKind) {
  return useQuery({
    queryKey: qk.loaderGameVersions(loader),
    queryFn: () => api.loaderGameVersions(loader),
    enabled: loader !== "vanilla",
    staleTime: 10 * 60_000,
    placeholderData: undefined,
  });
}

export function useLoaderVersions(loader: LoaderKind, mc: string | null) {
  return useQuery({
    queryKey: qk.loaderVersions(loader, mc ?? ""),
    queryFn: () => api.loaderVersions(loader, mc!),
    enabled: loader !== "vanilla" && !!mc,
    staleTime: 10 * 60_000,
    placeholderData: undefined,
  });
}

/** Empfohlene Loader-Version: erste stabile, sonst erste. */
export function pickLoaderVersion(list: LoaderVersion[] | undefined): string | null {
  if (!list?.length) return null;
  return (list.find((v) => v.stable) ?? list[0]).version;
}

const kindLabel = (k: McVersion["kind"], t: (k: string) => string) =>
  k === "release" ? t("newinst.kind.release") : k === "snapshot" ? t("newinst.kind.snapshot") : t("newinst.kind.old");

export interface VersionValue {
  mc: string | null;
  loader: LoaderKind;
  loaderVersion: string | null;
}

export function VersionPicker({
  value,
  onChange,
  listHeight = 300,
  render,
}: {
  value: VersionValue;
  onChange: (v: VersionValue) => void;
  listHeight?: number;
  /** Eigene Anordnung der drei Teile (Loader, Versionsliste, Loader-Version) */
  render?: (parts: { loader: ReactNode; list: ReactNode; loaderVersion: ReactNode }) => ReactNode;
}) {
  const t = useT();
  const { data: settings } = useSettings();
  const versions = useGameVersions();
  const [query, setQuery] = useState("");
  const [snapshots, setSnapshots] = useState<boolean>(settings?.show_snapshots ?? false);
  const supported = useLoaderGameVersions(value.loader);
  const loaderVersions = useLoaderVersions(value.loader, value.mc);

  const list = useMemo(() => {
    const all = versions.data ?? [];
    const sup = value.loader !== "vanilla" ? new Set(supported.data ?? []) : null;
    const q = query.trim().toLowerCase();
    return all.filter((v) => (snapshots || v.kind === "release") && (!sup || sup.has(v.id)) && (!q || v.id.toLowerCase().includes(q)));
  }, [versions.data, supported.data, value.loader, snapshots, query]);

  // Auswahl gültig halten: wenn die gewählte Version beim Loader-Wechsel wegfällt -> neueste Release
  const loading = versions.isLoading || (value.loader !== "vanilla" && supported.isLoading);
  useEffect(() => {
    if (loading || !versions.data) return;
    const sup = value.loader !== "vanilla" ? new Set(supported.data ?? []) : null;
    const ok = (id: string | null) => !!id && (!sup || sup.has(id)) && versions.data!.some((v) => v.id === id);
    if (!ok(value.mc)) {
      const first = versions.data.find((v) => v.kind === "release" && (!sup || sup.has(v.id))) ?? versions.data.find((v) => !sup || sup.has(v.id));
      if (first?.id !== value.mc) onChange({ ...value, mc: first?.id ?? null, loaderVersion: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, versions.data, supported.data, value.loader]);

  // Loader-Version vorauswählen
  useEffect(() => {
    if (value.loader === "vanilla") {
      if (value.loaderVersion !== null) onChange({ ...value, loaderVersion: null });
      return;
    }
    const lv = loaderVersions.data;
    if (!lv) return;
    if (!value.loaderVersion || !lv.some((v) => v.version === value.loaderVersion)) {
      const pick = pickLoaderVersion(lv);
      if (pick !== value.loaderVersion) onChange({ ...value, loaderVersion: pick });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaderVersions.data, value.loader, value.mc, value.loaderVersion]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({ count: list.length, getScrollElement: () => scrollRef.current, estimateSize: () => 34, overscan: 8 });

  // Gewählte Version beim Öffnen sichtbar machen
  const scrolledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!value.mc || scrolledFor.current === value.mc) return;
    const idx = list.findIndex((x) => x.id === value.mc);
    if (idx >= 0) {
      scrolledFor.current = value.mc;
      v.scrollToIndex(idx, { align: "auto" });
    }
  }, [list, value.mc, v]);

  const lvOptions = (loaderVersions.data ?? []).map((x) => ({
    value: x.version,
    label: x.version,
    hint: x.stable ? t("newinst.stable") : t("newinst.beta"),
  }));

  const loaderNode = (
    <div className="flex flex-col gap-1.5">
      <span className="label">{t("newinst.loader")}</span>
      <Segmented
        value={value.loader}
        onChange={(loader) => loader !== value.loader && onChange({ ...value, loader, loaderVersion: null })}
        items={LOADERS.map((l) => ({
          value: l,
          label: (
            <span className="flex items-center gap-2">
              <span className="h-2 w-2" style={{ background: loaderColors[l] }} />
              {loaderNames[l]}
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
        <label className="flex cursor-pointer items-center gap-2 text-[12px] text-muted">
          {t("newinst.snapshots")}
          <Switch checked={snapshots} onChange={setSnapshots} label={t("newinst.snapshots")} />
        </label>
      </div>
      <SearchInput value={query} onChange={setQuery} placeholder={t("newinst.version_search")} />
      <div ref={scrollRef} className="scroll border border-line bg-black/40" style={{ height: listHeight }} role="listbox" aria-label={t("newinst.version")}>
        {versions.isError ? (
          <ErrorState error={versions.error} onRetry={() => versions.refetch()} className="py-8" />
        ) : supported.isError ? (
          <ErrorState error={supported.error} onRetry={() => supported.refetch()} className="py-8" />
        ) : loading ? (
          <div className="flex flex-col gap-px p-1">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-[33px]" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13px] text-dim">{t("newinst.no_versions")}</div>
        ) : (
          <div className="relative w-full" style={{ height: v.getTotalSize() }}>
            {v.getVirtualItems().map((row) => {
              const ver = list[row.index];
              const active = ver.id === value.mc;
              return (
                <button
                  key={ver.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => ver.id !== value.mc && onChange({ ...value, mc: ver.id, loaderVersion: null })}
                  className={cn(
                    "absolute left-0 top-0 flex h-[34px] w-full items-center gap-3 px-3 text-left text-[13px] transition-colors duration-100",
                    active ? "bg-accent/15 text-white shadow-[inset_2px_0_0_var(--accent)]" : "text-text hover:bg-white/[.04]",
                  )}
                  style={{ transform: `translateY(${row.start}px)` }}
                >
                  <span className="w-4 text-accent">{active && <Check size={14} />}</span>
                  <span className="flex-1 font-mono">{ver.id}</span>
                  {ver.kind !== "release" && <span className="text-[11px] font-medium text-warn">{kindLabel(ver.kind, t)}</span>}
                  <span className="w-[84px] text-right text-[12px] tabular-nums text-dim">{ver.release_time.slice(0, 10)}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  const lvNode = value.loader !== "vanilla" && (
    <Field
      label={t("newinst.loader_version", { loader: loaderNames[value.loader] })}
      error={loaderVersions.isError ? String((loaderVersions.error as { message?: string })?.message ?? loaderVersions.error) : undefined}
    >
      {value.mc && loaderVersions.isLoading ? (
        <Skeleton className="h-10" />
      ) : (
        <Select
          value={value.loaderVersion}
          onChange={(lv) => onChange({ ...value, loaderVersion: lv })}
          options={lvOptions}
          placeholder={!value.mc ? t("newinst.pick_version_first") : lvOptions.length ? t("newinst.loader_version_pick") : t("newinst.loader_version_none")}
          disabled={!lvOptions.length}
        />
      )}
    </Field>
  );

  if (render) return <>{render({ loader: loaderNode, list: listNode, loaderVersion: lvNode })}</>;
  return (
    <div className="flex flex-col gap-5">
      {loaderNode}
      {listNode}
      {lvNode}
    </div>
  );
}
