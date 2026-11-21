import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { save } from "@tauri-apps/plugin-dialog";
import { Copy, Download, MapPin } from "lucide-react";
import { Button, Dialog, Skeleton, Spinner, toast } from "@/components/ui";
import { Term } from "@/features/help/glossary/Term";
import { useT } from "@/i18n";
import { formatBytes, formatDuration } from "@/lib/format";
import type { World } from "@/lib/types";
import { worldPreviewApi, type MapCenter, type WorldMapPreview } from "./worldPreviewApi";

const MODES = ["survival", "creative", "adventure", "spectator", "hardcore"];
const DIMENSIONS: Record<string, string> = {
  "minecraft:overworld": "world_map.overworld",
  "minecraft:the_nether": "world_map.nether",
  "minecraft:the_end": "world_map.end",
};

export function worldModeLabel(mode: string | null | undefined, t: (key: string) => string) {
  const normalized = mode?.toLowerCase();
  return normalized && MODES.includes(normalized) ? t(`worlds.mode.${normalized}`) : mode;
}

type MapState =
  | { status: "loading" | "stopped" | "empty" | "error" }
  | { status: "ready"; map: WorldMapPreview };

function WorldMap({ instanceId, folder, center }: { instanceId: string; folder: string; center: MapCenter }) {
  const t = useT();
  const [state, setState] = useState<MapState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [copying, setCopying] = useState(false);
  const active = useRef<AbortController>(null);

  useEffect(() => {
    const controller = new AbortController();
    active.current = controller;
    worldPreviewApi.render(instanceId, folder, center, controller.signal).then((map) => {
      if (!controller.signal.aborted) setState(map ? { status: "ready", map } : { status: "empty" });
    }).catch(() => {
      if (!controller.signal.aborted) setState({ status: "error" });
    });
    return () => controller.abort();
  }, [instanceId, folder, center, attempt]);

  if (state.status !== "ready") {
    return (
      <div role="status" className="grid min-h-48 place-content-center justify-items-center gap-3 rounded-card bg-surface2 p-5 text-center text-sm text-muted">
        {state.status === "loading" && <Spinner size={22} />}
        <p>{t(`world_map.state.${state.status}`)}</p>
        {state.status === "loading" ? (
          <Button size="sm" variant="outline" onClick={() => {
            active.current?.abort();
            setState({ status: "stopped" });
          }}>
            {t("common.cancel")}
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={() => {
            setState({ status: "loading" });
            setAttempt((attempt) => attempt + 1);
          }}>
            {t("common.retry")}
          </Button>
        )}
      </div>
    );
  }

  const { png, position: { x, z, dimension }, radius } = state.map;
  const dimKey = DIMENSIONS[dimension];
  const location = t("world_map.location", { x, z, dimension: dimKey ? t(dimKey) : dimension });
  const exportImage = async () => {
    setSaving(true);
    try {
      const name = folder.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 100);
      const defaultPath = `${name}-${center}.png`;
      const path = import.meta.env.VITE_MOCK === "1" ? defaultPath : await save({
        title: t("world_map.export"),
        defaultPath,
        filters: [{ name: "PNG", extensions: ["png"] }],
      });
      if (path) {
        await worldPreviewApi.export(path, png);
        toast.success(t("world_map.exported"));
      }
    } catch {
      toast.error(t("world_map.export_failed"));
    } finally {
      setSaving(false);
    }
  };
  const copyImage = async () => {
    setCopying(true);
    try {
      await worldPreviewApi.copy(png);
      toast.success(t("world_map.copied"));
    } catch {
      toast.error(t("world_map.copy_failed"));
    } finally {
      setCopying(false);
    }
  };
  return (
    <div>
      <figure>
        <div className="relative mx-auto aspect-square w-full max-w-[420px] overflow-hidden rounded-card border border-line2 bg-surface2">
          <img
            src={`data:image/png;base64,${png}`}
            alt={t("world_map.alt", { location })}
            className="h-full w-full [image-rendering:pixelated]"
            draggable={false}
          />
          <MapPin
            size={21}
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full fill-accent text-overlay drop-shadow-md"
          />
          <span aria-hidden="true" className="absolute right-2 top-2 rounded-ctl border border-line2 bg-overlay/90 px-2 py-1 text-xs font-semibold text-text shadow-sm">
            {t("world_map.north")}
          </span>
        </div>
        <figcaption className="pt-2 text-xs leading-relaxed text-muted">
          {t("world_map.caption", { location, radius })}
        </figcaption>
      </figure>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="accent" icon={<Download size={14} />} loading={saving} onClick={() => void exportImage()}>
          {t("world_map.export")}
        </Button>
        <Button size="sm" icon={<Copy size={14} />} loading={copying} onClick={() => void copyImage()}>
          {t("world_map.copy")}
        </Button>
      </div>
    </div>
  );
}

