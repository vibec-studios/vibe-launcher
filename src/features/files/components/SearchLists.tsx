import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { api } from "@/lib/api";
import type { FileEntry, FileScope, FileSearchHit } from "@/lib/types";
import { ErrorState, Skeleton, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { FileIcon, dirName, fkeys } from "../util";

export function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const lower = text.toLowerCase();
  const out: ReactNode[] = [];
  let i = 0;
  let n = 0;
  while (i < text.length) {
    const j = lower.indexOf(q, i);
    if (j < 0) {
      out.push(text.slice(i));
      break;
    }
    if (j > i) out.push(text.slice(i, j));
    out.push(
      <mark key={n++} className="bg-warn/25 text-text">
        {text.slice(j, j + q.length)}
      </mark>,
    );
    i = j + q.length;
  }
  return <>{out}</>;
}

export function ListSkeleton({ n = 8 }: { n?: number }) {
  return (
    <div className="flex flex-col gap-2 px-3 py-3">
      {Array.from({ length: n }, (_, i) => (
        <Skeleton key={i} className="h-4" style={{ width: `${45 + ((i * 23) % 45)}%`, marginLeft: (i % 3) * 14 }} />
      ))}
    </div>
  );
}

/** Namenssuche: flache Trefferliste mit Ordnerpfad. */
export function FindResults({ scope, query, selected, onPick }: { scope: FileScope; query: string; selected: string | null; onPick: (e: FileEntry) => void }) {
  const t = useT();
  const q = query.trim();
  const res = useQuery({ queryKey: fkeys.find(scope, q), queryFn: () => api.filesFind(scope, q), enabled: q.length >= 2, staleTime: 5_000 });
  if (q.length < 2) return <p className="px-3 py-4 text-[12px] text-dim">{t("files.find_hint")}</p>;
  if (res.isError) return <ErrorState error={res.error} onRetry={() => res.refetch()} />;
  if (!res.data) return <ListSkeleton n={6} />;
  const lq = q.toLowerCase();
  return (
    <div className={cn("flex flex-col pb-3 transition-opacity duration-150", res.isFetching && "opacity-60")}>
      <div className="px-3 py-2 text-[11px] text-dim">
        {res.data.truncated ? t("files.found_max", { n: res.data.entries.length }) : res.data.entries.length ? t("files.found", { n: res.data.entries.length }) : t("files.no_hits")}
      </div>
      {res.data.entries.map((e) => (
        <button
          key={e.path}
          onClick={() => onPick(e)}
          title={e.path}
          className={cn("flex h-8 w-full items-center gap-2 px-3 text-left text-[13px]", selected === e.path ? "bg-surface3 text-text" : "hover:bg-white/[.04]")}
        >
          <FileIcon entry={e} />
          <span className="shrink-0 truncate text-text">
            <Highlight text={e.name} q={lq} />
          </span>
          <span className="min-w-0 flex-1 truncate text-right font-mono text-[11px] text-dim">{dirName(e.path) || "/"}</span>
        </button>
      ))}
    </div>
  );
}

/** Volltextsuche: Treffer nach Datei gruppiert. */
export function SearchResults({ scope, query, onOpen }: { scope: FileScope; query: string; onOpen: (path: string, line: number) => void }) {
  const t = useT();
  const q = query.trim();
  const res = useQuery({ queryKey: fkeys.search(scope, q), queryFn: () => api.filesSearch(scope, q), enabled: q.length >= 2, staleTime: 5_000 });
  const groups = useMemo(() => {
    const m = new Map<string, FileSearchHit[]>();
    for (const h of res.data?.hits ?? []) {
      let l = m.get(h.path);
      if (!l) m.set(h.path, (l = []));
      l.push(h);
    }
    return [...m.entries()];
  }, [res.data]);
  if (q.length < 2) return <p className="px-3 py-4 text-[12px] text-dim">{t("files.search_hint")}</p>;
  if (res.isError) return <ErrorState error={res.error} onRetry={() => res.refetch()} />;
  if (!res.data) return <ListSkeleton n={5} />;
  const d = res.data;
  const lq = q.toLowerCase();
  return (
    <div className={cn("flex flex-col pb-3 transition-opacity duration-150", res.isFetching && "opacity-60")}>
      <div className="flex flex-col gap-0.5 px-3 py-2 text-[11px] text-dim">
        <span>
          {d.hits.length >= 200 ? t("files.hits_max", { n: 200 }) : d.hits.length ? t("files.hits", { n: d.hits.length, files: groups.length }) : t("files.no_hits")}
        </span>
        <span>
          {t("files.search_stats", { n: d.files_scanned })}
          {d.files_skipped > 0 && ` · ${t("files.search_skipped", { n: d.files_skipped })}`}
          {d.truncated && d.hits.length < 200 && ` · ${t("files.search_truncated")}`}
        </span>
      </div>
      {groups.map(([path, hits]) => (
        <div key={path} className="mb-1">
          <div className="flex items-center gap-1.5 px-3 py-1 text-[12px] font-semibold text-text" title={path}>
            <FileText size={12} className="shrink-0 text-dim" />
            <span className="truncate">{path}</span>
          </div>
          {hits.map((h) => (
            <button key={h.line} onClick={() => onOpen(h.path, h.line)} className="flex w-full items-baseline gap-2 px-3 py-0.5 text-left hover:bg-white/[.04]">
              <span className="w-8 shrink-0 text-right font-mono text-[11px] tabular-nums text-dim">{h.line}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-muted">
                <Highlight text={h.text} q={lq} />
              </span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
