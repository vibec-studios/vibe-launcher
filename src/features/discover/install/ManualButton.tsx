import { ChevronDown, Clock, ExternalLink, ListPlus } from "lucide-react";
import { useState } from "react";
import { Button, DropdownItem, DropdownMenu, Tooltip } from "@/components/ui";
import { useT } from "@/i18n";
import type { Instance } from "@/lib/types";
import { openInstall } from "@/components/content/installStore";
import { installKey, startManualDownload, useExpected } from "@/components/content/install";
import { stop, type P } from "./shared";

/** Ziel-Instanz-Modus für manuelle Downloads: „Auf CurseForge herunterladen“ (+ „Zur Instanz hinzufügen“). */
export function ManualButton({ project, target, ok, size, wide }: { project: P; target: Instance; ok: boolean; size: "sm" | "md"; wide?: boolean }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const expected = useExpected(installKey(target.id, project));
  const run = (open: boolean) => {
    if (!ok) return openInstall({ project, instanceId: target.id });
    setBusy(true);
    startManualDownload(target.id, project, null, { open })
      .catch(() => {})
      .finally(() => setBusy(false));
  };
  const iconSize = size === "md" ? 15 : 13;
  if (expected)
    return (
      <Tooltip content={<span className="block max-w-[260px] leading-snug">{t("manual.expected_tip")}</span>}>
        <Button
          size={size}
          variant="ghost"
          icon={<Clock size={iconSize} />}
          loading={busy}
          onClick={(e) => {
            e.stopPropagation();
            run(true);
          }}
        >
          {t("manual.expected")}
        </Button>
      </Tooltip>
    );
  const main = (
    <Tooltip content={<span className="block max-w-[260px] leading-snug">{ok ? t("manual.download_tip") : t("discover.maybe_incompatible")}</span>}>
      <Button
        size={size}
        variant={ok ? (wide ? "primary" : "accent") : "ghost"}
        icon={<ExternalLink size={iconSize} />}
        loading={busy}
        onClick={(e) => {
          e.stopPropagation();
          run(true);
        }}
      >
        {wide ? t("manual.download") : t("manual.download_short")}
      </Button>
    </Tooltip>
  );
  if (!wide || !ok) return main;
  return (
    <div className="flex items-center gap-1" onClick={stop}>
      {main}
      <DropdownMenu
        trigger={
          <Button size={size} variant="subtle" className="px-2" aria-label={t("common.more")}>
            <ChevronDown size={14} />
          </Button>
        }
      >
        <DropdownItem icon={<ListPlus size={14} />} onSelect={() => run(false)}>
          <span className="flex flex-col py-0.5">
            <span>{t("manual.add")}</span>
            <span className="max-w-[240px] text-[11.5px] leading-snug text-dim">{t("manual.add_tip")}</span>
          </span>
        </DropdownItem>
      </DropdownMenu>
    </div>
  );
}
