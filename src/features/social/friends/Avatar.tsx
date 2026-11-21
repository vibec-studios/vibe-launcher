import { memo } from "react";
import { PlayerHead } from "@/components/PlayerHead";
import type { Friend, PublicUser } from "@/lib/vibe-sdk";
import { PresenceDot } from "../presence";
import { renderFace, useRender } from "../skinRender";

type AvatarUser = Pick<PublicUser, "id" | "name"> & { skin?: { url: string | null } | null };

/** Skin-URL (http -> https, CSP erlaubt nur https). */
export function skinUrlOf(u: { skin?: { url: string | null } | null } | null | undefined): string | null {
  return u?.skin?.url ? u.skin.url.replace(/^http:\/\//, "https://") : null;
}

/** Gesicht + Hut-Schicht aus der Skin-Textur (Canvas, pixelgenau), Fallback: PlayerHead über die UUID. */
const SkinFace = memo(function SkinFace({ url, size, user }: { url: string; size: number; user: AvatarUser }) {
  const face = useRender(url, () => renderFace(url));
  if (face.failed) return <PlayerHead uuid={user.id} name={user.name} size={size} />;
  return (
    <span className="relative block shrink-0 overflow-hidden bg-surface2" style={{ width: size, height: size }} aria-hidden>
      {face.url && <img src={face.url} alt="" draggable={false} className="h-full w-full animate-fade-in [image-rendering:pixelated]" />}
    </span>
  );
});

export function Avatar({ user, size = 32, presence, ring }: { user: AvatarUser; size?: number; presence?: Friend["presence"] | null; ring?: string }) {
  const skin = skinUrlOf(user);
  return (
    <span className="relative block shrink-0" style={{ width: size, height: size }}>
      {skin ? <SkinFace url={skin} size={size} user={user} /> : <PlayerHead uuid={user.id} name={user.name} size={size} />}
      {presence !== undefined && (
        <PresenceDot presence={presence} ring={ring} size={Math.max(8, Math.round(size * 0.28))} className="absolute -bottom-[3px] -right-[3px]" />
      )}
    </span>
  );
}
