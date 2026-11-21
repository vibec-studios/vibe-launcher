import { useQuery } from "@tanstack/react-query";
import { ShieldOff } from "lucide-react";
import { Button, Skeleton, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { errText, requireClient, vqk } from "../service";
import { Avatar } from "./Avatar";

// ------------------------------------------------------------------ Blockiert (Dialog)

export function BlockedList() {
  const t = useT();
  const q = useQuery({ queryKey: vqk.blocked, queryFn: () => requireClient().friends.blocked(), staleTime: 60_000 });
  if (q.isLoading)
    return (
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>
    );
  if (q.isError) return <p className="text-[12.5px] text-danger">{errText(q.error)}</p>;
  if (!q.data?.length)
    return (
      <div className="py-8 text-center">
        <p className="text-[13px] text-muted">{t("social.blocked.none")}</p>
      </div>
    );
  return (
    <div className="rounded-card bg-surface">
      {q.data.map((u) => (
        <div key={u.id} className="flex h-12 items-center gap-2.5 border-line px-3 [&+&]:border-t">
          <Avatar user={u} size={28} />
          <span className="min-w-0 flex-1 truncate text-[13.5px] text-text">{u.name}</span>
          <Button
            size="sm"
            variant="ghost"
            icon={<ShieldOff size={13} />}

            onClick={async () => {
              try {
                await requireClient().friends.unblock(u.id);
                q.refetch();
              } catch (e) {
                toast.error(errText(e));
              }
            }}
          >
            {t("social.blocked.unblock")}
          </Button>
        </div>
      ))}
    </div>
  );
}
