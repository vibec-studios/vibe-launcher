import { create } from "zustand";
import { ChevronRight } from "lucide-react";
import { Button, Dialog, cn } from "@/components/ui";
import { PlayerHead } from "@/components/PlayerHead";
import { useT } from "@/i18n";
import { accountBusy } from "@/lib/sessions";
import { useGameStore } from "@/lib/gameStore";
import type { Account, GameState, Instance } from "@/lib/types";

type Choice = { accountId: string | null } | null;

interface Ask {
  account: Account;
  busy: GameState;
  busyName: string;
  accounts: Account[];
}

interface State {
  ask: Ask | null;
  resolve: ((c: Choice) => void) | null;
  open: (a: Ask) => Promise<Choice>;
  close: (c: Choice) => void;
}

export const useAccountConflict = create<State>((set, get) => ({
  ask: null,
  resolve: null,
  open: (ask) =>
    new Promise<Choice>((resolve) => {
      get().resolve?.(null);
      set({ ask, resolve });
    }),
  close: (c) => {
    get().resolve?.(c);
    set({ ask: null, resolve: null });
  },
}));

export async function chooseLaunchAccount(accounts: Account[], instances: Instance[] | undefined, accountId: string | null): Promise<Choice> {
  const account = accounts.find((a) => a.id === accountId) ?? accounts.find((a) => a.active) ?? accounts[0];
  if (!account) return { accountId };
  const busy = accountBusy(useGameStore.getState().runs, account.uuid);
  if (!busy) return { accountId };
  const busyName = instances?.find((i) => i.id === busy.instance_id)?.name ?? busy.instance_id;
  return useAccountConflict.getState().open({ account, busy, busyName, accounts });
}

export function AccountConflictHost() {
  const t = useT();
  const { ask, close } = useAccountConflict();
  const runs = useGameStore((s) => s.runs);
  const others = ask?.accounts.filter((a) => a.id !== ask.account.id) ?? [];
  const usable = others.filter((a) => !a.needs_relogin);
  return (
    <Dialog
      open={!!ask}
      onOpenChange={(o) => !o && close(null)}
      size="md"
      title={ask ? t("sess.conflict.title", { name: ask.account.username }) : ""}
      description={t("uic.conflict.desc")}
      footer={
        <>
          <Button variant="subtle" onClick={() => close(null)}>
            {t("common.cancel")}
          </Button>
          <Button variant={usable.length ? "ghost" : "primary"} onClick={() => close({ accountId: ask?.account.id ?? null })}>
            {ask ? t("uic.conflict.anyway", { name: ask.account.username }) : ""}
          </Button>
        </>
      }
    >
      {ask && (
        <div className="flex flex-col gap-5 pb-1">
          <div className="flex items-center gap-3 rounded-card border border-warn/30 bg-warn/[.06] px-4 py-3">
            <PlayerHead uuid={ask.account.uuid} name={ask.account.username} size={32} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-semibold text-text">{ask.account.username}</div>
              <div className="truncate text-[12.5px] text-warn">{t("uic.conflict.busy", { name: ask.busyName })}</div>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <div className="label">{t("uic.conflict.pick")}</div>
            {others.length === 0 && <p className="text-[13px] leading-relaxed text-muted">{t("uic.conflict.none")}</p>}
            {others.map((a) => {
              const playing = !!accountBusy(runs, a.uuid);
              return (
                <button
                  key={a.id}
                  disabled={a.needs_relogin}
                  onClick={() => close({ accountId: a.id })}
                  className={cn(
                    "flex h-12 items-center gap-3 rounded-card border border-line bg-surface px-3.5 text-left text-[13.5px] font-medium text-text transition-colors outline-none hover:border-brand hover:bg-brand/[.06] focus-visible:ring-2 focus-visible:ring-brand/60",
                    a.needs_relogin && "cursor-not-allowed opacity-50 hover:border-line hover:bg-surface",
                  )}
                >
                  <PlayerHead uuid={a.uuid} name={a.username} size={28} />
                  <span className="flex-1 truncate">{a.username}</span>
                  {playing && <span className="text-[12px] text-warn">{t("sess.conflict.busy")}</span>}
                  {a.needs_relogin && <span className="text-[12px] text-dim">{t("sess.conflict.relogin")}</span>}
                  {!a.needs_relogin && <ChevronRight size={16} className="shrink-0 text-dim" />}
                </button>
              );
            })}
            {others.length > 0 && <p className="text-[12px] leading-relaxed text-dim">{t("uic.conflict.anyway.text")}</p>}
          </div>
        </div>
      )}
    </Dialog>
  );
}
