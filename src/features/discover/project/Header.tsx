import { CalendarClock, Copy, Download, ExternalLink, Heart, Images, MoreHorizontal, Star } from "lucide-react";
import { useState, type ReactNode } from "react";
import { DropdownItem, DropdownMenu, DropdownSeparator, IconButton, Tooltip, cn, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { formatCount, formatDate, formatRelative } from "@/lib/format";
import { ProjectIcon } from "@/components/content/ProjectIcon";
import { Pill, prettyLoader } from "@/components/content/Pill";
import { ManualBadge } from "@/components/content/ManualBadge";
import { copyText, openExternal, versionRange } from "@/components/content/util";
import { fmtNum } from "../categoryIcons";
import { hitColor } from "../ResultCard";
import { linkList, viewSourceName } from "./links";
import type { ViewProject } from "./types";

export function Header({ p, install, banner, onBanner }: { p: ViewProject; install: ReactNode; banner: string | null; onBanner: () => void }) {
  const t = useT();
  const [bannerFailed, setBannerFailed] = useState(false);
  const loaders = p.loaders.filter((l) => l !== "minecraft" && (p.project_type === "plugin" || ["fabric", "forge", "neoforge", "quilt"].includes(l)));
  const range = versionRange(p.game_versions);
  const links = linkList(p, t);
  const color = hitColor(p);
  const showBanner = !!banner && !bannerFailed;

  return (
    <div className="animate-fade-in">
      {showBanner ? (
        <button
          onClick={onBanner}
          aria-label={t("project.tab.gallery")}
          className="group relative block h-[clamp(112px,22vh,180px)] w-full overflow-hidden rounded-card bg-surface2 @max-[760px]:h-[clamp(100px,18vh,140px)]"
        >
          <img
            src={banner!}
            alt=""
            draggable={false}
            onError={() => setBannerFailed(true)}
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 ease-[var(--ease-snap)] group-hover:scale-[1.015]"
          />
          {p.gallery.length > 1 && (
            <span className="absolute bottom-3 right-3 inline-flex h-7 items-center gap-1.5 rounded-ctl bg-black/70 px-2.5 text-[12px] font-semibold text-[#fff] opacity-0 transition-opacity duration-150 group-hover:opacity-100">
              <Images size={13} />
              {t("project.gallery_more", { n: p.gallery.length })}
            </span>
          )}
        </button>
      ) : (
        color && <div className="h-1.5 w-full rounded-pill" style={{ backgroundColor: color }} />
      )}
      <div className={cn("flex items-start gap-5", showBanner ? "-mt-9 px-5" : "mt-4")}>
        <span className={cn("shrink-0 rounded-card", showBanner && "bg-panel p-1")}>
          <ProjectIcon src={p.icon_url} size={96} eager />
        </span>
        <div className={cn("flex min-w-0 flex-1 flex-col gap-1", showBanner ? "pt-11" : "pt-1")}>
          <h1 className="selectable truncate text-[26px] font-bold leading-tight tracking-[-0.02em] text-text" title={p.title}>
            {p.title}
          </h1>
          {p.author && <span className="truncate text-[13px] text-muted">{t("discover.by", { author: p.author })}</span>}
          <p className="selectable mt-1 line-clamp-2 max-w-[720px] text-[14px] leading-snug text-muted" title={p.description}>
            {p.description}
          </p>
        </div>
      </div>
      <div className={cn("mt-4 flex flex-wrap items-center gap-x-5 gap-y-3", showBanner && "px-5")}>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-muted">
          {p.manual_download && <ManualBadge />}
          <Tooltip content={t("discover.downloads_n", { n: fmtNum(p.downloads) })}>
            <span className="flex items-center gap-1.5">
              <Download size={14} className="text-dim" />
              <b className="font-semibold tabular-nums text-text">{formatCount(p.downloads)}</b> {t("project.downloads_lc")}
            </span>
          </Tooltip>
          {(p.source === "modrinth" || p.source === "hangar") && (
            <Tooltip content={p.source === "hangar" ? t("project.stars_n", { n: fmtNum(p.follows) }) : t("discover.follows_n", { n: fmtNum(p.follows) })}>
              <span className="flex items-center gap-1.5">
                {p.source === "hangar" ? <Star size={14} className="text-dim" /> : <Heart size={14} className="text-dim" />}
                <b className="font-semibold tabular-nums text-text">{formatCount(p.follows)}</b> {p.source === "hangar" ? t("project.stars_lc") : t("project.follows_lc")}
              </span>
            </Tooltip>
          )}
          {p.updated && (
            <Tooltip content={formatDate(p.updated)}>
              <span className="flex items-center gap-1.5">
                <CalendarClock size={14} className="text-dim" />
                {t("project.updated_ago", { time: formatRelative(p.updated) })}
              </span>
            </Tooltip>
          )}
          {(loaders.length > 0 || range) && (
            <span className="flex flex-wrap items-center gap-1.5">
              {loaders.slice(0, 5).map((l) => (
                <Pill key={l} className="text-text">
                  {prettyLoader(l)}
                </Pill>
              ))}
              {range && <Pill className="font-mono text-[11.5px] text-text">{range}</Pill>}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {install}
          {links.slice(0, 2).map((l) => (
            <IconButton key={l.key} label={l.label} tip variant="ghost" onClick={() => void openExternal(l.href)}>
              {l.icon}
            </IconButton>
          ))}
          <DropdownMenu
            trigger={
              <IconButton label={t("common.more")} tip variant="ghost">
                <MoreHorizontal size={16} />
              </IconButton>
            }
          >
            {links.length > 2 && (
              <>
                {links.slice(2).map((l) => (
                  <DropdownItem key={l.key} icon={l.icon} onSelect={() => void openExternal(l.href)}>
                    {l.label}
                  </DropdownItem>
                ))}
                <DropdownSeparator />
              </>
            )}
            <DropdownItem icon={<ExternalLink size={14} />} onSelect={() => void openExternal(p.page_url)}>
              {t("project.open_on", { source: viewSourceName(p.source) })}
            </DropdownItem>
            <DropdownItem
              icon={<Copy size={14} />}
              onSelect={() =>
                copyText(p.page_url)
                  .then(() => toast.success(t("common.copied"), p.page_url))
                  .catch((e) => toast.error(e))
              }
            >
              {t("discover.menu.copy_link")}
            </DropdownItem>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
