import { memo, useState } from "react";
import { cn } from "@/components/ui";
import { imageSrc } from "@/lib/format";
import { BlockArt } from "./blocks/BlockArt";
import { autoDesign, backgroundCss, parseBlockIcon, type BlockIcon } from "./blocks/catalog";
import { PixelBlock } from "./blocks/LegacyBlock";

export { shade } from "./blocks/color";
export { PixelBlock };

export function useInstanceArt(icon: string | null | undefined, seed: string | undefined) {
  const [failed, setFailed] = useState<string | null>(null);
  const block = parseBlockIcon(icon, seed);
  const src = block ? undefined : imageSrc(icon);
  const img = src && failed !== src ? src : undefined;
  const art: BlockIcon | null = block ?? (!img && seed ? { design: autoDesign(seed), bg: null } : null);
  return { img, art, onError: () => src && setFailed(src) };
}

export const InstanceIcon = memo(function InstanceIcon({
  icon,
  accent,
  seed,
  size = 48,
  className,
}: {
  icon: string | null | undefined;
  accent: string;
  seed?: string;
  size?: number;
  className?: string;
}) {
  const { img, art, onError } = useInstanceArt(icon, seed);
  return (
    <div
      className={cn("relative grid shrink-0 place-items-center overflow-hidden bg-surface2", className)}
      style={{
        width: size,
        height: size,
        borderRadius: `calc(var(--r) * ${Math.max(0.75, Math.min(2.4, size / 36)).toFixed(2)})`,
        background: art ? backgroundCss(art.bg, accent) : undefined,
      }}
    >
      {img ? (
        <img
          src={img}
          alt=""
          draggable={false}
          loading="lazy"
          decoding="async"
          onError={onError}
          className="h-full w-full object-cover [image-rendering:pixelated]"
        />
      ) : art ? (
        <BlockArt design={art.design} accent={accent} size={size} cover />
      ) : (
        <PixelBlock color={accent} size={Math.round(size * 0.66)} />
      )}
    </div>
  );
});
