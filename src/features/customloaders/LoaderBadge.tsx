import { Puzzle } from "lucide-react";
import { LoaderIcon } from "@/components/instance/LoaderIcon";
import { imageSrc } from "@/lib/format";
import type { Instance } from "@/lib/types";
import { findPack, instanceLoaderText, useCustomLoaders } from "./api";

export function PackIcon({ src, size = 16 }: { src: string | null | undefined; size?: number }) {
  const url = imageSrc(src);
  if (url) return <img src={url} alt="" width={size} height={size} className="shrink-0 rounded-[3px] [image-rendering:pixelated]" draggable={false} />;
  return <Puzzle size={size} className="shrink-0 text-accent" aria-hidden />;
}

export function InstanceLoaderIcon({ instance: i, size = 16 }: { instance: Instance; size?: number }) {
  const packs = useCustomLoaders().data;
  if (i.custom_loader) return <PackIcon src={findPack(packs, i.custom_loader)?.icon_path} size={size} />;
  return <LoaderIcon loader={i.loader.kind} size={size} />;
}

export function useLoaderText(): (i: Instance) => string {
  const packs = useCustomLoaders().data;
  return (i) => instanceLoaderText(i, packs);
}

export function CustomLoaderLine({ instance: i, suffix }: { instance: Instance; suffix?: string }) {
  const packs = useCustomLoaders().data;
  if (!i.custom_loader) return null;
  return (
    <span className="inline-flex min-w-0 items-center gap-1" title={instanceLoaderText(i, packs)}>
      <PackIcon src={findPack(packs, i.custom_loader)?.icon_path} size={12} />
      <span className="truncate">
        {instanceLoaderText(i, packs)}
        {suffix ? ` · ${suffix}` : ""}
      </span>
    </span>
  );
}
