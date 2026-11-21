import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Send, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, SearchInput, Skeleton, Spinner, toast } from "@/components/ui";
import { useT } from "@/i18n";
import type { UserWithRelationship } from "@/lib/vibe-sdk";
import { errText, refreshRequests, requireClient, vqk } from "../service";
import { Avatar } from "./Avatar";

// ------------------------------------------------------------------ Suche (Dialog „Freund hinzufügen“)

function useDebounced<T>(v: T, ms: number) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const h = setTimeout(() => setD(v), ms);
    return () => clearTimeout(h);
  }, [v, ms]);
  return d;
}

const NAME_RE = /^[A-Za-z0-9_]{2,25}$/;

export function AddFriendSearch() {
  const t = useT();
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim(), 300);
  const qc = useQueryClient();
  const search = useQuery({
    queryKey: vqk.search(dq),
    queryFn: () => requireClient().users.search(dq, 8),
    enabled: dq.length >= 2,
    staleTime: 15_000,
    retry: 0,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const send = async (u: { userId: string } | { name: string }) => {
    const key = "userId" in u ? u.userId : u.name;
    setBusy(key);
    try {
      const r = await requireClient().friends.request(u);
      toast.success(r.status === "accepted" ? t("social.req.now_friends") : t("social.req.sent"));
      await refreshRequests();
      qc.invalidateQueries({ queryKey: ["vibe", "search"] });
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(null);
    }
  };
  const results = dq.length >= 2 ? (search.data ?? []) : [];
  const exact = results.some((u) => u.name.toLowerCase() === q.trim().toLowerCase());
  return (
    <div className="flex flex-col gap-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (NAME_RE.test(q.trim())) void send({ name: q.trim() });
        }}
      >
        <SearchInput value={q} onChange={setQ} placeholder={t("social.add.placeholder")} aria-label={t("social.add.placeholder")} autoFocus />
      </form>
      <div className="min-h-[188px] rounded-card bg-surface">
        {dq.length < 2 ? (
          <div className="flex h-[188px] flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="max-w-[300px] text-[12.5px] text-muted">{t("social.add.hint")}</p>
          </div>
        ) : search.isLoading ? (
          <div className="flex flex-col gap-1 p-2">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : search.isError ? (
          <p className="px-3 py-3 text-[12.5px] text-danger">{errText(search.error)}</p>
        ) : (
          <div className="py-1">
            {results.map((u) => (
              <SearchResult key={u.id} u={u} busy={busy === u.id} onAdd={() => send({ userId: u.id })} />
            ))}
            {!results.length && <p className="px-3 py-3 text-[12.5px] text-dim">{t("social.add.none")}</p>}
            {!exact && NAME_RE.test(q.trim()) && (
              <button
                onClick={() => void send({ name: q.trim() })}
                disabled={!!busy}
                className="flex h-11 w-full items-center gap-2.5 px-3 text-left text-[13px] text-muted transition-colors hover:bg-white/[.04] hover:text-text"
              >
                <span className="grid h-7 w-7 place-items-center text-brand">{busy === q.trim() ? <Spinner size={12} /> : <Send size={14} />}</span>
                {t("social.add.by_name", { name: q.trim() })}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SearchResult({ u, busy, onAdd }: { u: UserWithRelationship; busy: boolean; onAdd: () => void }) {
  const t = useT();
  const label: Record<string, string> = {
    friend: t("social.add.is_friend"),
    outgoing: t("social.add.pending"),
    incoming: t("social.add.incoming"),
    self: t("social.add.self"),
    blocked: t("social.add.blocked"),
    blocked_by: t("social.add.unavailable"),
  };
  const canAdd = u.relationship === "none" || u.relationship === "incoming";
  return (
    <div className="flex h-11 items-center gap-2.5 px-3">
      <Avatar user={u} size={28} />
      <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-text">{u.name}</span>
      {canAdd ? (
        <Button size="sm" variant="ghost" icon={busy ? <Spinner size={12} /> : <UserPlus size={14} />} onClick={onAdd} disabled={busy}>
          {u.relationship === "incoming" ? t("social.req.accept") : t("social.add.send")}
        </Button>
      ) : (
        <span className="text-caption text-dim">{label[u.relationship]}</span>
      )}
    </div>
  );
}
