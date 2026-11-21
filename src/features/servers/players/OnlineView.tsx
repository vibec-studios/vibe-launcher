import type { ReactNode } from "react";
import { Ban, Crown, ListChecks, LogOut, MoreHorizontal } from "lucide-react";
import { api } from "@/lib/api";
import { useServerStatus } from "@/lib/queries";
import type { Server, ServerPlayers } from "@/lib/types";
import { ContextItem, ContextMenu, ContextSeparator, DropdownItem, DropdownMenu, DropdownSeparator, IconButton, toast, type MenuItemProps } from "@/components/ui";
import { PlayerHead } from "@/components/PlayerHead";
import { useT } from "@/i18n";
import { Empty } from "./EntryRow";
import { act, rowCls } from "./playerActions";

/** Aktionen für einen Online-Spieler – gleich für ⋯-Menü und Rechtsklick. */
function OnlineActions({ server, name, isOp, canCmd, Item, Sep }: { server: Server; name: string; isOp: boolean; canCmd: boolean; Item: (p: MenuItemProps) => ReactNode; Sep: () => ReactNode }) {
  const t = useT();
  const cmd = (c: string) => api.serverCommand(server.id, c).catch((e) => toast.error(e, t("srv.console.failed")));
  return (
    <>
      <Item icon={<Crown size={14} />} disabled={isOp} onSelect={() => act(server, "ops", "add", name)}>
        {t("srv.players.make_op")}
      </Item>
      <Item icon={<ListChecks size={14} />} onSelect={() => act(server, "whitelist", "add", name)}>
        {t("srv.players.to_whitelist")}
      </Item>
      <Sep />
      <Item icon={<LogOut size={14} />} disabled={!canCmd} onSelect={() => cmd(`kick ${name}`)}>
        {t("srv.players.kick")}
      </Item>
      <Item icon={<Ban size={14} />} danger onSelect={() => act(server, "banned", "add", name)}>
        {t("srv.players.ban")}
      </Item>
    </>
  );
}

export function OnlineView({ server, data, online, q }: { server: Server; data: ServerPlayers | undefined; online: string[]; q: string }) {
  const t = useT();
  const st = useServerStatus(server.id);
  const running = st?.state === "running";
  const canCmd = running && !st?.detached;
  const shown = online.filter((n) => !q || n.toLowerCase().includes(q));
  if (!running) return <Empty>{t("srv.players.not_running")}</Empty>;
  if (online.length === 0) return <Empty>{t("srv.players.nobody")}</Empty>;
  if (shown.length === 0) return <Empty>{t("srv.players.no_match")}</Empty>;
  return (
    <div className="-mx-3 flex flex-col">
      {shown.map((name) => {
        const isOp = !!data?.ops.some((o) => o.name.toLowerCase() === name.toLowerCase());
        return (
          <ContextMenu key={name} content={<OnlineActions server={server} name={name} isOp={isOp} canCmd={canCmd} Item={ContextItem} Sep={ContextSeparator} />}>
            <div className={rowCls}>
              <PlayerHead uuid={name} name={name} size={24} />
              <span className="selectable min-w-0 flex-1 truncate text-[13px] font-medium text-text">{name}</span>
              {isOp && <Crown size={13} className="shrink-0 text-warn" aria-label={t("srv.players.ops")} />}
              <DropdownMenu
                trigger={
                  <IconButton label={t("common.more")} tip variant="ghost" size="sm" className="opacity-60 group-hover:opacity-100 data-[state=open]:opacity-100">
                    <MoreHorizontal size={15} />
                  </IconButton>
                }
              >
                <OnlineActions server={server} name={name} isOp={isOp} canCmd={canCmd} Item={DropdownItem} Sep={DropdownSeparator} />
              </DropdownMenu>
            </div>
          </ContextMenu>
        );
      })}
    </div>
  );
}
