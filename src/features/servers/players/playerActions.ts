import { api } from "@/lib/api";
import { queryClient, sqk } from "@/lib/queries";
import type { Server, ServerPlayerList } from "@/lib/types";
import { toast } from "@/components/ui";
import { t as tt } from "@/i18n";

export type Sub = "online" | ServerPlayerList;

export async function act(server: Server, list: ServerPlayerList, action: "add" | "remove", name: string, reason?: string | null): Promise<boolean> {
  try {
    const next = await api.serverPlayerAction(server.id, list, action, name, reason ?? null);
    queryClient.setQueryData(sqk.players(server.id), next);
    return true;
  } catch (e) {
    toast.error(e, tt("srv.players.failed", { name }));
    return false;
  }
}

export const rowCls = "group flex h-11 items-center gap-3 rounded-ctl px-3 transition-colors duration-100 hover:bg-white/[.03] data-[state=open]:bg-white/[.04]";
