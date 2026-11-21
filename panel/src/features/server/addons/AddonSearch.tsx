import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Download, ExternalLink, Search, XCircle } from "lucide-react";
import type { AddonHit, AddonList, AddonSource, ServerView } from "@/api/types";
import { useAgent } from "@/app/agent";
import { number } from "@/app/format";
import { useT } from "@/i18n";
import { Badge, Button, Empty, Input, Notice, Segmented, Spinner, toast } from "@/components/ui";
import { SOFTWARE_NAMES, softwareOf } from "@/features/servers/meta";

function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v);
  useEffect(() => {
    const id = setTimeout(() => setD(v), ms);
    return () => clearTimeout(id);
  }, [v, ms]);
  return d;
}

function Hit({ hit, installed, server, onInstalled }: { hit: AddonHit; installed: boolean; server: ServerView; onInstalled: (files: string[]) => void }) {
  const t = useT();
  const { api, can } = useAgent();
  const install = useMutation({ mutationFn: () => api.installAddon(server.id, hit.source, hit.id), onSuccess: onInstalled, onError: (e) => toast.error(e) });
  const c = hit.compat;
  const ok = c ? c.ok : true;
  return (
    <li className="flex flex-col gap-3 border-b border-line py-4 last:border-b-0 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {hit.icon_url ? <img src={hit.icon_url} alt="" className="size-11 shrink-0 rounded-card" /> : <span className="grid size-11 shrink-0 place-items-center rounded-card bg-surface3 font-display text-[13px] text-muted">{hit.title.slice(0, 2)}</span>}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{hit.title}</span>
            <span className="text-meta text-dim">{t("addons.by", { author: hit.author })}</span>
          </div>
          <div className="mt-0.5 line-clamp-2 text-meta text-muted">{hit.description}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {c && (ok ? <Badge tone="ok"><Check size={11} />{t("addons.compatible", { sw: SOFTWARE_NAMES[softwareOf(server)], mc: server.mc_version })}</Badge> : <Badge tone="danger"><XCircle size={11} />{c.reason ?? t("addons.incompatible")}</Badge>)}
            <span className="text-caption text-dim">{t("addons.downloads", { n: number(hit.downloads) })}</span>
            <a href={hit.page_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-caption text-dim hover:text-text">
              <ExternalLink size={11} />
              {hit.source === "hangar" ? "Hangar" : "Modrinth"}
            </a>
          </div>
        </div>
      </div>
      {can("servers.manage") && (
        <Button variant={installed ? "ghost" : "primary"} disabled={installed || !ok} loading={install.isPending} icon={installed ? <Check size={15} /> : <Download size={15} />} onClick={() => install.mutate()} className="sm:w-36">
          {installed ? t("addons.installed_one") : t("addons.install")}
        </Button>
      )}
    </li>
  );
}

export function AddonSearch({ server, list, onChanged }: { server: ServerView; list: AddonList; onChanged: () => void }) {
  const t = useT();
  const { api, key } = useAgent();
  const plugins = list.target.plugins;
  const [source, setSource] = useState<AddonSource>("modrinth");
  const [q, setQ] = useState("");
  const query = useDebounced(q, 300);
  const results = useQuery({
    queryKey: [key, server.id, "addon-search", source, query],
    queryFn: ({ signal }) => api.searchAddons(server.id, source, query, 0, signal),
    staleTime: 60_000,
  });
  const installedIds = new Set(list.items.map((a) => a.project_id).filter(Boolean));
  const running = server.status?.state === "running";
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-dim" />
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={plugins ? t("addons.search_plugins") : t("addons.search_mods")} className="h-11 pl-10" />
        </div>
        {plugins && list.target.hangar && (
          <Segmented
            value={source}
            onChange={setSource}
            items={[
              { key: "modrinth", label: "Modrinth" },
              { key: "hangar", label: "Hangar" },
            ]}
          />
        )}
      </div>
      {results.isLoading ? (
        <div className="flex justify-center py-10"><Spinner /></div>
      ) : results.error ? (
        <Notice tone="danger">{(results.error as Error).message}</Notice>
      ) : !results.data?.hits.length ? (
        <Empty icon={<Search size={28} />} title={t("addons.no_results")} />
      ) : (
        <ul>
          {results.data.hits.map((h) => (
            <Hit
              key={`${h.source}:${h.id}`}
              hit={h}
              server={server}
              installed={installedIds.has(h.id)}
              onInstalled={(files) => {
                toast.ok(running ? t("addons.installed_restart", { n: files.length }) : t("addons.installed_toast", { n: files.length }));
                onChanged();
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
