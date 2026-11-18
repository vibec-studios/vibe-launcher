// OWNER: Frontend-Agent A. Screenshots aller Instanzen: Werkzeugleiste (Instanz-Filter, Ordner, Neu laden) über einem
// virtualisierten, rahmenlosen Raster nach Datum gruppiert, Lightbox, Kontextmenü (Kopieren, im Ordner zeigen, Löschen). Lädt nur Vorschaubilder.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getRouteApi } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Camera, Copy, Eye, FolderOpen, RefreshCw, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useInstances } from "@/lib/queries";
import type { Screenshot } from "@/lib/types";
import { formatBytes, formatDate, imageSrc } from "@/lib/format";
import { ContextItem, ContextMenu, ContextSeparator, EmptyState, ErrorState, IconButton, Select, Skeleton, cn, confirm, toast } from "@/components/ui";
import { t as tt, useLang, useT } from "@/i18n";
import { Lightbox } from "@/components/ui/Lightbox";
import { ShotThumb, useScreenshots, useShotFocus } from "./shots";

const route = getRouteApi("/screenshots");
const GAP = 8;
const MIN_TILE = 220;
const HEAD_H = 44;
const PAD = 24;
const ALL = "__all";

type Row = { kind: "head"; label: string; count: number } | { kind: "tiles"; items: Screenshot[]; start: number };

function bucket(ts: number, now: Date): { key: string; label: (t: (k: string) => string, lang: string) => string } {
  const d = new Date(ts);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff <= 0) return { key: "today", label: (t) => t("shots.today") };
  if (diff === 1) return { key: "yesterday", label: (t) => t("shots.yesterday") };
  if (diff < 7) return { key: "week", label: (t) => t("shots.week") };
  const key = `${d.getFullYear()}-${d.getMonth()}`;
  return {
    key,
    label: (_t, lang) => d.toLocaleDateString(lang === "en" ? "en-US" : "de-DE", { month: "long", year: "numeric" }),
  };
}

