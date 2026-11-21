// Galerie-Tab „Clips“: Videoclips des Vibey Clients aus allen Instanzen (docs/CLIPS.md §10 im Vibey Client).
// Werkzeugleiste (Umschalter, Instanz, Art-Filter, Anzahl/Größe, Ordner, Neu laden) über einem Raster nach Datum,
// Player-Dialog mit Bearbeiten. Der Launcher löscht nur auf Wunsch und lädt nichts hoch.
import { memo, useCallback, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CircleHelp, Eye, FolderOpen, Play, RefreshCw, Star, Trash2 } from "lucide-react";
import { openHelp } from "@/features/help/store";
import { api } from "@/lib/api";
import { useInstances } from "@/lib/queries";
import type { Clip, ClipExport } from "@/lib/types";
import { formatBytes } from "@/lib/format";
import { Button, ContextItem, ContextMenu, ContextSeparator, EmptyState, ErrorState, IconButton, PageToolbar, Segmented, Select, Skeleton, ToolbarMeta, Tooltip, cn, confirm, toast } from "@/components/ui";
import { useLang, useT } from "@/i18n";
import { AUTO_REASONS, ClipThumb, ReasonIcon, clipName, clipWhere, clipsKey, formatClipLength, reasonColor, reasonKey, useClips } from "./clips";
import { ClipPlayer, RewindTag } from "./ClipPlayer";
import { bucket } from "./shots";

const ALL = "__all";
type Kind = "all" | "kept" | "auto" | "hotkey";

