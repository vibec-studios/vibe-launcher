import { useState } from "react";

/** Spielerkopf (Skin-Gesicht). Fällt auf ein Pixel-Monogramm zurück, wenn offline/kein Skin. */
export function PlayerHead({ uuid, name, size = 24 }: { uuid: string; name: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const clean = uuid.replace(/-/g, "");
  if (failed || !clean) {
    return (
      <span
        className="grid shrink-0 place-items-center bg-brand font-display text-white"
        style={{ width: size, height: size, fontSize: Math.max(8, size * 0.5) }}
        aria-hidden
      >
        {name.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return (
    <img
      src={`https://mc-heads.net/avatar/${clean}/${Math.max(size * 2, 32)}`}
      alt=""
      width={size}
      height={size}
      draggable={false}
      onError={() => setFailed(true)}
      className="shrink-0 [image-rendering:pixelated]"
      style={{ width: size, height: size }}
    />
  );
}
