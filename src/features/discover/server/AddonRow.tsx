import { ArrowUpCircle, Check, Download } from "lucide-react";
import { Button } from "@/components/ui";
import { useT } from "@/i18n";
import { formatRelative, formatCount } from "@/lib/format";
import type { AddonHit, AddonUpdate } from "@/features/servers/addonsApi";
import { AddonIcon } from "./parts";

export function AddonRow({
  hit,
  installed,
  update,
  busy,
  disabled,
  onOpen,
  onInstall,
  onUpdate,
}: {
  hit: AddonHit;
  installed: boolean;
  update?: AddonUpdate;
  busy: boolean;
  disabled: boolean;
  onOpen: () => void;
  onInstall: () => void;
  onUpdate: () => void;
}) {
  const t = useT();
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onOpen();
        }
      }}
      className="group flex min-h-[76px] cursor-pointer items-center gap-3.5 rounded-card px-3 py-2.5 outline-none transition-colors hover:bg-white/[.03] focus-visible:bg-white/[.04]"
      data-testid="server-addon-row"
    >
      <AddonIcon src={hit.icon_url} size={48} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-[14px] font-semibold text-text group-hover:underline">{hit.title}</span>
          <span className="shrink-0 truncate text-caption text-dim">{t("srv.addons.by", { author: hit.author })}</span>
        </div>
        <div className="truncate text-[12.5px] text-muted" title={hit.description}>
          {hit.description}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-caption text-dim">
          <span>{t("srv.addons.downloads", { n: formatCount(hit.downloads) })}</span>
          {hit.updated && <span>· {formatRelative(hit.updated)}</span>}
          <span>· {hit.source === "hangar" ? "Hangar" : "Modrinth"}</span>
          {hit.compat && !hit.compat.ok && (
            <span className="truncate text-warn" title={hit.compat.reason ?? undefined} data-testid="server-addon-compat">
              · {t("st.compat.no")}
            </span>
          )}
        </div>
      </div>
      <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
        {update ? (
          <Button size="sm" variant="accent" icon={<ArrowUpCircle size={13} />} loading={busy} disabled={disabled && !busy} onClick={onUpdate}>
            {t("st.update_to", { v: update.latest })}
          </Button>
        ) : installed ? (
          <span className="inline-flex h-8 items-center gap-1.5 px-2 text-[13px] font-semibold text-ok">
            <Check size={14} strokeWidth={2.5} />
            {t("common.installed")}
          </span>
        ) : (
          <Button size="sm" variant="ghost" icon={<Download size={13} />} loading={busy} disabled={disabled && !busy} onClick={onInstall}>
            {t("common.install")}
          </Button>
        )}
      </div>
    </div>
  );
}
