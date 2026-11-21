import { ArrowUpCircle, MoreHorizontal } from "lucide-react";
import type { Server } from "@/lib/types";
import { formatBytes } from "@/lib/format";
import { ContextMenu, DropdownMenu, EmptyState, IconButton, Switch, Tooltip, cn } from "@/components/ui";
import { useT } from "@/i18n";
import type { AddonList, AddonUpdate } from "../addonsApi";
import { toggleAddon, updateAddons } from "./addonActions";
import { AddonIcon } from "./AddonIcon";
import { AddonItems, contextKit, dropdownKit } from "./AddonItems";

const rowCls =
  "group flex min-h-[52px] items-center gap-3 border-line px-4 py-1.5 transition-colors duration-100 hover:bg-white/[.03] data-[state=open]:bg-white/[.04] [&+&]:border-t";

export function InstalledList({ server, list, updates }: { server: Server; list: AddonList; updates: AddonUpdate[] }) {
  const t = useT();
  const byFile = new Map(updates.map((u) => [u.file_name, u]));
  if (list.items.length === 0) {
    return (
      <EmptyState
        icon="box"
        title={list.target.plugins ? t("srv.addons.empty.plugins") : t("srv.addons.empty.mods")}
        text={t("srv.addons.empty.text")}
        className="py-10"
      />
    );
  }
  return (
    <>
      {list.items.map((a) => {
        const up = byFile.get(a.file_name);
        const title = a.title ?? a.name ?? a.file_name.replace(/\.jar(\.disabled)?$/, "");
        return (
          <ContextMenu key={a.file_name} content={<AddonItems server={server} addon={a} update={up} kit={contextKit} />}>
            <div className={cn(rowCls, !a.enabled && "opacity-60")}>
              <AddonIcon src={a.icon} />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className={cn("truncate text-[13px] font-semibold", a.enabled ? "text-text" : "text-dim line-through")}>{title}</span>
                  {a.version && <span className="shrink-0 truncate font-mono text-caption text-dim">{a.version}</span>}
                </div>
                <div className="truncate text-caption text-dim" title={a.file_name}>
                  {[
                    a.authors.length ? a.authors.slice(0, 2).join(", ") : null,
                    a.source ? (a.source === "modrinth" ? "Modrinth" : "Hangar") : t("srv.addons.local"),
                    formatBytes(a.size),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              {up && (
                <Tooltip content={t("srv.addons.update_to", { v: up.latest })}>
                  <span>
                    <IconButton
                      label={t("srv.addons.update_to", { v: up.latest })}
                      variant="ghost"
                      size="sm"
                      className="text-accent!"
                      onClick={() => updateAddons(server, [a.file_name])}
                    >
                      <ArrowUpCircle size={15} />
                    </IconButton>
                  </span>
                </Tooltip>
              )}
              <Switch checked={a.enabled} onChange={(v) => toggleAddon(server, a, v)} label={t("srv.addons.enabled")} />
              <DropdownMenu
                trigger={
                  <IconButton
                    label={t("common.more")}
                    tip
                    variant="ghost"
                    size="sm"
                    className="opacity-60 group-hover:opacity-100 data-[state=open]:opacity-100"
                  >
                    <MoreHorizontal size={15} />
                  </IconButton>
                }
              >
                <AddonItems server={server} addon={a} update={up} kit={dropdownKit} />
              </DropdownMenu>
            </div>
          </ContextMenu>
        );
      })}
    </>
  );
}
