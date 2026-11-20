import { useState } from "react";
import { useAccounts } from "@/lib/queries";

/** Spielerkopf (Skin-Gesicht). Nutzt für eigene Accounts direkt die Skin-Textur (sofort aktuell nach
 *  Skin-Änderungen), sonst mc-heads.net. Fällt auf ein Pixel-Monogramm zurück, wenn kein Skin ladbar ist. */
export function PlayerHead({ uuid, name, size = 24 }: { uuid: string; name: string; size?: number }) {
  const [failed, setFailed] = useState<string | null>(null);
  const clean = uuid.replace(/-/g, "").toLowerCase();
  const accounts = useAccounts().data;
  const skinUrl = accounts?.find((a) => a.uuid.replace(/-/g, "").toLowerCase() === clean)?.skin_url?.replace(/^http:\/\//, "https://") ?? null;
  const src = skinUrl ?? (clean ? `https://mc-heads.net/avatar/${clean}/${Math.max(size * 2, 32)}` : null);

  if (!src || failed === src) {
    return (
      <span
        className="grid shrink-0 place-items-center bg-brand font-display text-[var(--ui-on-accent)]"
        style={{ width: size, height: size, fontSize: Math.max(8, size * 0.5) }}
        aria-hidden
      >
        {name.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  if (skinUrl) {
    // Gesicht (8,8) + Hut-Schicht (40,8) aus der 64er-Textur, pixelgenau skaliert
    const f = size / 8;
    const layer = (x: number) => ({
      backgroundImage: `url("${skinUrl}")`,
      backgroundSize: `${64 * f}px auto`,
      backgroundPosition: `${-x * f}px ${-8 * f}px`,
    });
    return (
      <span className="relative block shrink-0 overflow-hidden [image-rendering:pixelated]" style={{ width: size, height: size }} aria-hidden>
        <span className="absolute inset-0 bg-no-repeat" style={layer(8)} />
        <span className="absolute inset-0 bg-no-repeat" style={layer(40)} />
        {/* unsichtbares Bild nur zur Fehlererkennung */}
        <img src={skinUrl} alt="" className="hidden" onError={() => setFailed(skinUrl)} />
      </span>
    );
  }
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      draggable={false}
      onError={() => setFailed(src)}
      className="shrink-0 [image-rendering:pixelated]"
      style={{ width: size, height: size }}
    />
  );
}
