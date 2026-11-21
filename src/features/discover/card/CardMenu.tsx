import { Copy, ExternalLink, FolderPlus, PackagePlus, RefreshCw, SquareArrowOutUpRight } from "lucide-react";
import { ContextItem, ContextLabel, ContextSeparator, ContextSub, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import type { Instance, ProjectHit } from "@/lib/types";
import { InstanceBadge } from "@/components/content/InstanceBadge";
import { openInstall } from "@/components/content/installStore";
import { startContentInstall, startManualDownload } from "@/components/content/install";
import { compatibility, copyText, openExternal, projectWebUrl } from "@/components/content/util";

export function CardMenu({ hit, instances, onOpen }: { hit: ProjectHit; instances: Instance[]; onOpen: () => void }) {
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
        <ContextSub icon={hit.manual_download ? <ExternalLink size={14} /> : <PackagePlus size={14} />} label={hit.manual_download ? `${t("manual.download")} …` : t("discover.menu.install_in")}>
          {sorted.length === 0 && <ContextLabel>{t("install.no_instances")}</ContextLabel>}
          {sorted.map(({ i, ok }) => (
            <ContextItem
              key={i.id}
              icon={<InstanceBadge instance={i} size={14} />}
              onSelect={() =>
                hit.manual_download
                  ? startManualDownload(i.id, hit, null).catch(() => {})
                  : startContentInstall(i.id, hit, null).catch((e) => toast.error(t("install.failed", { name: hit.title }), errorMessage(e)))
              }
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