function WorldDetail({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 break-all text-sm font-semibold text-text">{children}</dd>
    </div>
  );
}

export function WorldPreviewDialog({ instanceId, world, onClose }: { instanceId: string; world: World; onClose: () => void }) {
  const t = useT();
  const [selection, setSelection] = useState<MapCenter | null>(null);
  const query = useQuery({
    queryKey: ["world-preview-info", instanceId, world.folder],
    queryFn: () => worldPreviewApi.info(instanceId, world.folder),
    retry: false,
  });
  const info = query.data;
  const center = selection && info?.[selection] ? selection : info?.player ? "player" : info?.spawn ? "spawn" : null;
  const unknown = t("world_map.unknown");
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} size="lg" title={world.name} description={t("world_map.title")}>
      <div className="grid items-start gap-5 pb-3 sm:grid-cols-[minmax(0,1fr)_minmax(165px,0.46fr)]">
        <dl className="grid grid-cols-2 gap-4 rounded-card bg-surface2 p-4 sm:order-2 sm:grid-cols-1">
          <WorldDetail label={<Term id="seed" />}>
            {query.isPending ? <Skeleton className="h-4 w-28" /> : <span className="font-mono">{info?.seed ?? unknown}</span>}
          </WorldDetail>
          <WorldDetail label={t("world_map.mode")}>{worldModeLabel(world.game_mode, t) ?? unknown}</WorldDetail>
          <WorldDetail label={t("world_map.play_time")}>
            {query.isPending ? <Skeleton className="h-4 w-16" /> : info?.play_seconds != null ? formatDuration(info.play_seconds) : unknown}
          </WorldDetail>
          <WorldDetail label={t("world_map.version")}>
            {query.isPending ? <Skeleton className="h-4 w-16" /> : info?.version ?? (info?.data_version != null ? t("world_map.data_version", { version: info.data_version }) : unknown)}
          </WorldDetail>
          <WorldDetail label={t("world_map.size")}>{world.size != null ? formatBytes(world.size) : unknown}</WorldDetail>
        </dl>
        <section className="min-w-0" aria-label={t("world_map.title")}>
          {info ? (
            <>
              {center ? (
                <>
                  <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label={t("world_map.center")}>
                    {(["spawn", "player"] as const).filter((key) => info[key]).map((key) => (
                      <Button key={key} size="sm" variant={center === key ? "accent" : "ghost"} aria-pressed={center === key} onClick={() => setSelection(key)}>
                        {t(`world_map.center.${key}`)}
                      </Button>
                    ))}
                  </div>
                  <WorldMap key={center} instanceId={instanceId} folder={world.folder} center={center} />
                </>
              ) : <p className="text-sm text-muted">{t("world_map.no_position")}</p>}
            </>
          ) : query.isError ? (
            <div className="grid justify-items-start gap-3 text-sm text-muted" role="status">
              <p>{t("world_map.info_failed")}</p>
              <Button size="sm" onClick={() => void query.refetch()}>{t("common.retry")}</Button>
            </div>
          ) : (
            <div role="status" className="flex items-center gap-2 text-sm text-muted"><Spinner size={16} />{t("world_map.loading_info")}</div>
          )}
        </section>
      </div>
    </Dialog>
  );
}
