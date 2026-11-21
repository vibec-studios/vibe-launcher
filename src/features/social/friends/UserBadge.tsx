import { cn } from "@/components/ui";
import { useT } from "@/i18n";
import type { PublicUser } from "@/lib/vibe-sdk";

/** Kleines Abzeichen (Unterstützer, Team). */
export function UserBadge({ badge }: { badge: PublicUser["badge"] }) {
  const t = useT();
  // Ohne Abzeichen (oder unbekannt/leer vom Server) nichts zeigen – nie einen rohen Übersetzungsschlüssel
  if (!badge || badge === "user") return null;
  return (
    <span
      className={cn(
        "inline-flex h-4 shrink-0 items-center rounded-xs px-1.5 text-[10px] font-bold leading-none",
        badge === "staff" ? "bg-brand/20 text-brand" : "bg-warn/15 text-warn",
      )}
    >
      {t(`social.badge.${badge}`)}
    </span>
  );
}
