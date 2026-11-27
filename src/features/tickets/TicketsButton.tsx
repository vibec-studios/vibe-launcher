import { useNavigate, useRouterState } from "@tanstack/react-router";
import { LifeBuoy } from "lucide-react";
import { Tooltip, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { attentionCount, useTickets } from "./store";

export function TicketsButton() {
  const t = useT();
  const nav = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const known = useTickets((s) => s.local.length > 0 || Object.keys(s.items).length > 0);
  const badge = useTickets((s) => attentionCount(s.items));
  if (!known) return null;
  const open = path === "/tickets";
  const label = badge ? t("tk.button.badge", { n: badge }) : t("tk.button");
  return (
    <Tooltip content={label} side="bottom">
      <button
        aria-label={label}
        data-testid="tickets-open"
        onClick={() => void nav({ to: "/tickets" })}
        className={cn(
          "relative grid h-8 w-8 place-items-center rounded-ctl transition-colors duration-100",
          open ? "bg-white/[.08] text-text" : "text-muted hover:bg-white/[.06] hover:text-text",
        )}
      >
        <LifeBuoy size={16} />
        {badge > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-dot bg-brand" />}
      </button>
    </Tooltip>
  );
}
