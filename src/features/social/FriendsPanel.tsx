// Einklappbares Freunde-Panel rechts neben dem Inhalt (Online-Status auf jeder Seite im Blick).
import { useNavigate } from "@tanstack/react-router";
import { MessageSquare, PanelRightClose, Users } from "lucide-react";
import { IconButton, Tooltip, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { useVibe } from "@/lib/vibe";
import { FriendsTab } from "./FriendsList";
import { Gate } from "./Gate";
import { useSocialBadge } from "./hooks";
import { setPanelOpen, useSocial } from "./service";

export function FriendsPanel() {
  const t = useT();
  const nav = useNavigate();
  const vibe = useVibe();
  const open = useSocial((s) => s.panelOpen);
  const online = useSocial((s) => Object.values(s.friends).filter((f) => f.presence.status !== "offline").length);
  if (!vibe.social || !open) return null;
  return (
    <aside className="flex w-[260px] shrink-0 flex-col bg-bg animate-[pop-in_.14s_var(--ease-snap)]">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line pl-3.5 pr-1.5">
        <span className="flex flex-1 items-baseline gap-1.5 text-section text-text">
          {t("social.tab.friends")}
          <span className="text-caption font-normal tabular-nums text-dim">{online}</span>
        </span>
        <IconButton label={t("social.open_page")} tip variant="ghost" size="sm" onClick={() => nav({ to: "/social", search: {} })}>
          <MessageSquare size={15} />
        </IconButton>
        <IconButton label={t("social.panel.close")} tip variant="ghost" size="sm" onClick={() => setPanelOpen(false)}>
          <PanelRightClose size={15} />
        </IconButton>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <Gate compact>
          <FriendsTab compact />
        </Gate>
      </div>
    </aside>
  );
}

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
