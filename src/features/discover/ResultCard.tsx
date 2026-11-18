// Ergebnis-Karte der Entdecken-Seite. memo: Fortschritt abonniert nur der Installieren-Knopf der Karte.
import { CalendarClock, Check, Copy, Download, ExternalLink, FolderPlus, Heart, PackagePlus, RefreshCw, SquareArrowOutUpRight } from "lucide-react";
import { memo, type KeyboardEvent, type MouseEvent } from "react";
import { Button, ContextItem, ContextLabel, ContextMenu, ContextSeparator, ContextSub, Progress, Tag, Tooltip, cn, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { formatCount, formatRelative } from "@/lib/format";
import { useTask } from "@/lib/queries";
import type { Instance, ProjectHit } from "@/lib/types";
import { ProjectIcon } from "@/components/content/ProjectIcon";
import { prettyCategory, prettyLoader } from "@/components/content/Pill";
import { InstanceBadge } from "@/components/content/InstanceBadge";
import { openInstall } from "@/components/content/InstallDialog";
import { installKey, packKey, startContentInstall, useInstallTasks } from "@/components/content/install";
import { compatibility, copyText, openExternal, projectWebUrl } from "@/components/content/util";

export const CARD_H = 84;

export interface CardProps {
  hit: ProjectHit;
  /** Ziel-Instanz-Modus */
  target: Instance | null;
  installed: boolean;
  instances: Instance[];
  onOpen: (hit: ProjectHit) => void;
}

function InstallButton({ hit, target, installed }: { hit: ProjectHit; target: Instance | null; installed: boolean }) {
  const t = useT();
  const key = target && hit.project_type !== "modpack" ? installKey(target.id, hit) : packKey(hit);
  const taskId = useInstallTasks((s) => s.tasks[key]);
  const task = useTask(taskId);
  const stop = (e: MouseEvent) => e.stopPropagation();

  if (task && task.status === "running") {
    return (
      <div className="flex w-[112px] flex-col gap-1.5" onClick={stop}>
        <span className="flex items-center justify-between text-[12px] text-muted">
          {t("install.installing")}
          <span>{task.progress != null ? `${Math.round(task.progress * 100)}%` : ""}</span>
        </span>
        <Progress value={task.progress} />
      </div>
    );
  }
  if (installed || task?.status === "done") {
    return (
      <span className="inline-flex h-8 items-center gap-1.5 px-2 text-[13px] font-semibold text-ok">
        <Check size={13} />
        {t("common.installed")}
      </span>
    );
  }
  if (target && hit.project_type !== "modpack") {
    const c = compatibility(hit, target);
    return (
      <Tooltip content={c.ok ? null : t("discover.maybe_incompatible")}>
        <Button
          size="sm"
          variant={c.ok ? "accent" : "ghost"}
          icon={<Download size={13} />}
          onClick={(e) => {
            e.stopPropagation();
            startContentInstall(target.id, hit, null).catch((err) => toast.error(t("install.failed", { name: hit.title }), errorMessage(err)));
          }}
        >
          {t("common.install")}
        </Button>
      </Tooltip>
    );
  }
  return (
    <Button
      size="sm"
      variant="ghost"
      icon={hit.project_type === "modpack" ? <FolderPlus size={13} /> : <Download size={13} />}
      onClick={(e) => {
        e.stopPropagation();
        openInstall({ project: hit });
      }}
    >
      {t("common.install")}
    </Button>
  );
}

function CardMenu({ hit, instances, onOpen }: { hit: ProjectHit; instances: Instance[]; onOpen: () => void }) {
  const t = useT();
  const url = projectWebUrl(hit);
  const sorted = hit.project_type === "modpack" ? [] : instances.map((i) => ({ i, ok: compatibility(hit, i).ok })).sort((a, b) => Number(b.ok) - Number(a.ok)).slice(0, 14);
  return (
    <>
      <ContextItem icon={<SquareArrowOutUpRight size={14} />} onSelect={onOpen}>
        {t("discover.menu.open")}
      </ContextItem>
      {hit.project_type === "modpack" ? (
        <ContextItem icon={<FolderPlus size={14} />} onSelect={() => openInstall({ project: hit })}>
          {t("install.as_new_instance")}
        </ContextItem>
      ) : (
        <ContextSub icon={<PackagePlus size={14} />} label={t("discover.menu.install_in")}>
          {sorted.length === 0 && <ContextLabel>{t("install.no_instances")}</ContextLabel>}
          {sorted.map(({ i, ok }) => (
            <ContextItem
              key={i.id}
              icon={<InstanceBadge instance={i} size={14} />}
              onSelect={() => startContentInstall(i.id, hit, null).catch((e) => toast.error(t("install.failed", { name: hit.title }), errorMessage(e)))}
            >
              <span className={ok ? undefined : "text-dim"}>{i.name}</span>
            </ContextItem>
          ))}
          <ContextSeparator />
          <ContextItem icon={<RefreshCw size={14} />} onSelect={() => openInstall({ project: hit })}>
            {t("discover.menu.choose")}
          </ContextItem>
        </ContextSub>
      )}
      {url && (
        <>
          <ContextSeparator />
          <ContextItem icon={<ExternalLink size={14} />} onSelect={() => void openExternal(url)}>
            {t("discover.menu.browser")}
          </ContextItem>
          <ContextItem
            icon={<Copy size={14} />}
            onSelect={() =>
              copyText(url)
                .then(() => toast.success(t("common.copied"), url))
                .catch((e) => toast.error(e))
            }
          >
            {t("discover.menu.copy_link")}
          </ContextItem>
        </>
      )}
    </>
  );
}

export const ResultCard = memo(function ResultCard({ hit, target, installed, instances, onOpen }: CardProps) {
  const t = useT();
  const open = () => onOpen(hit);
  const loaders = hit.project_type === "mod" || hit.project_type === "modpack" ? hit.loaders.filter((l) => ["fabric", "forge", "neoforge", "quilt"].includes(l)) : [];
  return (
    <ContextMenu content={<CardMenu hit={hit} instances={instances} onOpen={open} />}>
      <div
        role="link"
        tabIndex={0}
        onClick={open}
        onKeyDown={(e: KeyboardEvent) => e.key === "Enter" && open()}
        className={cn(
          "group flex h-full cursor-pointer items-center gap-3.5 rounded-card px-2 transition-colors duration-100",
          "hover:bg-white/[.04] data-[state=open]:bg-white/[.04] focus-visible:bg-white/[.04] focus-visible:outline-none",
        )}
      >
        <ProjectIcon src={hit.icon_url} size={60} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex min-w-0 items-baseline gap-1.5">
            <span className="truncate text-[14.5px] font-semibold text-text">{hit.title}</span>
            <span className="shrink-0 truncate text-meta text-dim">{t("discover.by", { author: hit.author })}</span>
          </div>
          <p className="truncate text-[13px] text-muted" title={hit.description}>
            {hit.description}
          </p>
          <div className="flex min-w-0 items-center gap-1 overflow-hidden">
            {loaders.map((l) => (
              <Tag key={l} className="shrink-0 text-text">
                {prettyLoader(l)}
              </Tag>
            ))}
            {hit.categories.slice(0, 3).map((c) => (
              <Tag key={c} className="shrink-0">
                {prettyCategory(c)}
              </Tag>
            ))}
            <span className="ml-1.5 flex min-w-0 shrink-0 items-center gap-3 text-meta text-dim">
              <Tooltip content={t("discover.downloads_n", { n: hit.downloads.toLocaleString() })}>
                <span className="flex items-center gap-1">
                  <Download size={12} />
                  {formatCount(hit.downloads)}
                </span>
              </Tooltip>
              {hit.source === "modrinth" && (
                <span className="flex items-center gap-1">
                  <Heart size={12} />
                  {formatCount(hit.follows)}
                </span>
              )}
              {hit.updated && (
                <span className="flex items-center gap-1">
                  <CalendarClock size={12} />
                  {formatRelative(hit.updated)}
                </span>
              )}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center pr-1">
          <InstallButton hit={hit} target={target} installed={installed} />
        </div>
      </div>
    </ContextMenu>
  );
});

export function ResultSkeleton() {
  return (
    <div className="flex h-full items-center gap-3.5 px-2">
      <div className="skeleton h-[60px] w-[60px] shrink-0 rounded-card" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="skeleton h-4 w-2/5" />
        <div className="skeleton h-3 w-4/5" />
        <div className="flex gap-1">
          <div className="skeleton h-5 w-14" />
          <div className="skeleton h-5 w-16" />
          <div className="skeleton h-5 w-24" />
        </div>
      </div>
      <div className="skeleton mr-1 h-8 w-28 shrink-0" />
    </div>
  );
}
