// OWNER: Frontend-Agent A. Screenshots aller Instanzen: Werkzeugleiste (Instanz-Filter, Anzahl, Ordner, Neu laden) über einem
// virtualisierten, rahmenlosen Raster nach Datum gruppiert (neueste zuerst), Lightbox, Kontextmenü (Kopieren, im Ordner
// zeigen, Löschen). Lädt nur Vorschaubilder. Leer mit Filter: Weg zurück zu allen Instanzen bzw. in den Ordner.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useInstances } from "@/lib/queries";
import type { Screenshot } from "@/lib/types";
import { formatBytes, formatDate, imageSrc } from "@/lib/format";
import { ErrorState, confirm, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { Lightbox } from "@/components/ui/Lightbox";
import { useScreenshots, useShotFocus } from "./shots";
import { ShareShotDialog } from "@/features/shotshare/ShareShotDialog";
import { CloudShotsDialog } from "@/features/shotshare/CloudShotsDialog";
import { useShotSharing } from "@/features/shotshare/useShotSharing";
import { ALL, route } from "./layout";
import { useShotGrid } from "./hooks/useShotGrid";
import { ShotsEmpty } from "./components/ShotsEmpty";
import { ShotsGrid, ShotsSkeleton } from "./components/ShotsGrid";
import { ShotsToolbar } from "./components/ShotsToolbar";

export function ScreenshotsPage() {
  const t = useT();
  const qc = useQueryClient();
  const { instance } = route.useSearch();
  const { data: instances = [] } = useInstances();
  const q = useScreenshots(null);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const sharing = useShotSharing();
  const [shareShot, setShareShot] = useState<Screenshot | null>(null);
  const [cloudOpen, setCloudOpen] = useState(false);

  const names = useMemo(() => new Map(instances.map((i) => [i.id, i.name])), [instances]);
  // Neueste zuerst – sonst zerfallen die Datumsgruppen (z. B. zweimal „Diese Woche“), wenn die Liste nicht sortiert ankommt
  const all = useMemo(() => (q.data ?? []).slice().sort((a, b) => b.taken_at - a.taken_at), [q.data]);
  const shots = useMemo(() => (instance ? all.filter((s) => s.instance_id === instance) : all), [all, instance]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of all) m.set(s.instance_id, (m.get(s.instance_id) ?? 0) + 1);
    return m;
  }, [all]);

  const { scrollRef, cols, tileH, rows, v } = useShotGrid(shots);

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
      <ShotsToolbar q={q} count={shots.length} instance={instance} sharing={sharing} filterOptions={filterOptions} onCloud={() => setCloudOpen(true)} />

      <div ref={scrollRef} data-tour="gallery-grid" className="scroll min-h-0 flex-1 px-6 pb-8">
        {q.isError && !q.data ? (
          <div className="mt-3 rounded-panel bg-surface">
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          </div>
        ) : !q.data ? (
          <ShotsSkeleton cols={cols} />
        ) : shots.length === 0 ? (
          <ShotsEmpty instance={instance} total={all.length} names={names} />
        ) : (
          <ShotsGrid
            rows={rows}
            v={v}
            cols={cols}
            tileH={tileH}
            names={names}
            onOpen={onOpen}
            onDelete={onDelete}
            onShare={sharing ? setShareShot : undefined}
          />
        )}
      </div>

      <Lightbox
        images={images}
        index={lightbox}
        onIndexChange={setLightbox}
        onClose={() => setLightbox(null)}
        labels={{ prev: t("shots.prev"), next: t("shots.next"), close: t("common.close") }}
      />
      {sharing && (
        <>
          <ShareShotDialog shot={shareShot} onClose={() => setShareShot(null)} />
          <CloudShotsDialog open={cloudOpen} onClose={() => setCloudOpen(false)} />
        </>
      )}
    </div>
  );
}
