import { create } from "zustand";
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

const useAsk = create<State>((set, get) => ({
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
  return useAsk.getState().open({ account, busy, busyName, accounts });
}

export function AccountConflictHost() {
  const t = useT();
  const { ask, close } = useAsk();
  const runs = useGameStore((s) => s.runs);
  const others = ask?.accounts.filter((a) => a.id !== ask.account.id) ?? [];
  return (
    <Dialog
      open={!!ask}
      onOpenChange={(o) => !o && close(null)}
      size="sm"
      title={ask ? t("sess.conflict.title", { name: ask.account.username }) : ""}
      description={ask ? t("sess.conflict.text", { name: ask.account.username, instance: ask.busyName, n: ask.busy.slot }) : undefined}
      footer={
        <>
          <Button variant="subtle" onClick={() => close(null)}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={() => close({ accountId: ask?.account.id ?? null })}>
            {ask ? t("sess.conflict.anyway", { name: ask.account.username }) : ""}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        <div className="text-[12px] font-semibold text-dim">{t("sess.conflict.pick")}</div>
        {others.length === 0 && <div className="text-[13px] text-muted">{t("sess.conflict.none")}</div>}
        {others.map((a) => {
          const playing = !!accountBusy(runs, a.uuid);
          return (
            <button
              key={a.id}
              disabled={a.needs_relogin}
              onClick={() => close({ accountId: a.id })}
              className={cn(
                "flex h-11 items-center gap-3 rounded-ctl bg-surface2 px-3 text-left text-[13px] font-medium text-text transition-colors hover:bg-surface3",
                a.needs_relogin && "cursor-not-allowed opacity-50",
              )}
            >
              <PlayerHead uuid={a.uuid} name={a.username} size={24} />
              <span className="flex-1 truncate">{a.username}</span>
              {playing && <span className="text-[11px] text-warn">{t("sess.conflict.busy")}</span>}
              {a.needs_relogin && <span className="text-[11px] text-dim">{t("sess.conflict.relogin")}</span>}
            </button>
          );
        })}
      </div>
    </Dialog>
  );
}
