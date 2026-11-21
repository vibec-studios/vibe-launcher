import { useState } from "react";
import { Package } from "lucide-react";

export function AddonIcon({ src, size = 32 }: { src: string | null | undefined; size?: number }) {
  const [broken, setBroken] = useState(false);
  return (
    <div className="grid shrink-0 place-items-center overflow-hidden rounded-ctl bg-surface3 text-dim" style={{ width: size, height: size }}>
      {src && !broken ? (
        <img src={src} alt="" className="h-full w-full object-cover [image-rendering:pixelated]" onError={() => setBroken(true)} />
      ) : (
        <Package size={size * 0.5} />
      )}
    </div>
  );
}
