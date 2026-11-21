import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { Crosshair, MapPin, Minus, Plus } from "lucide-react";
import { IconButton, Tooltip } from "@/components/ui";
import { useT } from "@/i18n";
import type { MapWaypoint } from "./api";

export interface MapLayer {
  key: string;
  src: string;
  x: number;
  z: number;
  size: number;
}

export interface MapView {
  x: number;
  z: number;
  zoom: number;
  width: number;
  height: number;
}

interface Props {
  layers: MapLayer[];
  waypoints?: MapWaypoint[];
  pin?: { x: number; z: number } | null;
  home: { x: number; z: number };
  initialZoom: number;
  minZoom: number;
  maxZoom: number;
  label: string;
  className?: string;
  onView?: (view: MapView) => void;
  children?: ReactNode;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function ink(color: string) {
  const value = Number.parseInt(color.slice(1), 16);
  const light = 0.299 * ((value >> 16) & 255) + 0.587 * ((value >> 8) & 255) + 0.114 * (value & 255);
  return light > 140 ? "#000" : "#fff";
}

export function MapViewport({ layers, waypoints = [], pin, home, initialZoom, minZoom, maxZoom, label, className, onView, children }: Props) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; z: number; startX: number; startY: number } | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState({ x: home.x, z: home.z, zoom: clamp(initialZoom, minZoom, maxZoom) });
  const [cursor, setCursor] = useState<{ x: number; z: number } | null>(null);

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (size.width && size.height) onView?.({ ...view, ...size });
  }, [view, size, onView]);

  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = box.current!.getBoundingClientRect();
      return {
        x: view.x + (clientX - rect.left - rect.width / 2) / view.zoom,
        z: view.z + (clientY - rect.top - rect.height / 2) / view.zoom,
      };
    },
    [view],
  );

  const zoomBy = useCallback(
    (factor: number, anchor?: { x: number; z: number }) => {
      setView((current) => {
        const zoom = clamp(current.zoom * factor, minZoom, maxZoom);
        if (!anchor) return { ...current, zoom };
        const scale = current.zoom / zoom;
        return { zoom, x: anchor.x - (anchor.x - current.x) * scale, z: anchor.z - (anchor.z - current.z) * scale };
      });
    },
    [minZoom, maxZoom],
  );

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      setView((current) => {
        const zoom = clamp(current.zoom * (event.deltaY < 0 ? 1.25 : 0.8), minZoom, maxZoom);
        const ax = current.x + (event.clientX - rect.left - rect.width / 2) / current.zoom;
        const az = current.z + (event.clientY - rect.top - rect.height / 2) / current.zoom;
        const scale = current.zoom / zoom;
        return { zoom, x: ax - (ax - current.x) * scale, z: az - (az - current.z) * scale };
      });
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [minZoom, maxZoom]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, x: view.x, z: view.z, startX: event.clientX, startY: event.clientY };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (active && active.id === event.pointerId) {
      setView((current) => ({
        ...current,
        x: active.x - (event.clientX - active.startX) / current.zoom,
        z: active.z - (event.clientY - active.startY) / current.zoom,
      }));
    }
    const point = toWorld(event.clientX, event.clientY);
    setCursor({ x: Math.floor(point.x), z: Math.floor(point.z) });
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id === event.pointerId) drag.current = null;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = 64 / view.zoom;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[event.key]) {
      event.preventDefault();
      const [dx, dz] = moves[event.key];
      setView((current) => ({ ...current, x: current.x + dx, z: current.z + dz }));
    } else if (event.key === "+" || event.key === "=") {
      zoomBy(1.25);
    } else if (event.key === "-") {
      zoomBy(0.8);
    } else if (event.key === "0" || event.key === "Home") {
      setView({ x: home.x, z: home.z, zoom: clamp(initialZoom, minZoom, maxZoom) });
    }
  };

  const screen = (x: number, z: number) => ({ left: (x - view.x) * view.zoom + size.width / 2, top: (z - view.z) * view.zoom + size.height / 2 });
  const pixelated = view.zoom >= 1;

  return (
    <div className={className}>
      <div
        ref={box}
        role="application"
        aria-roledescription={t("mod_map.viewport")}
        aria-label={label}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setCursor(null)}
        onKeyDown={onKeyDown}
        className="relative h-full w-full cursor-grab touch-none select-none overflow-hidden rounded-card border border-line2 bg-surface2 outline-none focus-visible:ring-2 focus-visible:ring-accent active:cursor-grabbing"
      >
        {size.width > 0 &&
          layers.map((layer) => {
            const { left, top } = screen(layer.x, layer.z);
            const side = layer.size * view.zoom;
            if (left > size.width || top > size.height || left + side < 0 || top + side < 0) return null;
            return (
              <img
                key={layer.key}
                src={layer.src}
                alt=""
                draggable={false}
                className="pointer-events-none absolute max-w-none"
                style={{ left, top, width: side, height: side, imageRendering: pixelated ? "pixelated" : "auto" }}
              />
            );
          })}
        {size.width > 0 &&
          waypoints.map((point, index) => {
            const { left, top } = screen(point.x + 0.5, point.z + 0.5);
            if (left < -40 || top < -40 || left > size.width + 40 || top > size.height + 40) return null;
            return (
              <Tooltip key={`${point.name}-${index}`} content={`${point.name} · X ${point.x}, Z ${point.z}`}>
                <span
                  className="absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1"
                  style={{ left, top }}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <span
                    aria-hidden="true"
                    className="grid h-4 min-w-4 place-items-center rounded-[4px] border border-black/40 px-0.5 text-[9px] font-bold leading-none shadow-sm"
                    style={{ background: point.color, color: ink(point.color) }}
                  >
                    {point.death ? "✝" : point.initials.slice(0, 2)}
                  </span>
                  {view.zoom >= 0.5 && (
                    <span className="max-w-32 truncate rounded-[4px] bg-black/60 px-1 text-[10.5px] font-semibold leading-4 text-white">{point.name}</span>
                  )}
                </span>
              </Tooltip>
            );
          })}
        {pin && size.width > 0 && (
          <MapPin
            size={21}
            aria-hidden="true"
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-full fill-accent text-overlay drop-shadow-md"
            style={screen(pin.x + 0.5, pin.z + 0.5)}
          />
        )}
        <span aria-hidden="true" className="absolute right-2 top-2 rounded-ctl border border-line2 bg-overlay/90 px-2 py-1 text-xs font-semibold text-text shadow-sm">
          {t("world_map.north")}
        </span>
        <div className="absolute bottom-2 right-2 flex flex-col gap-1 rounded-ctl border border-line2 bg-overlay/90 p-0.5 shadow-sm" onPointerDown={(event) => event.stopPropagation()}>
          <IconButton label={t("mod_map.zoom_in")} size="sm" variant="ghost" disabled={view.zoom >= maxZoom} onClick={() => zoomBy(1.5)}>
            <Plus size={15} />
          </IconButton>
          <IconButton label={t("mod_map.zoom_out")} size="sm" variant="ghost" disabled={view.zoom <= minZoom} onClick={() => zoomBy(1 / 1.5)}>
            <Minus size={15} />
          </IconButton>
          <IconButton
            label={t("mod_map.reset")}
            size="sm"
            variant="ghost"
            onClick={() => setView({ x: home.x, z: home.z, zoom: clamp(initialZoom, minZoom, maxZoom) })}
          >
            <Crosshair size={15} />
          </IconButton>
        </div>
        {cursor && (
          <span aria-hidden="true" className="pointer-events-none absolute bottom-2 left-2 rounded-ctl bg-overlay/90 px-2 py-1 font-mono text-[11px] text-text shadow-sm">
            X {cursor.x} · Z {cursor.z}
          </span>
        )}
        {children}
      </div>
    </div>
  );
}
