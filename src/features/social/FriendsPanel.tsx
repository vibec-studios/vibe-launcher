// Einklappbares Freunde-Panel rechts neben dem Inhalt (Online-Status auf jeder Seite im Blick).
import { useNavigate } from "@tanstack/react-router";
import { MessageSquare, PanelRightClose } from "lucide-react";
import { IconButton } from "@/components/ui";
import { useT } from "@/i18n";
import { useVibe } from "@/lib/vibe";
import { FriendsTab } from "./FriendsList";
import { PlayLinkBar } from "@/features/play/SharePlayLink";
import { Gate } from "./Gate";
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

      <PlayLinkBar compact className="border-b border-line" />
      <div className="flex min-h-0 flex-1 flex-col">
        <Gate compact>
          <FriendsTab compact />
        </Gate>
      </div>
    </aside>
  );
}
