import type { Server, ServerStatus, Software } from "@/api/types";
import { useT } from "@/i18n";
import { Badge, Dot, cn } from "@/components/ui";
import { SOFTWARE_COLORS, SOFTWARE_NAMES, softwareOf, stateTone } from "./meta";

export function SoftwareIcon({ software, size = 44, className }: { software: Software; size?: number; className?: string }) {
  const c = SOFTWARE_COLORS[software];
  return (
    <span
      className={cn("grid shrink-0 place-items-center rounded-card font-display text-[15px]", className)}
      style={{ width: size, height: size, background: `color-mix(in srgb, ${c} 16%, transparent)`, color: c, fontSize: size * 0.36 }}
      aria-hidden
    >
      {SOFTWARE_NAMES[software].slice(0, 2)}
    </span>
  );
}

export function ServerIcon({ server, size }: { server: Server; size?: number }) {
  return <SoftwareIcon software={softwareOf(server)} size={size} />;
}

export function StatusBadge({ status, install }: { status: ServerStatus | null; install?: Server["install_state"] }) {
  const t = useT();
  if (install === "installing") return <Badge tone="warn">{t("state.installing")}</Badge>;
  if (install === "failed") return <Badge tone="danger">{t("state.install_failed")}</Badge>;
  const state = status?.state ?? "stopped";
  const tone = stateTone(state);
  return (
    <Badge tone={tone === "muted" ? "muted" : tone}>
      <Dot tone={tone} />
      {t(`state.${state}`)}
    </Badge>
  );
}

export function SoftwareLabel({ server }: { server: Server }) {
  const sw = softwareOf(server);
  return (
    <span>
      {SOFTWARE_NAMES[sw]} {server.mc_version}
    </span>
  );
}
