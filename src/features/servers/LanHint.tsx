import { Globe, Radio, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui";
import { useT } from "@/i18n";
import type { ServerConnection } from "@/lib/types";

export function ConnBadge({ tone, children }: { tone: "muted" | "accent"; children: string }) {
  return (
    <span
      className={
        tone === "accent"
          ? "rounded-pill bg-accent/[.14] px-2 py-0.5 text-[11px] font-semibold text-accent"
          : "rounded-pill bg-white/[.06] px-2 py-0.5 text-[11px] font-medium text-muted"
      }
    >
      {children}
    </span>
  );
}

export function LanHint({ relayOk, onSwitch }: { relayOk: boolean; onSwitch: (v: ServerConnection) => void }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-2 rounded-card bg-warn/[.07] px-4 py-3">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-text">
        <ShieldAlert size={15} className="shrink-0 text-warn" />
        {t("srvh.firewall.title")}
      </div>
      <p className="text-[12.5px] leading-relaxed text-muted">{t("srvh.firewall.text")}</p>
      <p className="text-[12.5px] leading-relaxed text-muted">{t("srvh.firewall.internet")}</p>
      <div className="flex flex-wrap gap-2 pt-1">
        {relayOk && (
          <Button size="sm" variant="accent" icon={<Radio size={13} />} onClick={() => onSwitch("relay")}>
            {t("srvh.use_relay")}
          </Button>
        )}
        <Button size="sm" variant={relayOk ? "subtle" : "accent"} icon={<Globe size={13} />} onClick={() => onSwitch("playit")}>
          {t("srvh.use_playit")}
        </Button>
      </div>
    </div>
  );
}
