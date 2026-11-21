import { useEffect, useMemo, useRef, useState } from "react";
import { isCancelled } from "@/lib/api";
import { LODS, REGION, worldMapApi, type MapOverview } from "./api";
import type { MapLayer, MapView } from "./MapViewport";

const PARALLEL = 2;
const MAX_CACHED = 360;

type Entry = { src: string } | "empty" | "error";

export function lodFor(zoom: number) {
  return LODS.find((lod) => 1 / lod <= zoom * 1.01) ?? LODS[LODS.length - 1];
}

function visibleRegions(view: MapView, known: Set<string>) {
  const halfW = view.width / 2 / view.zoom;
  const halfH = view.height / 2 / view.zoom;
  const minX = Math.floor((view.x - halfW) / REGION);
  const maxX = Math.floor((view.x + halfW) / REGION);
  const minZ = Math.floor((view.z - halfH) / REGION);
  const maxZ = Math.floor((view.z + halfH) / REGION);
  const out: [number, number][] = [];
  for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) if (known.has(`${x},${z}`)) out.push([x, z]);
  const cx = view.x / REGION;
  const cz = view.z / REGION;
  return out.sort((a, b) => Math.hypot(a[0] + 0.5 - cx, a[1] + 0.5 - cz) - Math.hypot(b[0] + 0.5 - cx, b[1] + 0.5 - cz));
}

export function useTiles(instanceId: string, source: string, overview: MapOverview | null | undefined, view: MapView | null) {
  const [session, setSession] = useState<string | null>(null);
  const cache = useRef(new Map<string, Entry>());
  const running = useRef(new Set<string>());
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(0);
  const layer = overview?.layer;
  const known = useMemo(() => new Set((overview?.regions ?? []).map(([x, z]) => `${x},${z}`)), [overview]);

  useEffect(() => {
    cache.current.clear();
    running.current.clear();
    setVersion((value) => value + 1);
  }, [source, layer]);

  useEffect(() => {
    const id = crypto.randomUUID();
    setSession(id);
    return () => {
      setSession(null);
      void worldMapApi.cancel(id).catch(() => {});
    };
  }, []);

  const visible = useMemo(() => (view ? visibleRegions(view, known) : []), [view, known]);
  const lod = view ? lodFor(view.zoom) : LODS[LODS.length - 1];

  useEffect(() => {
    if (!layer || !session) return;
    let alive = true;
    const pending = visible.filter(([x, z]) => {
      const key = `${source}|${layer}|${lod}:${x}:${z}`;
      return !cache.current.has(key) && !running.current.has(key);
    });
    const pump = () => {
      while (alive && running.current.size < PARALLEL && pending.length) {
        const [x, z] = pending.shift()!;
        const key = `${source}|${layer}|${lod}:${x}:${z}`;
        if (cache.current.has(key) || running.current.has(key)) continue;
        running.current.add(key);
        setLoading(running.current.size);
        let stopped = false;
        worldMapApi
          .tile(instanceId, source, layer, x, z, lod, session)
          .then((tile) => cache.current.set(key, tile ? { src: `data:image/png;base64,${tile.png}` } : "empty"))
          .catch((error) => {
            if (isCancelled(error)) stopped = true;
            else cache.current.set(key, "error");
          })
          .finally(() => {
            running.current.delete(key);
            if (stopped) return;
            if (cache.current.size > MAX_CACHED) {
              const first = cache.current.keys().next().value;
              if (first) cache.current.delete(first);
            }
            setLoading(running.current.size);
            setVersion((value) => value + 1);
            pump();
          });
      }
    };
    pump();
    return () => {
      alive = false;
    };
  }, [instanceId, source, layer, lod, visible, session, version]);

  const layers = useMemo<MapLayer[]>(() => {
    if (!layer) return [];
    const out: MapLayer[] = [];
    for (const [x, z] of visible) {
      const order = [lod, ...LODS.filter((other) => other !== lod)];
      for (const candidate of order) {
        const entry = cache.current.get(`${source}|${layer}|${candidate}:${x}:${z}`);
        if (entry && typeof entry === "object") {
          out.push({ key: `${x}:${z}`, src: entry.src, x: x * REGION, z: z * REGION, size: REGION });
          break;
        }
      }
    }
    return out;
  }, [visible, lod, layer, source, version]);

  const failed = useMemo(
    () => visible.length > 0 && visible.every(([x, z]) => cache.current.get(`${source}|${layer}|${lod}:${x}:${z}`) === "error"),
    [visible, lod, layer, source, version],
  );

  return { layers, loading, failed, visibleCount: visible.length };
}
