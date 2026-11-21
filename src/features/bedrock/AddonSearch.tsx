// Bedrock-Add-ons auf CurseForge suchen und direkt in eine Instanz installieren. Die Arten (Add-ons, Texturen,
// Karten …) kommen von der CurseForge-API. Modrinth hat keine Bedrock-Inhalte.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { create } from "zustand";
import { Download, ExternalLink } from "lucide-react";
import { useSystemInfo, waitForTask } from "@/lib/queries";
import type { Instance, ProjectHit } from "@/lib/types";
import { formatCount } from "@/lib/format";
import { Button, Dialog, EmptyState, ErrorState, SearchInput, Segmented, Skeleton, toast } from "@/components/ui";
import { ProjectIcon } from "@/components/content/ProjectIcon";
import { useT, t as tt } from "@/i18n";
import { bedrockApi } from "./api";

const useSearchDialog = create<{ instance: Instance | null }>(() => ({ instance: null }));
export const openAddonSearch = (instance: Instance) => useSearchDialog.setState({ instance });

async function openUrl(url: string) {
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } catch (e) {
    toast.error(e);
  }
}

function pageUrl(h: ProjectHit) {
  return `https://www.curseforge.com/minecraft-bedrock/search?search=${encodeURIComponent(h.slug || h.title)}`;
}

function HitRow({ hit, instance }: { hit: ProjectHit; instance: Instance }) {
  const t = useT();
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const install = async () => {
    setState("busy");
    try {
      const id = await bedrockApi.cfInstall(instance.id, hit.id, hit.title);
      await waitForTask(id);
      setState("done");
      toast.success(tt("bedrock.search.installed"), hit.title);
    } catch (e) {
      setState("idle");
      toast.error(e, tt("install.failed", { name: hit.title }));
    }
  };
  return (
    <div className="flex min-w-0 items-center gap-3 px-3 py-2.5">
      <ProjectIcon src={hit.icon_url} size={44} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-[13.5px] font-semibold text-text">{hit.title}</span>
          <span className="shrink-0 truncate text-[12px] text-dim">{hit.author}</span>
        </div>
        <div className="truncate text-[12px] text-muted">{hit.description}</div>
        <div className="mt-0.5 flex items-center gap-1 text-[11.5px] tabular-nums text-dim">
          <Download size={11} />
          {formatCount(hit.downloads)}
          {hit.categories.length > 0 && <span className="truncate"> · {hit.categories.slice(0, 3).join(", ")}</span>}
        </div>
      </div>
      {hit.manual_download ? (
        <Button size="sm" variant="subtle" icon={<ExternalLink size={13} />} title={t("bedrock.search.manual_tip")} onClick={() => void openUrl(pageUrl(hit))}>
          {t("bedrock.search.manual")}
        </Button>
      ) : (
        <Button size="sm" variant={state === "done" ? "subtle" : "ghost"} loading={state === "busy"} disabled={state === "done"} icon={<Download size={13} />} onClick={() => void install()}>
          {state === "done" ? t("bedrock.search.done") : t("newinst.pack.install")}
        </Button>
      )}
    </div>
  );
}

function SearchBody({ instance }: { instance: Instance }) {
  const t = useT();
  const cf = useSystemInfo().data?.curseforge_available ?? true;
  const classes = useQuery({ queryKey: ["bedrock-cf-classes"], queryFn: bedrockApi.cfClasses, staleTime: Infinity, enabled: cf, retry: 1 });
  const [cls, setCls] = useState<string>("");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const h = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(h);
  }, [query]);
  useEffect(() => {
    if (!cls && classes.data?.length) setCls(String(classes.data[0].id));
  }, [classes.data, cls]);
  const classId = cls ? Number(cls) : null;
  const results = useQuery({
    queryKey: ["bedrock-cf-search", classId, debounced],
    queryFn: () => bedrockApi.cfSearch({ query: debounced, classId, sort: debounced ? "relevance" : "downloads", limit: 30 }),
    enabled: cf && (classId !== null || classes.isError),
    staleTime: 60_000,
  });

  if (!cf) return <EmptyState icon="key" title={t("bedrock.search.no_key")} text={t("bedrock.search.no_key_text")} />;
  return (
    <div className="flex h-[min(560px,calc(100vh-220px))] flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={query} onChange={setQuery} placeholder={t("bedrock.search.placeholder")} autoFocus className="min-w-[200px] flex-1" />
        {classes.data && classes.data.length > 0 && (
          <Segmented value={cls} onChange={setCls} items={classes.data.slice(0, 6).map((c) => ({ value: String(c.id), label: c.name }))} />
        )}
      </div>
      <div className="scroll min-h-0 flex-1 rounded-card bg-surface">
        {results.isError ? (
          <ErrorState error={results.error} onRetry={() => results.refetch()} className="py-8" />
        ) : !results.data ? (
          <div className="flex flex-col gap-1 p-2">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-[60px]" />
            ))}
          </div>
        ) : results.data.hits.length === 0 ? (
          <EmptyState icon="search_none" title={t("bedrock.search.none")} className="py-10" />
        ) : (
          <div className="divide-y divide-line">
            {results.data.hits.map((h) => (
              <HitRow key={h.id} hit={h} instance={instance} />
            ))}
          </div>
        )}
      </div>
      <p className="text-[12px] text-dim">{t("bedrock.search.hint")}</p>
    </div>
  );
}

export function AddonSearchHost() {
  const t = useT();
  const instance = useSearchDialog((s) => s.instance);
  return (
    <Dialog
      open={!!instance}
      onOpenChange={(o) => !o && useSearchDialog.setState({ instance: null })}
      title={t("bedrock.search.title", { name: instance?.name ?? "" })}
      description={t("bedrock.search.text")}
      size="lg"
    >
      {instance && <SearchBody instance={instance} />}
    </Dialog>
  );
}
