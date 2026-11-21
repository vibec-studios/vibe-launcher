import { AlertTriangle, ArrowRight, Check, ChevronDown, CircleSlash, Download } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { ProjectIcon } from "@/components/content/ProjectIcon";
import { Checkbox, cn } from "@/components/ui";
import { useT } from "@/i18n";
import type { LoaderKind } from "@/lib/types";
import type { PreviewItem } from "../api";
import { reasonText } from "../shared";
import { Row, SectionTitle, noop, type Choice } from "./parts";

interface Props {
  groups: Record<"install" | "conflict" | "unavailable" | "installed", PreviewItem[]>;
  choice: Record<string, Choice>;
  toggle: (key: string, c: Choice) => void;
  showInstalled: boolean;
  setShowInstalled: Dispatch<SetStateAction<boolean>>;
  mc: string;
  loader: LoaderKind;
}

export function PreviewGroups({ groups, choice, toggle, showInstalled, setShowInstalled, mc, loader }: Props) {
  const t = useT();
  return (
      <div className="flex flex-col gap-2">
        {groups.install.length > 0 && (
          <>
            <SectionTitle icon={<Download size={13} className="text-brand" />} count={groups.install.length}>
              {t("apply.sec.install")}
            </SectionTitle>
            {groups.install.map((it) => (
              <Row
                key={it.key}
                onClick={() => toggle(it.key, "main")}
                icon={
                  <>
                    <Checkbox checked={choice[it.key] === "main"} onChange={noop} label={it.entry.title} />
                    <ProjectIcon src={it.entry.icon_url} size={32} />
                  </>
                }
                title={
                  <>
                    {it.entry.title} <span className="ml-1 text-meta font-normal text-dim">{it.version_number}</span>
                  </>
                }
                meta={
                  (it.deps.length > 0 || it.manual) && (
                    <>
                      {it.deps.length > 0 && <span>{t("apply.deps", { list: it.deps.map((d) => d.title).join(", ") })}</span>}
                      {it.manual && <span className="text-warn">{it.deps.length ? " · " : ""}{t("apply.manual")}</span>}
                    </>
                  )
                }
              />
            ))}
          </>
        )}
        {groups.conflict.length > 0 && (
          <>
            <SectionTitle icon={<AlertTriangle size={13} className="text-warn" />} count={groups.conflict.length}>
              {t("apply.sec.conflict")}
            </SectionTitle>
            {groups.conflict.map((it) => (
              <Row
                key={it.key}
                onClick={() => toggle(it.key, "main")}
                icon={
                  <>
                    <Checkbox checked={choice[it.key] === "main"} onChange={noop} label={it.entry.title} />
                    <ProjectIcon src={it.entry.icon_url} size={32} />
                  </>
                }
                title={
                  <>
                    {it.entry.title} <span className="ml-1 text-meta font-normal text-dim">{it.version_number}</span>
                  </>
                }
                meta={<span className="text-warn">{t("apply.conflict", { list: it.conflicts.join(", ") })}</span>}
              />
            ))}
          </>
        )}
        {groups.unavailable.length > 0 && (
          <>
            <SectionTitle icon={<CircleSlash size={13} className="text-dim" />} count={groups.unavailable.length}>
              {t("apply.sec.unavailable")}
            </SectionTitle>
            {groups.unavailable.map((it) => (
              <Row
                key={it.key}
                dim
                icon={
                  <>
                    <span className="w-[18px]" />
                    <ProjectIcon src={it.entry.icon_url} size={32} className="opacity-60" />
                  </>
                }
                title={it.entry.title}
                meta={reasonText(t, it.reason ?? "failed", { loaders: it.loaders, mcRange: it.mc_range, mc, loader, message: it.message })}
              >
                {it.alternatives.map((a, i) => (
                  <div
                    key={`${a.project_id}-${a.version_id}`}
                    onClick={() => toggle(it.key, i)}
                    className="ml-[30px] mt-1 flex items-center gap-3 rounded-ctl px-2 py-1.5 hover:bg-white/[.03]"
                  >
                    <Checkbox checked={choice[it.key] === i} onChange={noop} label={a.title} />
                    <ArrowRight size={13} className="shrink-0 text-dim" />
                    <ProjectIcon src={a.icon_url} size={24} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium text-text">
                        {a.kind === "older_mc"
                          ? t("apply.alt.older_mc", { mc: a.mc_version ?? "?", version: a.version_number })
                          : t("apply.alt.other_project", { title: a.title, version: a.version_number })}
                      </div>
                      <div className={cn("text-[12px]", a.kind === "older_mc" ? "text-warn" : "text-dim")}>
                        {a.kind === "older_mc" ? t("apply.alt.older_mc_hint") : t("apply.alt.other_project_hint")}
                      </div>
                    </div>
                  </div>
                ))}
              </Row>
            ))}
          </>
        )}
        {groups.installed.length > 0 && (
          <>
            <button
              onClick={() => setShowInstalled((v) => !v)}
              className="flex items-center gap-2 px-2 pb-1 pt-3 text-left text-[12.5px] font-semibold text-muted hover:text-text"
            >
              <Check size={13} className="text-ok" />
              {t("apply.sec.installed")}
              <span className="tabular-nums text-dim">{groups.installed.length}</span>
              <ChevronDown size={13} className={cn("text-dim transition-transform", showInstalled && "rotate-180")} />
            </button>
            {showInstalled &&
              groups.installed.map((it) => (
                <Row
                  key={it.key}
                  dim
                  icon={
                    <>
                      <span className="w-[18px]" />
                      <ProjectIcon src={it.entry.icon_url} size={28} />
                    </>
                  }
                  title={it.entry.title}
                  meta={it.covered_by ? t("apply.covered_by", { name: it.covered_by }) : it.installed_as ? t("apply.installed_as", { name: it.installed_as }) : undefined}
                />
              ))}
          </>
        )}
      </div>
  );
}
