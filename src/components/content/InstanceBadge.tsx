import { memo, useState } from "react";
import { imageSrc, instanceAccent, onAccent } from "@/lib/format";
import type { Instance } from "@/lib/types";

/** Kleines Instanz-Symbol: eigenes Icon oder Akzentfläche mit Anfangsbuchstaben. */
export const InstanceBadge = memo(function InstanceBadge({ instance, size = 32 }: { instance: Pick<Instance, "id" | "name" | "icon" | "accent">; size?: number }) {
  const [failed, setFailed] = useState(false);
  const src = imageSrc(instance.icon);
  const accent = instanceAccent(instance.id, instance.accent);
  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={() => setFailed(true)}
        className="shrink-0 border border-line object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="grid shrink-0 place-items-center font-display"
      style={{ width: size, height: size, background: accent, color: onAccent(accent), fontSize: Math.max(10, size * 0.45) }}
      aria-hidden
    >
      {instance.name.slice(0, 1).toUpperCase()}
    </span>
  );
});