const ClipTile = memo(function ClipTile({
  clip,
  instanceName,
  onOpen,
  onKeep,
  onDelete,
}: {
  clip: Clip;
  instanceName: string;
  onOpen: (c: Clip) => void;
  onKeep: (c: Clip) => void;
  onDelete: (c: Clip) => void;
}) {
  const t = useT();
  const name = clipName(clip, t);
  const time = new Date(clip.created_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return (
    <ContextMenu
      content={
        <>
          <ContextItem icon={<Eye size={14} />} onSelect={() => onOpen(clip)}>
            {t("clips.play")}
          </ContextItem>
          <ContextItem icon={<Star size={14} />} onSelect={() => onKeep(clip)}>
            {clip.kept ? t("clips.unkeep") : t("clips.keep")}
          </ContextItem>
          <ContextItem icon={<FolderOpen size={14} />} onSelect={() => api.clipOpenFolder(clip.instance_id, clip.id).catch((e) => toast.error(e))}>
            {t("clips.show_in_folder")}
          </ContextItem>
          <ContextSeparator />
          <ContextItem icon={<Trash2 size={14} />} danger onSelect={() => onDelete(clip)}>
            {t("common.delete")}
          </ContextItem>
        </>
      }
    >
      <div className="group relative flex min-w-0 flex-col gap-2">
        <button
          onClick={() => onOpen(clip)}
          className="relative aspect-video w-full overflow-hidden rounded-card text-left outline-none focus-visible:outline-2 focus-visible:outline-accent"
          aria-label={`${t("clips.play")}: ${name}`}
        >
          <ClipThumb clip={clip} className="absolute inset-0" />
          <span className="pointer-events-none absolute inset-0 bg-black/0 transition-colors duration-100 group-hover:bg-black/25" />
          <span className="pointer-events-none absolute left-1/2 top-1/2 grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-pill bg-black/55 text-[#fff] opacity-0 transition-opacity duration-100 group-hover:opacity-100">
            <Play size={18} className="ml-0.5 fill-current" />
          </span>
          <span
            className="pointer-events-none absolute left-2 top-2 inline-flex h-5 items-center gap-1 rounded-xs bg-black/70 px-1.5 text-[11px] font-semibold"
            style={{ color: reasonColor[clip.reason] ?? "#fff" }}
          >
            <ReasonIcon reason={clip.reason} size={11} />
            {t(reasonKey(clip.reason))}
          </span>
          {clip.rewind && <RewindTag className="pointer-events-none absolute bottom-2 left-2 bg-black/70" />}
          <span className="pointer-events-none absolute bottom-2 right-2 rounded-xs bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-[#fff]">
            {formatClipLength(clip.duration_ms)}
          </span>
        </button>
        {/* Stern: immer sichtbar bei „Behalten“, sonst beim Hover */}
        <Tooltip content={clip.kept ? t("clips.unkeep") : t("clips.keep")} side="left">
          <button
            aria-label={clip.kept ? t("clips.unkeep") : t("clips.keep")}
            aria-pressed={clip.kept}
            onClick={() => onKeep(clip)}
            className={cn(
              "absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-ctl bg-black/60 transition-[opacity,background-color] duration-100 hover:bg-black/80",
              "outline-none focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-accent",
              clip.kept ? "text-[#ffc94d]" : "text-[#fff]/85 opacity-0 hover:text-[#fff] group-hover:opacity-100 group-data-[state=open]:opacity-100",
            )}
          >
            <Star size={14} className={cn(clip.kept && "fill-current")} />
          </button>
        </Tooltip>
        <div className="min-w-0 px-0.5">
          <div className="truncate text-[13px] font-semibold text-text" title={name}>
            {name}
          </div>
          <div className="truncate text-[12px] text-dim">
            {[clip.title ? clipWhere(clip, t) : null, instanceName, time].filter(Boolean).join(" · ")}
          </div>
        </div>
      </div>
    </ContextMenu>
  );
});

export function ClipsView({
  switcher,
  instance,
  setInstance,
}: {
  switcher: ReactNode;
  instance: string | undefined;
  setInstance: (id: string | undefined) => void;
}) {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const qc = useQueryClient();
  const { data: instances = [] } = useInstances();
  const q = useClips();
  const [kind, setKind] = useState<Kind>("all");
  const [open, setOpen] = useState<{ instance_id: string; id: string } | null>(null);

  const names = useMemo(() => new Map(instances.map((i) => [i.id, i.name])), [instances]);
  const instanceName = useCallback((id: string) => names.get(id) ?? id, [names]);
  const all = useMemo(() => (q.data ?? []).slice().sort((a, b) => b.created_at - a.created_at), [q.data]);
  const byInstance = useMemo(() => (instance ? all.filter((c) => c.instance_id === instance) : all), [all, instance]);
  const clips = useMemo(
    () =>
      byInstance.filter((c) =>
        kind === "kept" ? c.kept : kind === "auto" ? AUTO_REASONS.has(c.reason) : kind === "hotkey" ? c.reason === "hotkey" : true,
      ),
    [byInstance, kind],
  );
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of all) m.set(c.instance_id, (m.get(c.instance_id) ?? 0) + 1);
    return m;
  }, [all]);
  const totalBytes = useMemo(() => byInstance.reduce((n, c) => n + (c.size_bytes ?? 0), 0), [byInstance]);

  const groups = useMemo(() => {
    const out: { key: string; label: string; items: Clip[] }[] = [];
    const now = new Date();
    for (const c of clips) {
      const b = bucket(c.created_at, now);
      const last = out[out.length - 1];
      if (last && last.key === b.key) last.items.push(c);
      else out.push({ key: b.key, label: b.label(t, lang), items: [c] });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clips, lang]);

  const current = open ? (all.find((c) => c.instance_id === open.instance_id && c.id === open.id) ?? null) : null;

  const replace = useCallback(
    (c: Clip) => qc.setQueryData<Clip[]>(clipsKey, (l) => l?.map((x) => (x.instance_id === c.instance_id && x.id === c.id ? c : x))),
    [qc],
  );

  const onKeep = useCallback(
    async (c: Clip) => {
      // Sofort zeigen, Backend-Antwort übernimmt
      replace({ ...c, kept: !c.kept });
      try {
        replace(await api.clipUpdate(c.instance_id, c.id, { kept: !c.kept }));
      } catch (e) {
        replace(c);
        toast.error(e, t("clips.save_failed"));
      }
    },
    [replace, t],
  );

  const onDelete = useCallback(
    async (c: Clip) => {
      const ok = await confirm({ title: t("clips.delete.title"), text: t("clips.delete.text", { name: clipName(c, t) }), confirmLabel: t("common.delete"), danger: true });
      if (!ok) return;
      // Player zuerst schließen, damit die MP4 nicht mehr geöffnet ist
      setOpen(null);
      await new Promise((r) => setTimeout(r, 60));
      try {
        await api.clipDelete(c.instance_id, c.id);
        qc.setQueryData<Clip[]>(clipsKey, (l) => l?.filter((x) => !(x.instance_id === c.instance_id && x.id === c.id)));
        qc.invalidateQueries({ queryKey: ["clips"] });
        toast.success(t("clips.deleted"), clipName(c, t));
      } catch (e) {
        toast.error(e, t("clips.delete_failed"));
      }
    },
    [qc, t],
  );

  const onOpen = useCallback((c: Clip) => setOpen({ instance_id: c.instance_id, id: c.id }), []);

  const onExported = useCallback(
    (r: ClipExport) => {
      qc.setQueryData<Clip[]>(clipsKey, (l) => {
        const rest = (l ?? []).filter((x) => !(x.instance_id === r.clip.instance_id && (x.id === r.clip.id || (r.original_deleted && x.id === r.clip.source_id))));
        return [r.clip, ...rest];
      });
      setKind("all");
      setOpen({ instance_id: r.clip.instance_id, id: r.clip.id });
      qc.invalidateQueries({ queryKey: ["clips"] });
    },
    [qc],
  );

  const filterOptions = [
    { value: ALL, label: t("shots.all_instances"), hint: String(all.length) },
    ...instances.filter((i) => counts.has(i.id) || i.id === instance).map((i) => ({ value: i.id, label: i.name, hint: String(counts.get(i.id) ?? 0) })),
  ];
  const kinds: { value: Kind; label: string }[] = [
    { value: "all", label: t("clips.filter.all") },
    { value: "kept", label: t("clips.filter.kept") },
    { value: "auto", label: t("clips.filter.auto") },
    { value: "hotkey", label: t("clips.filter.hotkey") },
  ];
  const filtered = clips.length === 0 && all.length > 0;

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 px-6 pb-1 pt-4">
        <PageToolbar
          actions={
            <>
              {q.data && clips.length > 0 && (
                <ToolbarMeta>
                  {t(clips.length === 1 ? "clips.count_one" : "clips.count", { n: clips.length.toLocaleString() })} · {t("clips.total", { size: formatBytes(totalBytes) })}
                </ToolbarMeta>
              )}
              {instance && (
                <IconButton label={t("clips.open_folder")} tip variant="ghost" onClick={() => api.clipOpenFolder(instance).catch((e) => toast.error(e))}>
                  <FolderOpen size={16} />
                </IconButton>
              )}
              <IconButton label={t("shots.reload")} tip variant="ghost" onClick={() => q.refetch()}>
                <RefreshCw size={15} className={cn(q.isFetching && "animate-spin")} />
              </IconButton>
            </>
          }
        >
          {switcher}
          <div className="w-[220px] min-w-[160px] shrink">
            <Select<string> value={instance ?? ALL} onChange={(v) => setInstance(v === ALL ? undefined : v)} options={filterOptions} />
          </div>
          <Segmented<Kind> size="md" value={kind} onChange={setKind} items={kinds} />
        </PageToolbar>
      </div>

      <div className="scroll min-h-0 flex-1 px-6 pb-8">
        {q.isError && !q.data ? (
          <div className="mt-3 rounded-panel bg-surface">
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          </div>
        ) : !q.data ? (
          <div className="flex flex-col" aria-busy>
            <div className="flex h-[40px] items-end pb-2.5">
              <Skeleton className="h-3.5 w-24" />
            </div>
            <div className="grid gap-x-3 gap-y-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
              {Array.from({ length: 6 }, (_, n) => (
                <div key={n} className="flex flex-col gap-2">
                  <Skeleton className="aspect-video rounded-card" />
                  <Skeleton className="h-3.5 w-2/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              ))}
            </div>
          </div>
        ) : clips.length === 0 ? (
          filtered ? (
            <EmptyState
              className="mt-3 rounded-panel bg-surface"
              icon="film"
              title={t("clips.empty_filtered.title")}
              text={t("clips.empty_filtered.text")}
              action={
                <Button
                  size="sm"
                  onClick={() => {
                    setKind("all");
                    setInstance(undefined);
                  }}
                >
                  {t("clips.show_all")}
                </Button>
              }
            />
          ) : (
            <EmptyState
              className="mt-3 rounded-panel bg-surface"
              icon="film"
              title={t("clips.empty.title")}
              text={t("clips.empty.text")}
              action={
                <Button variant="subtle" icon={<CircleHelp size={15} />} onClick={() => openHelp("gallery")}>
                  {t("layout.howto")}
                </Button>
              }
            />
          )
        ) : (
          groups.map((g) => (
            <section key={g.key}>
              <div className="flex h-[40px] items-end gap-2 pb-2.5">
                <h2 className="text-section text-text">{g.label}</h2>
                <span className="text-meta tabular-nums text-dim">{g.items.length}</span>
              </div>
              <div className="grid gap-x-3 gap-y-4 pb-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
                {g.items.map((c) => (
                  <ClipTile key={`${c.instance_id}/${c.id}`} clip={c} instanceName={instanceName(c.instance_id)} onOpen={onOpen} onKeep={onKeep} onDelete={onDelete} />
                ))}
              </div>
            </section>
          ))
        )}
      </div>

      <ClipPlayer clip={current} instanceName={instanceName} onClose={() => setOpen(null)} onChanged={replace} onDelete={onDelete} onExported={onExported} />
    </div>
  );
}
