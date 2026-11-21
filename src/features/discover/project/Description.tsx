import { useT } from "@/i18n";
import type { ProjectDetails } from "@/lib/types";
import { RichText } from "@/components/content/RichText";
import type { ViewProject } from "./types";

export function Description({ p }: { p: ViewProject }) {
  const t = useT();
  if (!p.body.trim()) return <p className="text-[13px] text-dim">{t("project.no_description")}</p>;
  return (
    <div className="max-w-[780px] animate-fade-in">
      <RichText source={p.body} format={p.body_format} />
    </div>
  );
}

export function Gallery({ images, onOpen }: { images: ProjectDetails["gallery"]; onOpen: (i: number) => void }) {
  const t = useT();
  if (!images.length) return <p className="text-[13px] text-dim">{t("project.no_gallery")}</p>;
  return (
    <div className="grid grid-cols-2 gap-3 animate-fade-in @min-[1000px]:grid-cols-3">
      {images.map((g, i) => (
        <button
          key={g.url}
          onClick={() => onOpen(i)}
          className="group flex flex-col overflow-hidden rounded-card bg-surface text-left transition-colors duration-150 hover:bg-surface2"
        >
          <span className="relative block aspect-video w-full overflow-hidden bg-surface2">
            <img
              src={g.url}
              alt={g.title ?? ""}
              loading="lazy"
              decoding="async"
              draggable={false}
              className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 ease-[var(--ease-snap)] group-hover:scale-[1.03]"
            />
          </span>
          <span className="flex h-[44px] flex-col justify-center px-3">
            <span className="truncate text-[13px] font-medium text-text">{g.title || t("project.image", { n: i + 1 })}</span>
            {g.description && <span className="truncate text-[12px] text-dim">{g.description}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}
