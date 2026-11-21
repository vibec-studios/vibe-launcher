import { useQuery } from "@tanstack/react-query";
import { Skeleton, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { requireClient, vqk } from "../service";

export function HostingCard() {
  const t = useT();
  const q = useQuery({ queryKey: vqk.hostingLimits, queryFn: () => requireClient().hosting.limits(), staleTime: 30_000 });
  const l = q.data;
  return (
    <section className="rounded-card bg-surface px-4 py-3.5">
      <div className="flex items-baseline justify-between">
        <h3 className="text-[13px] font-semibold text-text">{t("social.hosting.title")}</h3>
        {l && <span className="text-[12px] tabular-nums text-muted">{t("social.hosting.card_count", { active: l.active, max: l.maxHosts })}</span>}
      </div>
      {!l ? (
        <Skeleton className="mt-3 h-4 w-40" />
      ) : (
        <>
          {!l.enabled && <p className="mt-2 text-[12px] text-warn">{t("social.hosting.disabled")}</p>}
          <div className="mt-2.5 flex gap-1">
            {Array.from({ length: Math.max(1, l.maxHosts) }, (_, i) => (
              <span key={i} className={cn("h-1.5 flex-1 rounded-pill", i < l.active ? "bg-brand" : "bg-surface3")} />
            ))}
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-dim">
            {t("social.hosting.explain", { max: l.maxHosts })}{" "}
            {l.maxPlayersPerHost ? t("social.hosting.card_players", { n: l.maxPlayersPerHost }) : t("social.hosting.card_players_any")}
          </p>
        </>
      )}
    </section>
  );
}
