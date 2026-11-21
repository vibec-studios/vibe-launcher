import { Scale } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { cn } from "@/components/ui";
import { useT } from "@/i18n";
import { formatDate } from "@/lib/format";
import type { Instance, ProjectDetails, Source } from "@/lib/types";
import { Pill, prettyLoader } from "@/components/content/Pill";
import { ManualBadge } from "@/components/content/ManualBadge";
import { compareMc } from "@/components/content/util";
import { CategoryIcon, categoryLabel } from "../categoryIcons";
import { linkList, viewSourceName } from "./links";
import { Dependencies, TargetFit } from "./SideFit";
import { SideLink, SideSection } from "./SideSection";
import type { ViewProject } from "./types";

export function InfoSidebar({
  p,
  target,
  deps,
  onOpenProject,
  note,
}: {
  p: ViewProject;
  target: Instance | null;
  deps: boolean;
  onOpenProject?: (s: Source, id: string) => void;
  note?: ReactNode;
}) {
  const t = useT();
  const links = linkList(p, t);
  const versions = useMemo(() => {
    const rel = p.game_versions.filter((v) => /^\d+\.\d+(\.\d+)?$/.test(v)).sort((a, b) => compareMc(b, a));
    return rel.length ? rel : p.game_versions;
  }, [p.game_versions]);
  const shown = versions.slice(0, 12);
  const platforms = p.loaders.filter((x) => x !== "minecraft");
  const content = p.source !== "hangar" ? (p as ProjectDetails) : null;
  return (
    <aside className="flex w-[248px] shrink-0 flex-col gap-7 @max-[880px]:hidden">
      {note}
      {target && content && <TargetFit p={content} target={target} />}
      {p.manual_download && p.project_type !== "modpack" && (
        <div className="flex items-start gap-2.5 rounded-card bg-warn/[.08] px-3.5 py-3">
          <ManualBadge iconOnly className="mt-px" />
          <div className="min-w-0 text-[12.5px] leading-snug">
            <div className="font-semibold text-text">{t("manual.badge")}</div>
            <div className="mt-0.5 text-muted">{t("manual.tip")}</div>
          </div>
        </div>
      )}
      <SideSection title={t("project.side.compat")}>
        <div className="text-[12px] text-dim">{p.source === "hangar" ? "Paper" : "Minecraft: Java Edition"}</div>
        <div className="flex flex-wrap gap-1">
          {shown.map((v) => (
            <Pill key={v} className={cn("font-mono text-[11.5px]", target?.mc_version === v ? "bg-ok/15 text-ok" : "text-text")}>
              {v}
            </Pill>
          ))}
          {versions.length > shown.length && <Pill>+{versions.length - shown.length}</Pill>}
          {!versions.length && <span className="text-[13px] text-dim">–</span>}
        </div>
        {platforms.length > 0 && (
          <>
            <div className="mt-1 text-[12px] text-dim">{t("project.side.platforms")}</div>
            <div className="flex flex-wrap gap-1">
              {platforms.map((x) => (
                <Pill key={x} className="text-text">
                  {prettyLoader(x)}
                </Pill>
              ))}
            </div>
          </>
        )}
      </SideSection>
      {deps && content && <Dependencies p={content} target={target} onOpenProject={onOpenProject} />}
      {p.categories.length > 0 && (
        <SideSection title={t("discover.filter.categories")}>
          <div className="flex flex-wrap gap-1">
            {p.categories.map((c) => (
              <Pill key={c} icon={<CategoryIcon id={c} size={12} className="text-dim" />}>
                {categoryLabel(c)}
              </Pill>
            ))}
          </div>
        </SideSection>
      )}
      {links.length > 0 && (
        <SideSection title={t("project.side.links")}>
          <div className="flex flex-col">
            {links.map((l) => (
              <SideLink key={l.key} href={l.href} icon={l.icon}>
                {l.label}
              </SideLink>
            ))}
          </div>
        </SideSection>
      )}
      <SideSection title={t("project.side.details")}>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13px]">
          <dt className="flex items-center gap-1.5 text-dim">
            <Scale size={12} />
            {t("project.license")}
          </dt>
          <dd className="truncate text-text" title={p.license ?? ""}>
            {p.license ? p.license.replace(/^LicenseRef-/, "").replace(/-/g, " ") : "–"}
          </dd>
          {p.published && (
            <>
              <dt className="text-dim">{t("project.published")}</dt>
              <dd className="text-text">{formatDate(p.published)}</dd>
            </>
          )}
          {p.updated && (
            <>
              <dt className="text-dim">{t("project.updated")}</dt>
              <dd className="text-text">{formatDate(p.updated)}</dd>
            </>
          )}
          <dt className="text-dim">{t("project.source")}</dt>
          <dd className="text-text">{viewSourceName(p.source)}</dd>
        </dl>
      </SideSection>
    </aside>
  );
}
