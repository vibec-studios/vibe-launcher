// OWNER: Frontend-Agent B. Minecraft-Konten (nur Microsoft): Liste, aktiv setzen, auffrischen, entfernen, Anmeldung.
import { AlertTriangle, CheckCircle2, LogIn, MoreVertical, RefreshCw, ShieldCheck, Star, Trash2, UserRound } from "lucide-react";
import { memo, useState } from "react";
import {
  Button,
  ContextItem,
  ContextMenu,
  ContextSeparator,
  DropdownItem,
  DropdownMenu,
  DropdownSeparator,
  ErrorState,
  IconButton,
  Skeleton,
  Tooltip,
  cn,
  confirm,
  toast,
} from "@/components/ui";
import { useT, t as tt } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { qk, queryClient, useAccounts } from "@/lib/queries";
import type { Account } from "@/lib/types";
import { PlayerHead } from "@/components/PlayerHead";
import { copyText } from "@/components/content/util";
import { MsaDialog } from "./MsaDialog";

function formatUuid(u: string) {
  const c = u.replace(/-/g, "");
  return c.length === 32 ? `${c.slice(0, 8)}-${c.slice(8, 12)}-${c.slice(12, 16)}-${c.slice(16, 20)}-${c.slice(20)}` : u;
}

const actions = {
  setActive: (a: Account) =>
    api
      .accountSetActive(a.id)
      .then(() => queryClient.invalidateQueries({ queryKey: qk.accounts }))
      .catch((e) => toast.error(e, tt("accounts.error.active"))),
  refresh: (a: Account) =>
    api
      .accountRefresh(a.id)
      .then(() => {
        queryClient.invalidateQueries({ queryKey: qk.accounts });
        toast.success(tt("accounts.refreshed", { name: a.username }));
      })
      .catch((e) => toast.error(e, tt("accounts.error.refresh"))),
  remove: async (a: Account) => {
    const ok = await confirm({
      title: tt("accounts.remove_title", { name: a.username }),
      text: tt("accounts.remove_text"),
      confirmLabel: tt("common.remove"),
      danger: true,
    });
    if (!ok) return;
    api
      .accountRemove(a.id)
      .then(() => queryClient.invalidateQueries({ queryKey: qk.accounts }))
      .catch((e) => toast.error(e, tt("accounts.error.remove")));
  },
  copyUuid: (a: Account) => copyText(formatUuid(a.uuid)).then(() => toast.success(tt("common.copied"), formatUuid(a.uuid))),
};

export function AccountsPage() {
  const t = useT();
  const q = useAccounts();
  const [msa, setMsa] = useState(false);
  const accounts = q.data ?? [];

  return (
    <div className="scroll h-full">
      <div className="mx-auto w-full max-w-[860px] px-6 pb-12 pt-6">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="display text-[22px]">{t("nav.accounts")}</h1>
            <p className="mt-0.5 text-[13px] text-muted">{t("accounts.lead")}</p>
          </div>
          {accounts.length > 0 && (
            <Button variant="primary" icon={<LogIn size={15} />} onClick={() => setMsa(true)}>
              {t("accounts.add_msa")}
            </Button>
          )}
        </div>

        <div className="mt-5 border border-line bg-surface">
          {q.isPending ? (
            [0, 1].map((i) => (
              <div key={i} className="flex h-[68px] items-center gap-3.5 border-b border-line px-4 last:border-b-0">
                <Skeleton className="h-10 w-10" />
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-3.5 w-36" />
                  <Skeleton className="h-3 w-56" />
                </div>
                <Skeleton className="h-8 w-24" />
              </div>
            ))
          ) : q.isError ? (
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          ) : accounts.length === 0 ? (
            <EmptyAccounts onLogin={() => setMsa(true)} />
          ) : (
            accounts.map((a) => <AccountRow key={a.id} account={a} onRelogin={() => setMsa(true)} />)
          )}
        </div>

        <p className="mt-4 flex items-start gap-2 text-[12.5px] leading-relaxed text-dim">
          <ShieldCheck size={14} className="mt-0.5 shrink-0" />
          {t("accounts.info.secure_text")} {t("accounts.info.java_text")}
        </p>
      </div>
      <MsaDialog open={msa} onOpenChange={setMsa} />
    </div>
  );
}

