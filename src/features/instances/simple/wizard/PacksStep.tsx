import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Search, Wand2 } from "lucide-react";
import { api } from "@/lib/api";
import { formatCount } from "@/lib/format";
import type { ProjectHit } from "@/lib/types";
import { ErrorState, SearchInput, Skeleton, toast } from "@/components/ui";
import { startModpackInstall } from "@/components/content/install";
import { PackIcon } from "@/features/home/Discover";
import { usePopularModpacks } from "@/features/home/data";
import { useT, t as tt } from "@/i18n";
import { AdvancedLink, Footer } from "./parts";

// ------------------------------------------------------------------ Modpacks

export function PacksStep({ onOwn, onDone }: { onOwn: () => void; onDone: () => void }) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const h = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(h);
  }, [query]);
  const popular = usePopularModpacks(12);
  const search = useQuery({
    queryKey: ["simple-wiz", "packs", debounced],
    queryFn: () =>
      api.contentSearch({ source: "modrinth", query: debounced, project_type: "modpack", game_version: null, loader: null, categories: [], sort: "relevance", offset: 0, limit: 12 }),
    enabled: debounced.length > 0,
    staleTime: 60_000,
  });
  const q = debounced ? search : popular;
  const hits = debounced ? search.data?.hits : popular.data;
  const install = (h: ProjectHit) => {
    startModpackInstall(h, null, () => true)
      .then(() => toast.info(tt("wiz.pack.started", { name: h.title }), tt("wiz.pack.started_text")))
      .catch((e) => toast.error(e, tt("install.failed", { name: h.title })));
    onDone();
  };
  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-3 px-6 pb-4 pt-1">
        <button
          onClick={onOwn}
          className="flex items-center gap-4 rounded-card bg-surface p-4 text-left transition-colors duration-100 hover:bg-surface2"
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-card bg-black/40 text-brand">
            <Wand2 size={20} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-semibold text-text">{t("wiz.own.title")}</span>
            <span className="mt-0.5 block text-[12.5px] text-muted">{t("wiz.own.text")}</span>
          </span>
        </button>
        <div className="flex items-center gap-3 pt-1">
          <span className="text-[12.5px] font-semibold text-muted">{debounced ? t("wiz.packs.results") : t("wiz.packs.popular")}</span>
          <div className="flex-1" />
          <SearchInput value={query} onChange={setQuery} placeholder={t("wiz.packs.search")} className="w-[260px]" />
        </div>
        <div className="scroll min-h-0 flex-1">
          {q.isError ? (
            <ErrorState error={q.error} onRetry={() => q.refetch()} className="py-8" />
          ) : !hits ? (
            <div className="grid grid-cols-2 gap-2">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-[76px]" />
              ))}
            </div>
          ) : hits.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-[13px] text-dim">
              <Search size={20} />
              {t("wiz.packs.none")}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {hits.map((h) => (
                <button
                  key={h.id}
                  onClick={() => install(h)}
                  className="group flex min-w-0 items-center gap-3 rounded-card bg-surface p-3 text-left transition-colors duration-100 hover:bg-surface2"
                >
                  <PackIcon hit={h} size={48} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold text-text">{h.title}</span>
                    <span className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-muted">{h.description}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className="flex items-center gap-1 text-caption tabular-nums text-dim">
                      <Download size={11} />
                      {formatCount(h.downloads)}
                    </span>
                    <span className="text-[12px] font-semibold text-brand opacity-0 transition-opacity group-hover:opacity-100">{t("wiz.pack.pick")}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <Footer>
        <AdvancedLink />
        <div className="flex-1" />
        <span className="text-[12px] text-dim">{t("wiz.packs.hint")}</span>
      </Footer>
    </>
  );
}