const Tile = memo(function Tile({
  shot,
  instanceName,
  height,
  onOpen,
  onDelete,
}: {
  shot: Screenshot;
  instanceName: string;
  height: number;
  onOpen: (s: Screenshot) => void;
  onDelete: (s: Screenshot) => void;
}) {
  const t = useT();
  return (
    <ContextMenu
      content={
        <>
          <ContextItem icon={<Eye size={14} />} onSelect={() => onOpen(shot)}>
            {t("shots.view")}
          </ContextItem>
          <ContextItem icon={<Copy size={14} />} onSelect={() => copyShot(shot)}>
            {t("shots.copy")}
          </ContextItem>
          <ContextItem icon={<FolderOpen size={14} />} onSelect={() => api.screenshotOpenFolder(shot.path).catch((e) => toast.error(e))}>
            {t("shots.show_in_folder")}
          </ContextItem>
          <ContextSeparator />
          <ContextItem icon={<Trash2 size={14} />} danger onSelect={() => onDelete(shot)}>
            {t("common.delete")}
          </ContextItem>
        </>
      }
    >
      <button
        onClick={() => onOpen(shot)}
        className="group relative min-w-0 flex-1 overflow-hidden rounded-card text-left outline-none focus-visible:outline-2 focus-visible:outline-accent"
        style={{ height }}
        aria-label={shot.file_name}
      >
        <ShotThumb path={shot.path} className="absolute inset-0" />
        <span className="pointer-events-none absolute inset-0 bg-white/0 transition-colors duration-100 group-hover:bg-white/[.04] group-data-[state=open]:bg-white/[.04]" />
        <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-black/60 px-2.5 py-1.5 text-[12px] opacity-0 transition-opacity duration-100 group-hover:opacity-100 group-data-[state=open]:opacity-100">
          <span className="truncate font-medium text-text">{instanceName}</span>
          <span className="shrink-0 text-muted">{new Date(shot.taken_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>
        </span>
      </button>
    </ContextMenu>
  );
});

async function copyShot(s: Screenshot) {
  try {
    await api.screenshotCopy(s.path);
    toast.success(tt("shots.copied"));
  } catch (e) {
    toast.error(e);
  }
}

export function ScreenshotsPage() {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const qc = useQueryClient();
  const { instance } = route.useSearch();
  const nav = route.useNavigate();
  const { data: instances = [] } = useInstances();
  const q = useScreenshots(null);
  const [lightbox, setLightbox] = useState<number | null>(null);

  const names = useMemo(() => new Map(instances.map((i) => [i.id, i.name])), [instances]);
  const all = useMemo(() => q.data ?? [], [q.data]);
  const shots = useMemo(() => (instance ? all.filter((s) => s.instance_id === instance) : all), [all, instance]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of all) m.set(s.instance_id, (m.get(s.instance_id) ?? 0) + 1);
    return m;
  }, [all]);

  // Spaltenzahl aus der Breite des Scrollbereichs
  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth - PAD * 2));
    ro.observe(el);
    setWidth(el.clientWidth - PAD * 2);
    return () => ro.disconnect();
  }, []);
  const cols = Math.max(2, Math.floor((width + GAP) / (MIN_TILE + GAP)));
  const tileW = width > 0 ? (width - (cols - 1) * GAP) / cols : MIN_TILE;
  const tileH = Math.round((tileW * 9) / 16);

  const rows = useMemo(() => {
    const out: Row[] = [];
    const now = new Date();
    let i = 0;
    while (i < shots.length) {
      const b = bucket(shots[i].taken_at, now);
      let j = i;
      while (j < shots.length && bucket(shots[j].taken_at, now).key === b.key) j++;
      out.push({ kind: "head", label: b.label(t, lang), count: j - i });
      for (let k = i; k < j; k += cols) out.push({ kind: "tiles", items: shots.slice(k, Math.min(k + cols, j)), start: k });
      i = j;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shots, cols, lang]);

  const v = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (n) => (rows[n].kind === "head" ? HEAD_H : tileH + GAP),
    overscan: 4,
  });
  useEffect(() => v.measure(), [tileH, rows, v]);

  const indexOf = useMemo(() => new Map(shots.map((s, n) => [s.path, n])), [shots]);
  const onOpen = useCallback((s: Screenshot) => setLightbox(indexOf.get(s.path) ?? null), [indexOf]);

  // Von der Startseite angeforderte Aufnahme direkt öffnen
  const focus = useShotFocus((s) => s.path);
  useEffect(() => {
    if (!focus || !q.data) return;
    const n = indexOf.get(focus);
    useShotFocus.setState({ path: null });
    if (n !== undefined) setLightbox(n);
  }, [focus, q.data, indexOf]);

  const onDelete = useCallback(
    async (s: Screenshot) => {
      const ok = await confirm({ title: t("shots.delete.title"), text: s.file_name, confirmLabel: t("common.delete"), danger: true });
      if (!ok) return;
      try {
        await api.screenshotDelete(s.path);
        qc.setQueryData<Screenshot[]>(["screenshots", "all"], (l) => l?.filter((x) => x.path !== s.path));
        qc.invalidateQueries({ queryKey: ["screenshots"] });
        toast.success(t("shots.deleted"), s.file_name);
      } catch (e) {
        toast.error(e, t("shots.delete_failed"));
      }
    },
    [qc, t],
  );

  const images = useMemo(
    () =>
      shots.map((s) => ({
        url: imageSrc(s.path) ?? "",
        title: s.file_name,
        description: [
          names.get(s.instance_id) ?? s.instance_id,
          `${formatDate(s.taken_at)} ${new Date(s.taken_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`,
          s.width && s.height ? `${s.width} × ${s.height}` : null,
          formatBytes(s.size),
        ]
          .filter(Boolean)
          .join(" · "),
      })),
    [shots, names],
  );
  // Index gültig halten (z. B. nach dem Löschen)
  useEffect(() => {
    if (lightbox !== null && lightbox >= shots.length) setLightbox(shots.length ? shots.length - 1 : null);
  }, [lightbox, shots.length]);

  const filterOptions = [
    { value: ALL, label: t("shots.all_instances"), hint: String(all.length) },
    ...instances.filter((i) => counts.has(i.id) || i.id === instance).map((i) => ({ value: i.id, label: i.name, hint: String(counts.get(i.id) ?? 0) })),
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 px-6 pt-1">
        <div className="w-[240px]">
          <Select<string>
            size="sm"
            variant="ghost"
            value={instance ?? ALL}
            onChange={(v) => nav({ search: { instance: v === ALL ? undefined : v }, replace: true })}
            options={filterOptions}
          />
        </div>
        {q.data && <span className="text-meta tabular-nums text-dim">{shots.length.toLocaleString()}</span>}
        <div className="flex-1" />
        {instance && (
          <IconButton
            label={t("common.open_folder")}
            tip
            variant="ghost"
            onClick={() => api.instanceOpenFolder(instance, "screenshots").catch((e) => toast.error(e))}
          >
            <FolderOpen size={16} />
          </IconButton>
        )}
        <IconButton label={t("shots.reload")} tip variant="ghost" onClick={() => q.refetch()}>
          <RefreshCw size={15} className={cn(q.isFetching && "animate-spin")} />
        </IconButton>
      </div>

      <div ref={scrollRef} className="scroll min-h-0 flex-1 px-6 pb-8">
        {q.isError && !q.data ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data ? (
          <div className="grid gap-2 pt-10" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {Array.from({ length: cols * 3 }, (_, n) => (
              <Skeleton key={n} className="aspect-video rounded-card" />
            ))}
          </div>
        ) : shots.length === 0 ? (
          <EmptyState
            className="mt-4 rounded-panel bg-surface"
            icon={<Camera size={34} />}
            title={t("shots.empty.title")}
            text={t("shots.empty.text")}
          />
        ) : (
          <div className="relative w-full" style={{ height: v.getTotalSize() }}>
            {v.getVirtualItems().map((vr) => {
              const row = rows[vr.index];
              return (
                <div key={vr.key} className="absolute left-0 top-0 w-full" style={{ transform: `translateY(${vr.start}px)`, height: vr.size }}>
                  {row.kind === "head" ? (
                    <div className="flex h-full items-end gap-2 pb-2.5">
                      <span className="text-section text-text">{row.label}</span>
                      <span className="text-[12px] text-dim">{row.count}</span>
                    </div>
                  ) : (
                    <div className="flex" style={{ gap: GAP }}>
                      {row.items.map((s) => (
                        <Tile
                          key={s.path}
                          shot={s}
                          instanceName={names.get(s.instance_id) ?? s.instance_id}
                          height={tileH}
                          onOpen={onOpen}
                          onDelete={onDelete}
                        />
                      ))}
                      {Array.from({ length: cols - row.items.length }, (_, n) => (
                        <div key={n} className="min-w-0 flex-1" />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Lightbox
        images={images}
        index={lightbox}
        onIndexChange={setLightbox}
        onClose={() => setLightbox(null)}
        labels={{ prev: t("shots.prev"), next: t("shots.next"), close: t("common.close") }}
      />
    </div>
  );
}
