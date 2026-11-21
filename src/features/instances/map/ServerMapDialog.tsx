import { useState } from "react";
import { Dialog } from "@/components/ui";
import { useT } from "@/i18n";
import type { MapSource } from "./api";
import { DimensionPicker, SourcePicker, newestPerKind } from "./MapControls";
import { ModMap } from "./ModMap";

export function ServerMapDialog({ instanceId, name, sources, onClose }: { instanceId: string; name: string; sources: MapSource[]; onClose: () => void }) {
  const t = useT();
  const choices = newestPerKind(sources);
  const [sourceId, setSourceId] = useState(choices[0]?.id ?? "");
  const [dimensionChoice, setDimensionChoice] = useState("minecraft:overworld");
  const source = choices.find((candidate) => candidate.id === sourceId) ?? choices[0];
  if (!source) return null;
  const dimension = source.dimensions.includes(dimensionChoice) ? dimensionChoice : source.dimensions[0];
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} size="xl" title={name} description={t("mod_map.server_title")}>
      <section className="grid min-w-0 gap-3 pb-3" aria-label={t("mod_map.server_title")}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <SourcePicker sources={choices} value={source.id} withWorld={false} onChange={setSourceId} />
          <DimensionPicker dimensions={source.dimensions} value={dimension} onChange={setDimensionChoice} />
        </div>
        {dimension && <ModMap instanceId={instanceId} source={source} dimension={dimension} />}
      </section>
    </Dialog>
  );
}
