import { useQuery } from "@tanstack/react-query";
import { Check, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ProjectIcon } from "@/components/content/ProjectIcon";
import { ErrorState, IconButton, SearchInput, Segmented, Select, Skeleton } from "@/components/ui";
import { useT } from "@/i18n";
import { api } from "@/lib/api";
import { formatCount } from "@/lib/format";
import type { ProjectType, Source } from "@/lib/types";
import { entryKey, type ModSetInfo, type SetEntry } from "../api";
import { InstanceCandidatesList, InstancePicker } from "./InstanceCandidates";
import { addToSet, PasteList } from "./PasteList";

export type AddMode = "search" | "paste" | "instance";


export const TYPES: ProjectType[] = ["mod", "shader", "resourcepack", "datapack"];

export function SearchAdd({ set }: { set: ModSetInfo }) {
  const t = useT();
  const cf = useQuery({ queryKey: ["curseforge-available"], queryFn: api.curseforgeAvailable, staleTime: 5 * 60_000 }).data ?? false;
  const [source, setSource] = useState<Source>("modrinth");
  const [type, setType] = useState<ProjectType>("mod");
  const [text, setText] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const h = setTimeout(() => setDebounced(text.trim()), 300);
    return () => clearTimeout(h);
  }, [text]);
  const q = useQuery({
    queryKey: ["mod-sets", "search", source, type, debounced],
    queryFn: () =>
      api.contentSearch({ source, query: debounced, project_type: type, game_version: null, loader: null, categories: [], sort: debounced ? "relevance" : "downloads", offset: 0, limit: 20 }),
    staleTime: 60_000,
  });
  const keys = useMemo(() => new Set(set.entries.map(entryKey)), [set.entries]);
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <SearchInput value={text} onChange={setText} placeholder={t("sets.add.search_placeholder")} autoFocus />
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <Select<ProjectType> size="sm" variant="ghost" value={type} onChange={setType} options={TYPES.map((k) => ({ value: k, label: t(`sets.type.${k}`) }))} />
        </div>
        {cf && (
          <Segmented<Source>
            value={source}
            onChange={setSource}
            items={[
              { value: "modrinth", label: "Modrinth" },
              { value: "curseforge", label: "CurseForge" },
            ]}
          />
        )}
      </div>
      <div className="scroll -mx-2 max-h-[460px] min-h-[200px]">
        {q.isPending ? (
          <div className="flex flex-col gap-1.5 px-2">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-11" />
            ))}
          </div>
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data.hits.length ? (
          <div className="py-8 text-center text-[13px] text-muted">{t("sets.add.no_results")}</div>
        ) : (
          q.data.hits.map((h) => {
            const inSet = keys.has(`${h.source}:${h.id}`);
            const entry: SetEntry = { source: h.source, project_id: h.id, slug: h.slug || null, title: h.title, icon_url: h.icon_url, project_type: h.project_type, added: 0 };
            return (
              <div key={h.id} className="flex items-center gap-3 rounded-ctl px-2 py-1.5 hover:bg-white/[.03]">
                <ProjectIcon src={h.icon_url} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-text">{h.title}</div>
                  <div className="truncate text-[12px] text-dim">
                    {h.author} · {formatCount(h.downloads)} ↓
                  </div>
                </div>
                {inSet ? (
                  <span className="flex shrink-0 items-center gap-1 text-[12px] text-ok">
                    <Check size={13} />
                    {t("sets.add.in_set")}
                  </span>
                ) : (
                  <IconButton label={t("sets.add")} tip size="sm" variant="ghost" onClick={() => void addToSet(t, set.id, [entry], set.entries.length)}>
                    <Plus size={15} />
                  </IconButton>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export function InstanceAdd({ set }: { set: ModSetInfo }) {
  const t = useT();
  const [instanceId, setInstanceId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const keys = useMemo(() => new Set(set.entries.map(entryKey)), [set.entries]);
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <InstancePicker value={instanceId} onChange={setInstanceId} />
      {instanceId && (
        <InstanceCandidatesList
          key={instanceId}
          instanceId={instanceId}
          existing={keys}
          busy={busy}
          submitLabel={(n) => t("frominst.add_n", { n })}
          onSubmit={async (entries) => {
            setBusy(true);
            await addToSet(t, set.id, entries, set.entries.length);
            setBusy(false);
            setInstanceId(null);
          }}
        />
      )}
    </div>
  );
}

export function AddPanel({ set, initial }: { set: ModSetInfo; initial: AddMode }) {
  const t = useT();
  const [mode, setMode] = useState<AddMode>(initial);
  const keys = useMemo(() => new Set(set.entries.map(entryKey)), [set.entries]);
  return (
    <div className="flex flex-col gap-3 rounded-panel bg-surface p-4">
      <span className="text-[14px] font-semibold text-text">{t("sets.add")}</span>
      <Segmented<AddMode>
          className="flex w-full [&>button]:flex-1 [&>button]:whitespace-nowrap [&>button]:px-2"
          value={mode}
          onChange={setMode}
          items={[
            { value: "search", label: t("sets.add.search") },
            { value: "paste", label: t("sets.add.paste") },
            { value: "instance", label: t("sets.add.instance") },
          ]}
        />
      {mode === "search" ? (
        <SearchAdd set={set} />
      ) : mode === "paste" ? (
        <PasteList compact existing={keys} onAdd={(entries) => addToSet(t, set.id, entries, set.entries.length)} />
      ) : (
        <InstanceAdd set={set} />
      )}
    </div>
  );
}
