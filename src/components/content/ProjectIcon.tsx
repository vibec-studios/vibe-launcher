// Projekt-/Mod-Icon mit festen Maßen (kein Layout-Springen), lazy geladen, mit Pixel-Platzhalter.
import { Box } from "lucide-react";
import { memo, useState } from "react";
import { cn } from "@/components/ui";
import { imageSrc } from "@/lib/format";

export const ProjectIcon = memo(function ProjectIcon({
  src,
  size = 48,
  className,
  eager,
}: {
  src: string | null | undefined;
  size?: number;
  className?: string;
  eager?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const url = imageSrc(src);
  return (
    <span
      className={cn("relative grid shrink-0 place-items-center overflow-hidden border border-line bg-surface2 text-dim", className)}
      style={{ width: size, height: size }}
    >
      {url && !failed ? (
        <img
          src={url}
          alt=""
          width={size}
          height={size}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <Box size={Math.round(size * 0.42)} strokeWidth={1.5} />
      )}
    </span>
  );
});
