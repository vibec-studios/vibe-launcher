import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { DEFAULT_APPEARANCE } from "@/lib/appearance";
import type { LargeArt, SmallArt } from "@/lib/discordArt";
import { PlayerHead } from "@/components/PlayerHead";
import { LoaderIcon } from "@/components/instance/LoaderIcon";

function useIconPreview(motif: "seal" | "penguin" | null) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!motif) return;
    let alive = true;
    api
      .appIconPreview(motif, DEFAULT_APPEARANCE.app_icon_color, null, 128)
      .then((u) => alive && setSrc(u))
      .catch(() => alive && setSrc(null));
    return () => {
      alive = false;
    };
  }, [motif]);
  return motif ? src : null;
}

function Large({ art }: { art: LargeArt }) {
  const icon = useIconPreview(art.kind === "icon" ? art.motif : null);
  if (art.kind === "head") {
    return (
      <span className="block overflow-hidden rounded-ctl">
        <PlayerHead uuid={art.account.uuid} name={art.account.username} size={64} />
      </span>
    );
  }
  const src = art.kind === "logo" ? "/logo.png" : icon;
  return src ? (
    <img src={src} alt="" className="h-16 w-16 rounded-ctl object-cover [image-rendering:pixelated]" draggable={false} />
  ) : (
    <span className="block h-16 w-16 rounded-ctl bg-surface2" />
  );
}

function Small({ art }: { art: SmallArt }) {
  if (!art) return null;
  return (
    <span className="absolute -bottom-1 -right-1 grid h-7 w-7 place-items-center overflow-hidden rounded-full bg-surface ring-[3px] ring-surface">
      {art.kind === "head" ? <PlayerHead uuid={art.account.uuid} name={art.account.username} size={28} /> : <LoaderIcon loader="fabric" size={18} />}
    </span>
  );
}

export function DiscordPreview({ large, small, title }: { large: LargeArt; small: SmallArt; title: string }) {
  return (
    <span className="grid h-[88px] w-[88px] shrink-0 place-items-center rounded-card bg-field" title={title} aria-label={title}>
      <span className="relative">
        <Large art={large} />
        <Small art={small} />
      </span>
    </span>
  );
}
