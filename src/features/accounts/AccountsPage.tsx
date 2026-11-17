// OWNER: Frontend-Agent B. Minecraft-Konten (nur Microsoft): Liste, aktiv setzen, auffrischen, entfernen, Anmeldung.
import { AlertTriangle, CheckCircle2, LogIn, MoreHorizontal, RefreshCw, ShieldCheck, Star, Trash2, UserRound } from "lucide-react";
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
  Tag,
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
      <div className="mx-auto w-full max-w-[920px] px-8 pb-16 pt-10">
        <div className="flex items-end justify-between gap-6">
          <div className="min-w-0">
            <div className="eyebrow">{t("accounts.eyebrow")}</div>
            <h1 className="display text-[34px]">{t("nav.accounts")}</h1>
            <p className="mt-2.5 max-w-[540px] text-[14px] text-muted">{t("accounts.lead")}</p>
          </div>
          {accounts.length > 0 && (
            <Button variant="primary" icon={<LogIn size={15} />} onClick={() => setMsa(true)}>
              {t("accounts.add_msa")}
            </Button>
          )}
        </div>

        <div className="mt-8">
          {q.isPending ? (
            <div className="flex flex-col gap-3">
              {[0, 1].map((i) => (
                <div key={i} className="flex h-[88px] items-center gap-4 border border-line bg-surface px-5">
                  <Skeleton className="h-12 w-12" />
                  <div className="flex flex-1 flex-col gap-2">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-64" />
                  </div>
                  <Skeleton className="h-8 w-28" />
                </div>
              ))}
            </div>
          ) : q.isError ? (
            <div className="border border-line bg-surface">
              <ErrorState error={q.error} onRetry={() => q.refetch()} />
            </div>
          ) : accounts.length === 0 ? (
            <EmptyAccounts onLogin={() => setMsa(true)} />
          ) : (
            <div className="flex flex-col gap-3">
              {accounts.map((a) => (
                <AccountCard key={a.id} account={a} onRelogin={() => setMsa(true)} />
              ))}
            </div>
          )}
        </div>

        <div className="mt-10 grid grid-cols-2 gap-3">
          <InfoTile icon={<ShieldCheck size={16} />} title={t("accounts.info.secure")} text={t("accounts.info.secure_text")} />
          <InfoTile icon={<UserRound size={16} />} title={t("accounts.info.java")} text={t("accounts.info.java_text")} />
        </div>
      </div>
      <MsaDialog open={msa} onOpenChange={setMsa} />
    </div>
  );
}

function InfoTile({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="border border-line px-5 py-4">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-white">
        <span className="text-accent">{icon}</span>
        {title}
      </div>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{text}</p>
    </div>
  );
}

const STEVE = ["HHHHHHHH", "HHHHHHHH", "HSSSSSSH", "SSSSSSSS", "SWESSEWS", "SSSNNSSS", "SSMMMMSS", "SSMSSMSS"];
const PIXEL: Record<string, string> = { H: "#3b2a1a", S: "#c69c7a", W: "#ffffff", E: "var(--accent)", N: "#8b5a3c", M: "#5a2f1e" };

function EmptyAccounts({ onLogin }: { onLogin: () => void }) {
  const t = useT();
  return (
    <div className="relative overflow-hidden border border-line border-t-2 border-t-accent bg-surface">
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(70% 120% at 90% 0%, color-mix(in srgb, var(--accent) 18%, transparent), transparent 70%)" }}
      />
      <div className="relative flex items-center gap-8 px-9 py-10">
        <div className="grid h-[96px] w-[96px] shrink-0 grid-cols-8 grid-rows-8 border border-line2 bg-black p-2" aria-hidden>
          {/* Pixel-Kopf als Platzhalter */}
          {STEVE.join("").split("").map((c, i) => (
            <span key={i} style={{ background: PIXEL[c] }} />
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="display text-[24px]">{t("accounts.empty.title")}</div>
          <p className="mt-2 max-w-[460px] text-[14px] text-muted">{t("accounts.empty.text")}</p>
          <Button variant="primary" size="lg" className="mt-6" icon={<LogIn size={16} />} onClick={onLogin} autoFocus>
            {t("accounts.empty.cta")}
          </Button>
        </div>
      </div>
    </div>
  );
}

const AccountCard = memo(function AccountCard({ account: a, onRelogin }: { account: Account; onRelogin: () => void }) {
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
      <ContextItem icon={<UserRound size={14} />} onSelect={() => void actions.copyUuid(a)}>
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
          "flex items-center gap-4 border bg-surface px-5 py-4 transition-[border-color,box-shadow] duration-150 data-[state=open]:border-line2",
          a.active ? "border-line2 shadow-[inset_3px_0_0_var(--accent)]" : "border-line hover:border-line2",
        )}
      >
        <PlayerHead uuid={a.uuid} name={a.username} size={52} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <span className="truncate text-[16px] font-semibold text-white">{a.username}</span>
            <Tag>Microsoft</Tag>
            {a.active && (
              <span className="inline-flex h-5 items-center gap-1 bg-accent px-1.5 font-mono text-[10px] font-semibold uppercase tracking-[.08em] text-[var(--on-accent)]">
                <CheckCircle2 size={11} />
                {t("accounts.active")}
              </span>
            )}
          </div>
          <div className="selectable mt-1 truncate font-mono text-[11.5px] text-dim">{formatUuid(a.uuid)}</div>
          {expired ? (
            <div className="mt-1.5 flex items-center gap-1.5 text-[12.5px] text-warn">
              <AlertTriangle size={13} />
              {t("accounts.needs_relogin")}
            </div>
          ) : a.expires_at ? (
            <div className="mt-1 text-[12px] text-dim">
              {a.expires_at > Date.now() ? t("accounts.expires", { time: formatRelative(a.expires_at) }) : t("accounts.expired_refresh")}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {expired ? (
            <Button size="sm" variant="accent" icon={<LogIn size={13} />} onClick={onRelogin}>
              {t("accounts.relogin")}
            </Button>
          ) : (
            !a.active && (
              <Button size="sm" variant="ghost" icon={<Star size={13} />} onClick={() => void actions.setActive(a)}>
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
                <MoreHorizontal size={15} />
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