function EmptyAccounts({ onLogin }: { onLogin: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <span className="grid h-12 w-12 place-items-center bg-surface3 text-muted">
        <UserRound size={22} />
      </span>
      <div>
        <div className="text-[15px] font-semibold text-white">{t("accounts.empty.title")}</div>
        <p className="mt-1 max-w-[420px] text-[13px] text-muted">{t("accounts.empty.text")}</p>
      </div>
      <Button variant="primary" className="mt-1" icon={<LogIn size={15} />} onClick={onLogin} autoFocus>
        {t("accounts.empty.cta")}
      </Button>
    </div>
  );
}

const AccountRow = memo(function AccountRow({ account: a, onRelogin }: { account: Account; onRelogin: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const refresh = () => {
    setBusy(true);
    void actions.refresh(a).finally(() => setBusy(false));
  };
  const expired = a.needs_relogin;
  const menu = (
    <>
      {!a.active && (
        <ContextItem icon={<Star size={14} />} onSelect={() => void actions.setActive(a)}>
          {t("accounts.set_active")}
        </ContextItem>
      )}
      <ContextItem icon={<RefreshCw size={14} />} onSelect={refresh}>
        {t("accounts.refresh")}
      </ContextItem>
      {expired && (
        <ContextItem icon={<LogIn size={14} />} onSelect={onRelogin}>
          {t("accounts.relogin")}
        </ContextItem>
      )}
      <ContextItem icon={<UserRound size={14} />} onSelect={() => void actions.copyUuid(a).catch((e) => toast.error(e))}>
        {t("accounts.copy_uuid")}
      </ContextItem>
      <ContextSeparator />
      <ContextItem icon={<Trash2 size={14} />} danger onSelect={() => void actions.remove(a)}>
        {t("common.remove")}
      </ContextItem>
    </>
  );
  return (
    <ContextMenu content={menu}>
      <div
        className={cn(
          "flex h-[68px] items-center gap-3.5 border-b border-line px-4 transition-colors duration-100 last:border-b-0 data-[state=open]:bg-white/[.03]",
          a.active ? "shadow-[inset_3px_0_0_var(--color-brand)]" : "hover:bg-white/[.02]",
        )}
      >
        <PlayerHead uuid={a.uuid} name={a.username} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[15px] font-semibold text-white">{a.username}</span>
            {a.active && (
              <span className="inline-flex h-5 items-center gap-1 bg-brand/20 px-1.5 text-[11.5px] font-semibold text-[#c4b5ff]">
                <CheckCircle2 size={11} />
                {t("accounts.active")}
              </span>
            )}
          </div>
          {expired ? (
            <div className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-warn">
              <AlertTriangle size={13} />
              {t("accounts.needs_relogin")}
            </div>
          ) : (
            <div className="mt-0.5 truncate text-[12.5px] text-dim">
              Microsoft
              {a.expires_at ? ` · ${a.expires_at > Date.now() ? t("accounts.expires", { time: formatRelative(a.expires_at) }) : t("accounts.expired_refresh")}` : ""}
              <span className="selectable ml-2 font-mono text-[11px]">{formatUuid(a.uuid)}</span>
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {expired ? (
            <Button size="sm" variant="primary" icon={<LogIn size={14} />} onClick={onRelogin}>
              {t("accounts.relogin")}
            </Button>
          ) : (
            !a.active && (
              <Button size="sm" variant="ghost" onClick={() => void actions.setActive(a)}>
                {t("accounts.set_active")}
              </Button>
            )
          )}
          <Tooltip content={t("accounts.refresh")}>
            <IconButton label={t("accounts.refresh")} size="sm" onClick={refresh} disabled={busy}>
              <RefreshCw size={14} className={busy ? "animate-spin" : undefined} />
            </IconButton>
          </Tooltip>
          <DropdownMenu
            trigger={
              <IconButton label={t("common.more")} size="sm">
                <MoreVertical size={15} />
              </IconButton>
            }
          >
            <DropdownItem icon={<UserRound size={14} />} onSelect={() => void actions.copyUuid(a).catch((e) => toast.error(errorMessage(e)))}>
              {t("accounts.copy_uuid")}
            </DropdownItem>
            <DropdownSeparator />
            <DropdownItem icon={<Trash2 size={14} />} danger onSelect={() => void actions.remove(a)}>
              {t("common.remove")}
            </DropdownItem>
          </DropdownMenu>
        </div>
      </div>
    </ContextMenu>
  );
});
