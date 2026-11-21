import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Spinner } from "@/components/ui";
import { useT } from "@/i18n";
import { REGION, worldMapApi, type MapSource } from "./api";
import { MapViewport, type MapView } from "./MapViewport";
import { useTiles } from "./useTiles";

interface Props {
  instanceId: string;
  source: MapSource;
  dimension: string;
  pin?: { x: number; z: number } | null;
}

function ModMapCanvas({ instanceId, source, dimension, pin }: Props) {
  const t = useT();
  const query = useQuery({
    queryKey: ["world-map-overview", instanceId, source.id, dimension],
    queryFn: () => worldMapApi.overview(instanceId, source.id, dimension),
    retry: false,
  });
  const overview = query.data;
  const [view, setView] = useState<MapView | null>(null);
  const tiles = useTiles(instanceId, source.id, overview, view);
  const home = useMemo(() => {
    if (pin) return pin;
    const region = overview?.latest ?? overview?.regions[0];
    return region ? { x: region[0] * REGION + REGION / 2, z: region[1] * REGION + REGION / 2 } : { x: 0, z: 0 };
  }, [overview, pin]);

  if (query.isPending || query.isError || !overview) {
    return (
      <div role="status" className="grid h-[460px] place-content-center justify-items-center gap-3 rounded-card bg-surface2 p-5 text-center text-sm text-muted">
        {query.isPending ? (
          <>
            <Spinner size={22} />
            <p>{t("mod_map.loading")}</p>
          </>
        ) : query.isError ? (
          <>
            <p>{t("mod_map.failed")}</p>
            <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
              {t("common.retry")}
            </Button>
          </>
        ) : (
          <p className="max-w-sm">{t("mod_map.no_data")}</p>
        )}
      </div>
    );
  }

  return (
    <div>
      <MapViewport
        key={`${source.id}|${dimension}|${overview.layer}`}
        className="h-[460px]"
        layers={tiles.layers}
        waypoints={overview.waypoints}
        pin={pin}
        home={home}
        initialZoom={0.5}
        minZoom={1 / 8}
        maxZoom={8}
        label={t("mod_map.label", { name: source.name })}
        onView={setView}
      >
        {tiles.loading > 0 && (
          <span role="status" className="pointer-events-none absolute left-2 top-2 flex items-center gap-2 rounded-ctl bg-overlay/90 px-2 py-1 text-xs text-text shadow-sm">
            <Spinner size={12} />
            {t("mod_map.tiles_loading")}
          </span>
        )}
        {view !== null && tiles.visibleCount === 0 && (
          <span className="pointer-events-none absolute inset-x-0 top-1/2 mx-auto w-fit -translate-y-1/2 rounded-ctl bg-overlay/90 px-3 py-1.5 text-xs text-muted shadow-sm">
            {t("mod_map.unexplored")}
          </span>
        )}
      </MapViewport>
      <p className="pt-2 text-xs leading-relaxed text-muted">
        {t(source.kind === "xaero" ? "mod_map.hint.xaero" : "mod_map.hint.journeymap")}
        {overview.waypoints.length > 0 && ` ${t("mod_map.hint.waypoints", { n: overview.waypoints.length })}`}
        {overview.cave && ` ${t("mod_map.hint.cave")}`}
        {overview.truncated && ` ${t("mod_map.hint.truncated")}`}
        {tiles.failed && ` ${t("mod_map.hint.unreadable")}`}
        {` ${t("mod_map.hint.controls")}`}
      </p>
    </div>
  );
}

export function ModMap(props: Props) {
  return <ModMapCanvas key={`${props.source.id}|${props.dimension}`} {...props} />;
}
