// Kleine, ruhige Etiketten im App-Stil (normale Schreibweise), z. B. Kategorien, Loader, Versionen.
import type { ReactNode } from "react";
import { cn } from "@/components/ui";

export function Pill({ children, className, icon, title }: { children: ReactNode; className?: string; icon?: ReactNode; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex h-[22px] shrink-0 items-center gap-1 bg-white/[.06] px-2 text-[12px] font-medium text-muted", className)}>
      {icon}
      {children}
    </span>
  );
}

/** Kategorie-ID lesbar machen ("game-mechanics" -> "Game mechanics"). */
export function prettyCategory(c: string): string {
  const s = c.replace(/[-_]/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Loader-Namen lesbar machen. */
export function prettyLoader(l: string): string {
  const map: Record<string, string> = { fabric: "Fabric", forge: "Forge", neoforge: "NeoForge", quilt: "Quilt", vanilla: "Vanilla", iris: "Iris", optifine: "OptiFine", minecraft: "Minecraft", datapack: "Datapack" };
  return map[l.toLowerCase()] ?? prettyCategory(l);
}
