import { Users } from "lucide-react";
import { Tooltip, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { useVibe } from "@/lib/vibe";
import { useSocialBadge } from "./hooks";
import { setPanelOpen, useSocial } from "./service";

/** Knopf in der Topbar zum Ein-/Ausklappen. */
export function FriendsPanelToggle() {
  const t = useT();
  const vibe = useVibe();
  const open = useSocial((s) => s.panelOpen);
  const badge = useSocialBadge();
  if (!vibe.social) return null;
  return (
    <Tooltip content={open ? t("social.panel.close") : t("social.panel.open")} side="bottom">
      <button
        aria-label={open ? t("social.panel.close") : t("social.panel.open")}
        onClick={() => setPanelOpen(!open)}
        className={cn(
          "relative grid h-8 w-8 place-items-center rounded-ctl transition-colors duration-100",
          open ? "bg-white/[.08] text-text" : "text-muted hover:bg-white/[.06] hover:text-text",
        )}
      >
        <Users size={16} />
        {badge > 0 && !open && <span className="absolute right-1 top-1 h-2 w-2 rounded-dot bg-brand" />}
      </button>
    </Tooltip>
  );
}
