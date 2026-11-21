import { PackageOpen } from "lucide-react";
import { useState } from "react";
import type { Pack } from "@/lib/vibe-sdk";

export function PackIcon({ pack, size }: { pack: Pick<Pack, "iconUrl" | "name">; size: number }) {
  const [bad, setBad] = useState(false);
  const ok = pack.iconUrl && pack.iconUrl.startsWith("https://") && !bad;
  return ok ? (
    <img src={pack.iconUrl!} alt="" width={size} height={size} loading="lazy" decoding="async" className="shrink-0 rounded-card object-cover" style={{ width: size, height: size }} onError={() => setBad(true)} />
  ) : (
    <span className="grid shrink-0 place-items-center rounded-card bg-surface2 text-muted" style={{ width: size, height: size }}>
      <PackageOpen size={size * 0.45} />
    </span>
  );
}
