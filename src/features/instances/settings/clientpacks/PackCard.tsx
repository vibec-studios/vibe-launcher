import type { ReactNode } from "react";
import { AlertTriangle, ArrowUpCircle, Check, Download, ExternalLink, Gem, Trash2 } from "lucide-react";
import { loaderNames } from "@/lib/format";
import type { ClientPackOffer, ClientPacksOverview } from "@/lib/types";
import { Button, Tooltip, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { useExpert } from "@/lib/simple-mode";
import { ICONS, packName, versionRange } from "./logic";

export function PackCard({
  offer: o,
  data,
  busy,
  locked,
  running,
  onInstall,
  onRemove,
}: {
  offer: ClientPackOffer;
  data: ClientPacksOverview;
  busy: boolean;
  locked: boolean;
  running: boolean;
  onInstall: () => void;
  onRemove: () => void;
}) {
  const t = useT();
  const tech = useExpert("tech-details");
  const inst = o.installed;
  const official = o.category === "official";
  const range = versionRange(o.mc_versions);

  // Statuszeile
  let status: ReactNode = null;
  let tone: "muted" | "warn" | "ok" | "brand" = "muted";
  if (inst) {
    if (inst.mismatch) {
      status = t("cp.mismatch", { mc: inst.mc_version ?? "?" });
      tone = "warn";
    } else if (inst.missing) {
      status = t("cp.missing");
      tone = "warn";
    } else if (o.update_available && o.latest_version) {
      status = t("cp.update_to", { v: o.latest_version });
      tone = "brand";
    } else {
      status = inst.version ? t("cp.installed_v", { v: inst.version }) : t("cp.installed");
      tone = "ok";
    }
    if (inst.disabled_by_user && !inst.missing) {
      status = (
        <>
          {status} · {t("cp.disabled_by_user")}
        </>
      );
    }
  } else if (o.available === false) {
    status =
      o.reason === "loader"
        ? t("cp.reason.loader", { loader: loaderNames[data.loader] })
        : o.reason === "vibe_off"
          ? t("cp.reason.vibe_off")
          : range
            ? t("cp.reason.version_range", { mc: data.mc_version, range })
            : t("cp.reason.version", { mc: data.mc_version });
  } else if (o.available === null) {
    tone = "warn";
    status = o.source === "norisk" ? t("cp.norisk.unreachable") : t("cp.reason.unreachable");
  }

  const canInstall = !inst && o.available === true;
  const canUpdate = !!inst && (o.update_available || inst.missing) && o.available !== false;
  const reason = running ? t("cp.running") : null;

  return (
    <article className={cn("flex min-w-0 flex-col gap-4 rounded-card border bg-surface p-4", inst ? "border-accent/45" : "border-line")}>
      <div className="flex items-start gap-3">
        <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-ctl bg-surface3", official ? "text-brand" : "text-muted")}>
          {ICONS[o.id] ?? <Gem size={18} />}
        </span>
        <div className="min-w-0 flex-1">
          <h4 className="break-words text-[16px] font-semibold text-text">{packName(t, o.id)}</h4>
          <p className="mt-1 text-[14px] leading-snug text-muted">{t(`cp.${o.id}.desc`)}</p>
        </div>
      </div>

      {/* Herkunft (Anbieter, Website, woher die Datei kommt) gesammelt über den Aktionen – die Knöpfe stehen unten */}
      <div className="flex flex-col gap-1 text-[13px] leading-snug text-muted empty:hidden">
        {!official && o.vendor && (
          <div className="flex flex-wrap items-center gap-x-2">
            <span>{t("cp.attribution", { vendor: o.vendor })}</span>
            {o.homepage && (
              <a href={o.homepage} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted hover:text-text hover:underline">
                {new URL(o.homepage).host.replace(/^www\./, "")}
                <ExternalLink size={11} />
              </a>
            )}
          </div>
        )}
        {/* Woher die Datei kommt: Detail für Experten */}
        {tech && <p>{t(`cp.source.${o.source}`)}</p>}
      </div>

      <div className="mt-auto flex min-h-10 flex-wrap items-center gap-2 border-t border-line pt-3">
        <div
          className={cn(
            "flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px]",
            tone === "warn" ? "text-warn" : tone === "ok" ? "text-ok" : tone === "brand" ? "text-brand" : "text-muted",
          )}
        >
          {tone === "warn" && <AlertTriangle size={12} className="shrink-0" />}
          {tone === "ok" && <Check size={12} className="shrink-0" />}
          {tone === "brand" && <ArrowUpCircle size={12} className="shrink-0" />}
          <span className="min-w-0 break-words">
            {status}
          </span>
          {o.available === null && o.source === "norisk" && o.homepage && (
            <a href={o.homepage} target="_blank" rel="noreferrer" className="shrink-0 font-semibold text-text hover:underline">
              {t("cp.norisk.download_site")}
            </a>
          )}
        </div>
        {inst && (
          <Tooltip content={reason}>
            <span>
              <Button size="sm" variant="subtle" icon={<Trash2 size={13} />} disabled={locked || busy} onClick={onRemove}>
                {t("cp.remove")}
              </Button>
            </span>
          </Tooltip>
        )}
        {(canInstall || canUpdate) && (
          <Tooltip content={reason}>
            <span>
              <Button
                size="sm"
                variant="accent"
                icon={canUpdate ? <ArrowUpCircle size={13} /> : <Download size={13} />}
                loading={busy}
                disabled={locked}
                onClick={onInstall}
              >
                {canUpdate ? t("cp.update") : t("cp.install")}
              </Button>
            </span>
          </Tooltip>
        )}
      </div>
    </article>
  );
}
