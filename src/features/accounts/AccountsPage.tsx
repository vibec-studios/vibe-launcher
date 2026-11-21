// OWNER: Frontend-Agent B. Minecraft-Konten (nur Microsoft): flache Liste, aktiv setzen, auffrischen, entfernen, Anmeldung.
import { AlertTriangle, Copy, Gamepad2, LogIn, MoreHorizontal, RefreshCw, ShieldCheck, Star, Trash2 } from "lucide-react";
import { Fragment, memo, useState, type ReactNode } from "react";
import {
  Button,
  ContextItem,
  ContextMenu,
  ContextSeparator,
  DropdownItem,
  DropdownMenu,
  DropdownSeparator,
  EmptyState,
  ErrorState,
  IconButton,
  Page,
  PageToolbar,
  Skeleton,
  Spinner,
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
    <Page width="narrow">
        <PageToolbar
          actions={
            accounts.length > 0 && (
              <Button variant="primary" icon={<LogIn size={15} />} onClick={() => setMsa(true)}>
                {t("accounts.add_msa")}
              </Button>
            )
          }
        >
          <p className="min-w-0 text-[13px] text-muted">{t("accounts.lead")}</p>
        </PageToolbar>

        <div className="rounded-card bg-surface">
          {q.isPending ? (
            [0, 1].map((i) => (
              <div key={i} className="flex h-16 items-center gap-3.5 border-line px-4 [&+&]:border-t">
                <Skeleton className="h-9 w-9" />
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-3.5 w-36" />
                  <Skeleton className="h-3 w-56" />
                </div>
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

        {/* Zwei kurze Hinweise statt eines Textblocks */}
        <div className="mt-1 grid grid-cols-1 gap-x-8 gap-y-4 px-1 min-[760px]:grid-cols-2">
          <InfoNote icon={<ShieldCheck size={15} />} title={t("accounts.info.secure")} text={t("accounts.info.secure_text")} />
          <InfoNote icon={<Gamepad2 size={15} />} title={t("accounts.info.java")} text={t("accounts.info.java_text")} />
        </div>
        <MsaDialog open={msa} onOpenChange={setMsa} />
    </Page>
  );
}

function InfoNote({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 shrink-0 text-dim">{icon}</span>
      <div className="min-w-0">
        <div className="text-[12.5px] font-semibold text-muted">{title}</div>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-dim">{text}</p>
      </div>
    </div>
  );
}

function EmptyAccounts({ onLogin }: { onLogin: () => void }) {
  const t = useT();
  return (
    <EmptyState
      className="py-12"
      icon="user"
      title={t("accounts.empty.title")}
      text={t("accounts.empty.text")}
      action={
        <Button variant="primary" icon={<LogIn size={15} />} onClick={onLogin} autoFocus>
          {t("accounts.empty.cta")}
        </Button>
      }
    />
  );
}

interface AccountAction {
  key: string;
  icon: ReactNode;
  label: string;
  danger?: boolean;
  sep?: boolean;
  onSelect: () => void;
}

/** Flache Zeile: Kopf, Name (+ „Aktiv“), eine Statuszeile. Sichtbar nur, was gerade nötig ist („Neu anmelden“ bei
 *  abgelaufener Anmeldung, sonst „Aktiv setzen“); Auffrischen, UUID kopieren, Entfernen im ⋯-Menü und per Rechtsklick. */
const AccountRow = memo(function AccountRow({ account: a, onRelogin }: { account: Account; onRelogin: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const refresh = () => {
    setBusy(true);
    void actions.refresh(a).finally(() => setBusy(false));
  };
  const expired = a.needs_relogin;
  const items: AccountAction[] = [
    ...(!a.active ? [{ key: "active", icon: <Star size={14} />, label: t("accounts.set_active"), onSelect: () => void actions.setActive(a) }] : []),
    ...(expired ? [{ key: "relogin", icon: <LogIn size={14} />, label: t("accounts.relogin"), onSelect: onRelogin }] : []),
    { key: "refresh", icon: <RefreshCw size={14} />, label: t("accounts.refresh"), onSelect: refresh },
    { key: "uuid", icon: <Copy size={14} />, label: t("accounts.copy_uuid"), onSelect: () => void actions.copyUuid(a).catch((e) => toast.error(errorMessage(e))) },
    { key: "remove", sep: true, danger: true, icon: <Trash2 size={14} />, label: t("common.remove"), onSelect: () => void actions.remove(a) },
  ];
  return (
    <ContextMenu
      content={items.map((it) => (
        <Fragment key={it.key}>
          {it.sep && <ContextSeparator />}
          <ContextItem icon={it.icon} danger={it.danger} onSelect={it.onSelect}>
            {it.label}
          </ContextItem>
        </Fragment>
      ))}
    >
      <div className="group flex h-16 items-center gap-3.5 border-line px-4 transition-colors duration-100 first:rounded-t-card last:rounded-b-card hover:bg-white/[.03] data-[state=open]:bg-white/[.03] [&+&]:border-t">
        <PlayerHead uuid={a.uuid} name={a.username} size={36} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[14px] font-semibold leading-tight text-text">{a.username}</span>
            {a.active && (
              <span className="inline-flex h-5 shrink-0 items-center gap-1.5 rounded-pill bg-brand/15 px-2 text-caption font-semibold text-brand">
                <span className="h-1.5 w-1.5 rounded-dot bg-brand" />
                {t("accounts.active")}
              </span>
            )}
          </div>
          {expired ? (
            <div className="mt-0.5 flex items-center gap-1.5 text-meta text-warn">
              <AlertTriangle size={13} />
              {t("accounts.needs_relogin")}
            </div>
          ) : (
            // Kurz und menschlich; Sitzungsdetails nur im Tooltip, die UUID über das ⋯-Menü kopieren
            <div
              className="mt-0.5 truncate text-meta text-dim"
              title={a.expires_at ? (a.expires_at > Date.now() ? t("accounts.expires", { time: formatRelative(a.expires_at) }) : t("accounts.expired_refresh")) : undefined}
            >
              {t("accounts.signed_in")}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {busy && <Spinner size={13} className="mr-1 text-muted" />}
          {expired ? (
            <Button size="sm" variant="ghost" icon={<LogIn size={14} />} onClick={onRelogin}>
              {t("accounts.relogin")}
            </Button>
          ) : (
            !a.active && (
              <Button size="sm" variant="ghost" onClick={() => void actions.setActive(a)}>
                {t("accounts.set_active")}
              </Button>
            )
          )}
          <DropdownMenu
            trigger={
              <IconButton label={t("common.more")} tip variant="ghost" size="sm">
                <MoreHorizontal size={16} />
              </IconButton>
            }
          >
            {items.map((it) => (
              <Fragment key={it.key}>
                {it.sep && <DropdownSeparator />}
                <DropdownItem icon={it.icon} danger={it.danger} onSelect={it.onSelect}>
                  {it.label}
                </DropdownItem>
              </Fragment>
            ))}
          </DropdownMenu>
        </div>
      </div>
    </ContextMenu>
  );
});
