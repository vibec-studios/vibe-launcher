import type { ReactNode } from "react";
import type { Server, ServerPlayerEntry, ServerPlayerList } from "@/lib/types";
import { Skeleton } from "@/components/ui";
import { useT } from "@/i18n";
import { AddRow } from "./AddRow";
import { Empty, EntryRow } from "./EntryRow";
import { act } from "./playerActions";

export function ListView({
  server,
  list,
  entries,
  q,
  placeholder,
  empty,
  withReason,
  mono,
  extra,
}: {
  server: Server;
  list: ServerPlayerList;
  entries: ServerPlayerEntry[] | undefined;
  q: string;
  placeholder: string;
  empty: string;
  withReason?: boolean;
  mono?: boolean;
  extra?: (e: ServerPlayerEntry) => ReactNode;
}) {
  const t = useT();
  const shown = entries?.filter((e) => !q || e.name.toLowerCase().includes(q) || (e.reason ?? "").toLowerCase().includes(q));
  return (
    <>
      <AddRow placeholder={placeholder} withReason={withReason} mono={mono} onAdd={(n, r) => act(server, list, "add", n, r)} />
      {!shown ? (
        <div className="flex flex-col gap-2 py-2">
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
        </div>
      ) : entries!.length === 0 ? (
        <Empty>{empty}</Empty>
      ) : shown.length === 0 ? (
        <Empty>{t("srv.players.no_match")}</Empty>
      ) : (
        <div className="-mx-3 flex flex-col">
          {shown.map((e) => (
            <EntryRow key={e.uuid ?? e.name} entry={e} mono={mono} right={extra?.(e)} onRemove={() => act(server, list, "remove", e.name)} />
          ))}
        </div>
      )}
    </>
  );
}
