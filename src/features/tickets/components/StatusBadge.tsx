import { Bug, Flag, Lightbulb, MessageCircle } from "lucide-react";
import type { TicketKind, TicketStatus } from "@/lib/types";
import { cn } from "@/components/ui";
import { useT } from "@/i18n";

const TONE: Record<TicketStatus, string> = {
  new: "bg-white/[.07] text-muted",
  in_progress: "bg-brand/15 text-brand",
  waiting: "bg-warn/15 text-warn",
  done: "bg-ok/15 text-ok",
  rejected: "bg-danger/[.12] text-danger",
};

export function StatusBadge({ status, className }: { status: TicketStatus; className?: string }) {
  const t = useT();
  return <span className={cn("inline-flex h-5 shrink-0 items-center rounded-pill px-2 text-[11px] font-semibold", TONE[status] ?? TONE.new, className)}>{t(`tk.status.${status}`)}</span>;
}

export function KindIcon({ kind, size = 14, className }: { kind: TicketKind; size?: number; className?: string }) {
  const Icon = kind === "bug" ? Bug : kind === "idea" ? Lightbulb : kind === "report" ? Flag : MessageCircle;
  return <Icon size={size} className={className} />;
}
