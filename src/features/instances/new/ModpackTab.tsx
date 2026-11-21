import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { api } from "@/lib/api";
import { useSystemInfo } from "@/lib/queries";
import type { ProjectHit } from "@/lib/types";
import { formatCount } from "@/lib/format";
import { Button, ErrorState, SearchInput, Segmented, Skeleton, toast } from "@/components/ui";
import { startModpackInstall } from "@/components/content/install";
import { PackIcon } from "@/features/home/Discover";
import { usePopularModpacks } from "@/features/home/data";
import { useT } from "@/i18n";

// ------------------------------------------------------------------ Tab: Modpack

export function PackRow({ hit, onInstall }: { hit: ProjectHit; onInstall: (h: ProjectHit) => void }) {
  const t = useT();
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-4 px-4 py-3">
      <PackIcon hit={hit} size={44} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span className="break-words text-[15px] font-semibold text-text">{hit.title}</span>
          <span className="break-words text-[13px] text-muted">{hit.author}</span>
        </div>
        <div className="line-clamp-2 text-[14px] text-muted">{hit.description}</div>
        <div className="mt-0.5 flex items-center gap-1 text-[11.5px] tabular-nums text-dim">
          <Download size={11} />
          {formatCount(hit.downloads)}
          {hit.game_versions.length > 0 && <span> · {hit.game_versions[hit.game_versions.length - 1]}</span>}
        </div>
      </div>
      <Button icon={<Download size={15} />} onClick={() => onInstall(hit)}>
        {t("newinst.pack.install")}
      </Button>
    </div>
  );
}

export function ModpackTab({ onDone }: { onDone: () => void }) {
  const t = useT();
  const nav = useNavigate();
  const cf = !!useSystemInfo().data?.curseforge_available;
  const [source, setSource] = useState<"modrinth" | "curseforge">("modrinth");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const h = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(h);
  }, [query]);
  const popular = usePopularModpacks(20, source);
  const search = useQuery({
    queryKey: ["newinst", "pack-search", source, debounced],
    queryFn: () =>
      api.contentSearch({
        source,
        query: debounced,
        project_type: "modpack",
        game_version: null,
        loader: null,
        categories: [],
        sort: "relevance",
        offset: 0,
        limit: 20,
      }),
    enabled: debounced.length > 0,
    staleTime: 60_000,
  });
  const q = debounced ? search : popular;
  const hits = debounced ? search.data?.hits : popular.data;
  const install = (h: ProjectHit) => {
    startModpackInstall(h, null, () => true).catch((e) => toast.error(e, t("install.failed", { name: h.title })));
    onDone();
  };
  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-3 px-6 pb-4 pt-5">
        <div>
          <div className="text-[17px] font-semibold text-text">{t("newinst.pack.title")}</div>
          <div className="text-[14px] text-muted">{t("newinst.pack.text")}</div>
        </div>
        <div className="flex items-center gap-2">
          <SearchInput value={query} onChange={setQuery} placeholder={t("newinst.pack.search")} autoFocus className="min-w-0 flex-1" />
          {cf && (
            <Segmented
              value={source}
              onChange={setSource}
              items={[
                { value: "modrinth", label: "Modrinth" },
                { value: "curseforge", label: "CurseForge" },
              ]}
            />
          )}
        </div>
        <div className="scroll min-h-0 flex-1 rounded-card bg-surface">
          {!debounced && <div className="px-3 pb-1 pt-2.5 text-caption font-semibold uppercase tracking-wide text-dim">{t("newinst.pack.popular")}</div>}
          {q.isError ? (
            <ErrorState error={q.error} onRetry={() => q.refetch()} className="py-8" />
          ) : !hits ? (
            <div className="flex flex-col gap-1 p-2">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-[60px]" />
              ))}
            </div>
          ) : hits.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-4 py-10 text-center text-[14px] text-muted">
              {t("newinst.pack.empty")}
              {query && <Button variant="subtle" onClick={() => setQuery("")}>{t("common.clear")}</Button>}
            </div>
          ) : (
            <div className="divide-y divide-line">
              {hits.map((h) => (
                <PackRow key={h.id} hit={h} onInstall={install} />
              ))}
            </div>
          )}
        </div>
      </div>
      <footer className="flex items-center gap-3 border-t border-line px-6 py-4">
        <div className="min-w-0 flex-1" />
        <Button
          variant="subtle"
          onClick={() => {
            onDone();
            nav({ to: "/discover", search: { type: "modpack", q: query.trim() || undefined } });
          }}
        >
          {t("home.discover.more")}
        </Button>
        <Button variant="subtle" onClick={onDone}>
          {t("common.cancel")}
        </Button>
      </footer>
    </>
  );
}
