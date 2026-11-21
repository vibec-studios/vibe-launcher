import { Play, RotateCcw } from "lucide-react";
import { Button, Tag } from "@/components/ui";
import { useT } from "@/i18n";
import { tourById } from "./content/catalog";
import { launchTour } from "./store";
import { useTours } from "./tour/store";
import type { TourId } from "./types";

export function TourStatus({ id }: { id: TourId }) {
  const t = useT();
  const p = useTours((s) => s.progress[id]);
  const total = tourById(id)?.steps.length ?? 0;
  if (p?.done) return <Tag className="text-ok">{t("help.status.done")}</Tag>;
  if (p?.seen && p.step > 0) return <Tag>{t("help.status.started", { n: p.step + 1, total })}</Tag>;
  return null;
}

export function TourButton({ id, size = "sm" }: { id: TourId; size?: "sm" | "md" }) {
  const t = useT();
  const p = useTours((s) => s.progress[id]);
  const resume = !!p?.seen && !p.done && p.step > 0;
  return (
    <Button
      size={size}
      variant={p?.done ? "ghost" : "primary"}
      data-testid={`tour-start-${id}`}
      icon={p?.done ? <RotateCcw size={13} /> : resume ? <Play size={13} /> : <Play size={13} fill="currentColor" />}
      onClick={() => launchTour(id, resume)}
    >
      {p?.done ? t("help.tour.again") : resume ? t("help.tour.resume") : t("help.tour.start")}
    </Button>
  );
}

