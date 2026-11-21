import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Check } from "lucide-react";
import { useGameVersions } from "@/lib/queries";
import type { LoaderKind, McVersion } from "@/lib/types";
import { ErrorState, SearchInput, Skeleton, cn } from "@/components/ui";
import { useLoaderGameVersions } from "@/components/instance/VersionPicker";
import { useT } from "@/i18n";

export type Filter = "release" | "snapshot" | "old";


// ------------------------------------------------------------------ Versionsliste

export const kindOf = (v: McVersion): Filter => (v.kind === "release" ? "release" : v.kind === "snapshot" ? "snapshot" : "old");

export function VersionList({ loader, value, onChange }: { loader: LoaderKind; value: string | null; onChange: (mc: string) => void }) {
  const t = useT();
  const versions = useGameVersions();
  const supported = useLoaderGameVersions(loader);
  const [filter, setFilter] = useState<Filter>("release");
  const [query, setQuery] = useState("");

  const sup = useMemo(() => (loader !== "vanilla" && supported.data ? new Set(supported.data) : null), [loader, supported.data]);
  const avail = useMemo(() => (versions.data ?? []).filter((v) => !sup || sup.has(v.id)), [versions.data, sup]);
  const latest = useMemo(() => avail.find((v) => v.kind === "release")?.id ?? null, [avail]);
  const counts = useMemo(() => {
    const c = { release: 0, snapshot: 0, old: 0 };
    for (const v of avail) c[kindOf(v)]++;
    return c;
  }, [avail]);
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Bei Suche alle Arten durchsuchen, sonst nur die gewählte
    return avail.filter((v) => (q ? v.id.toLowerCase().includes(q) : kindOf(v) === filter));
  }, [avail, filter, query]);

  const loading = versions.isLoading || (loader !== "vanilla" && supported.isLoading);
  const error = versions.isError ? versions : supported.isError ? supported : null;

  // Auswahl gültig halten: fällt die gewählte Version beim Loader-Wechsel weg -> neueste Release
  useEffect(() => {
    if (loading || !versions.data) return;
    if (!value || !avail.some((v) => v.id === value)) {
      const first = latest ?? avail[0]?.id ?? null;
      if (first && first !== value) onChange(first);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, avail, latest]);

  // Gewählte Version nach Loader-/Filterwechsel sichtbar machen
  const scrollRef = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({ count: list.length, getScrollElement: () => scrollRef.current, estimateSize: () => 36, overscan: 8 });
  const scrolled = useRef<string>("");
  useEffect(() => {
    const key = `${value}|${filter}|${loader}`;
    if (!value || scrolled.current === key) return;
    const idx = list.findIndex((x) => x.id === value);
    if (idx >= 0) {
      scrolled.current = key;
      v.scrollToIndex(idx, { align: "auto" });
    }
  }, [list, value, filter, loader, v]);

  const filters: { value: Filter; label: string }[] = [
    { value: "release", label: t("newinst.filter.release") },
    { value: "snapshot", label: t("newinst.filter.snapshot") },
    { value: "old", label: t("newinst.filter.old") },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={query} onChange={setQuery} placeholder={t("newinst.version_search")} className="min-w-0 flex-1" />
        <div className="inline-flex shrink-0 gap-0.5 rounded-ctl bg-field p-0.5" role="radiogroup" aria-label={t("newinst.version")}>
          {filters.map((f) => (
            <button
              key={f.value}
              type="button"
              role="radio"
              aria-checked={!query && filter === f.value}
              disabled={!counts[f.value]}
              onClick={() => {
                setFilter(f.value);
                setQuery("");
              }}
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-[max(0px,calc(var(--r-ctl)-2px))] px-2.5 text-[12.5px] font-semibold transition-colors duration-100 disabled:opacity-35",
                !query && filter === f.value ? "bg-surface3 text-text" : "text-muted hover:text-text",
              )}
            >
              {f.label}
              <span className="text-[11px] font-medium tabular-nums text-dim">{counts[f.value]}</span>
            </button>
          ))}
        </div>
      </div>
      <div ref={scrollRef} className="scroll mt-2 min-h-0 flex-1 rounded-card bg-surface" role="listbox" aria-label={t("newinst.version")}>
        {error ? (
          <ErrorState error={error.error} onRetry={() => error.refetch()} className="py-8" />
        ) : loading ? (
          <div className="flex flex-col gap-px p-1">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-[35px]" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13px] text-dim">{t("newinst.no_versions")}</div>
        ) : (
          <div className="relative w-full" style={{ height: v.getTotalSize() }}>
            {v.getVirtualItems().map((row) => {
              const ver = list[row.index];
              const active = ver.id === value;
              return (
                <button
                  key={ver.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => onChange(ver.id)}
                  className={cn(
                    "absolute left-0 top-0 flex h-9 w-full items-center gap-3 px-3 text-left text-[13.5px] transition-colors duration-100",
                    active ? "bg-accent/15 text-text" : "text-text hover:bg-white/[.04]",
                  )}
                  style={{ transform: `translateY(${row.start}px)` }}
                >
                  <span className="grid w-4 shrink-0 place-items-center text-accent">{active && <Check size={15} strokeWidth={2.5} />}</span>
                  <span className={cn("tabular-nums", active && "font-semibold")}>{ver.id}</span>
                  {ver.id === latest && (
                    <span className="rounded-xs bg-ok/15 px-1.5 text-[11px] font-semibold leading-[18px] text-ok">{t("newinst.latest")}</span>
                  )}
                  {query && ver.kind !== "release" && <span className="text-[11.5px] font-medium text-warn">{t(`newinst.filter.${kindOf(ver)}`)}</span>}
                  <span className="ml-auto text-[12px] tabular-nums text-dim">{new Date(ver.release_time).toLocaleDateString()}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
