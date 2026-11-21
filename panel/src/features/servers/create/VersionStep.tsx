import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { LoaderKind, PlatformKind, Software } from "@/api/types";
import { useAgent } from "@/app/agent";
import { useT } from "@/i18n";
import { Field, Notice, Select, Spinner } from "@/components/ui";

const PLATFORMS: Software[] = ["paper", "purpur", "folia"];

export function VersionStep({ software, mc, onMc, loaderVersion, onLoaderVersion }: { software: Software; mc: string; onMc: (v: string) => void; loaderVersion: string; onLoaderVersion: (v: string) => void }) {
  const t = useT();
  const { api, key } = useAgent();
  const isPlatform = PLATFORMS.includes(software);
  const mcList = useQuery({ queryKey: ["catalog-mc", key], queryFn: api.mcVersions, staleTime: 600_000, enabled: !isPlatform });
  const platList = useQuery({ queryKey: ["catalog-platform", key, software], queryFn: () => api.platformVersions(software as PlatformKind), staleTime: 600_000, enabled: isPlatform });
  const versions = useMemo(() => {
    if (isPlatform) return (platList.data ?? []).filter((v) => v.release).map((v) => ({ id: v.id, note: v.supported ? null : t("create.version.old") }));
    return (mcList.data ?? []).filter((v) => v.type === "release").map((v) => ({ id: v.id, note: null as string | null }));
  }, [isPlatform, platList.data, mcList.data, t]);
  const needsLoader = !isPlatform && software !== "vanilla";
  const loaders = useQuery({ queryKey: ["catalog-loader", key, software, mc], queryFn: () => api.loaderVersions(software as LoaderKind, mc), enabled: needsLoader && !!mc, staleTime: 600_000 });

  useEffect(() => {
    if (versions.length && !versions.some((v) => v.id === mc)) onMc(versions[0].id);
  }, [versions, mc, onMc]);
  useEffect(() => {
    if (loaders.data && !loaders.data.includes(loaderVersion)) onLoaderVersion("");
  }, [loaders.data, loaderVersion, onLoaderVersion]);

  const loading = isPlatform ? platList.isLoading : mcList.isLoading;
  const error = isPlatform ? platList.error : mcList.error;
  if (loading) return <div className="flex justify-center py-10 text-muted"><Spinner size={22} /></div>;
  if (error) return <Notice tone="danger">{(error as Error).message}</Notice>;
  return (
    <div className="flex flex-col gap-5">
      <Field label={t("create.version")} hint={t("create.version_hint")}>
        <Select value={mc} onChange={(e) => onMc(e.target.value)}>
          {versions.map((v, i) => (
            <option key={v.id} value={v.id}>
              {v.id}
              {i === 0 ? ` – ${t("create.version.latest")}` : v.note ? ` – ${v.note}` : ""}
            </option>
          ))}
        </Select>
      </Field>
      {needsLoader && (
        <Field label={t("create.loader_version")} hint={t("create.loader_version_hint")}>
          <Select value={loaderVersion} onChange={(e) => onLoaderVersion(e.target.value)} disabled={loaders.isLoading}>
            <option value="">{t("create.loader_auto")}</option>
            {(loaders.data ?? []).map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Notice tone="info">{t("create.version_tip")}</Notice>
    </div>
  );
}
