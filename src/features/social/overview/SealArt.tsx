import { cn } from "@/components/ui";

/** Robbe als freundliche Illustration für leere Zustände. */
export function SealArt({ size = 132, className }: { size?: number; className?: string }) {
  return <img src="/logo-seal.png" alt="" width={size} height={size} draggable={false} className={cn("object-contain", className)} style={{ width: size, height: size }} />;
}
