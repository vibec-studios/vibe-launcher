// Konto-Menü oben rechts in der Titelleiste (früher der Avatar unten in der Seitenleiste): Kopf mit Skin und Name,
// Konten wechseln/hinzufügen, Abmelden, Skins, Vibe-Status/-Konto (nur mit Vibe), Bedienmodus und Einstellungen.
import * as DM from "@radix-ui/react-dropdown-menu";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDown, Cloud, Link2Off, LogIn, LogOut, Settings as SettingsIcon, Shirt, Sparkles, UserRound, Users } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import { qk, queryClient, useAccounts } from "@/lib/queries";
import { DropdownItem, DropdownLabel, DropdownSeparator, Tooltip, cn, confirm, menuStyles, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { PlayerHead } from "@/components/PlayerHead";
import { MsaDialog } from "@/features/accounts/MsaDialog";
import { useVibe } from "@/lib/vibe";
import { setMode, useSimple } from "@/lib/mode";
import { connect, unlink, useSocial } from "@/features/social/service";
import { openSettings } from "@/features/settings/store";
import { useVibeAccess } from "@/features/access/store";
import type { Account } from "@/lib/types";

/** Farbe des Vibe-Status-Punkts (null = kein Punkt). */
function useVibeDot() {
  const vibe = useVibe();
  const conn = useSocial((s) => s.conn);
  const on = vibe.enabled && conn !== "off" && conn !== "no_account";
  const dot = conn === "ready" ? "bg-ok" : conn === "no_access" ? "bg-dim" : conn === "reconnecting" || conn === "connecting" || conn === "logging_in" ? "bg-warn" : conn === "offline" ? "bg-danger" : null;
  return { on, conn, dot: on ? dot : null };
}

async function signOut(a: Account, t: ReturnType<typeof useT>) {
  const ok = await confirm({
    title: t("acct.signout_title", { name: a.username }),
    text: t("acct.signout_text"),
    confirmLabel: t("acct.signout"),
    danger: true,
  });
  if (!ok) return;
  api
    .accountRemove(a.id)
    .then(() => queryClient.invalidateQueries({ queryKey: qk.accounts }))
    .catch((e) => toast.error(e, t("accounts.error.remove")));
}

export function AccountMenu() {
  const t = useT();
  const nav = useNavigate();
  const { data: accounts = [], isPending } = useAccounts();
  // Solange die Konten laden: neutraler Platzhalter statt kurz „Mit Microsoft anmelden“
  const loading = isPending && !accounts.length;
  const active = accounts.find((a) => a.active) ?? accounts[0];
  const others = accounts.filter((a) => a.id !== active?.id);
  const [msa, setMsa] = useState(false);
  const vibe = useVibeDot();
  const accessStatus = useVibeAccess((s) => s.status);
  const simple = useSimple();

  return (
    <>
      <DM.Root modal={false}>
        <Tooltip content={t("acct.menu")} side="bottom">
          <DM.Trigger asChild>
            <button
              data-tour="account"
              aria-label={active ? `${t("acct.menu")}: ${active.username}` : t("acct.menu")}
              className={cn(
                "group relative flex h-8 max-w-[200px] shrink-0 items-center gap-2 rounded-ctl pl-1 pr-1.5 text-muted transition-colors duration-100",
                "hover:bg-white/[.06] hover:text-text data-[state=open]:bg-white/[.08] data-[state=open]:text-text",
              )}
            >
              <span className="relative shrink-0">
                {active ? (
                  <PlayerHead uuid={active.uuid} name={active.username} size={24} />
                ) : loading ? (
                  <span className="skeleton block h-6 w-6" />
                ) : (
                  <span className="grid h-6 w-6 place-items-center bg-white/[.06]">
                    <UserRound size={15} />
                  </span>
                )}
                {active?.needs_relogin && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-dot border-2 border-[var(--tone-frame)] bg-warn" />}
                {vibe.dot && <span className={cn("absolute -bottom-1 -right-1 h-2.5 w-2.5 rounded-dot border-2 border-[var(--tone-frame)]", vibe.dot)} aria-hidden />}
              </span>
              {loading ? (
                <span className="skeleton block h-3 w-16 max-[860px]:hidden" />
              ) : (
                <span className="min-w-0 truncate text-[13px] font-semibold text-text max-[860px]:hidden">{active ? active.username : t("acct.sign_in_short")}</span>
              )}
              <ChevronDown size={14} className="shrink-0 text-dim transition-transform duration-150 group-data-[state=open]:rotate-180" />
            </button>
          </DM.Trigger>
        </Tooltip>
        <DM.Portal>
          <DM.Content className={cn(menuStyles.panel, "w-[272px]")} align="end" side="bottom" sideOffset={6} collisionPadding={8}>
            {/* Kopf: Skin-Kopf, Name, Status */}
            <div className="flex items-center gap-3 px-2.5 pb-2.5 pt-2">
              {active ? (
                <PlayerHead uuid={active.uuid} name={active.username} size={40} />
              ) : (
                <span className="grid h-10 w-10 shrink-0 place-items-center bg-white/[.06] text-muted">
                  <UserRound size={20} />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-semibold text-text">{active ? active.username : t("rail.no_account")}</div>
                <div className={cn("truncate text-[12px]", active?.needs_relogin ? "text-warn" : "text-muted")}>
                  {active ? (active.needs_relogin ? t("accounts.needs_relogin") : t("acct.microsoft")) : t("acct.sign_in_hint")}
                </div>
              </div>
            </div>
            <DropdownSeparator />

            {/* Konten */}
            {others.length > 0 && (
              <>
                <DropdownLabel>{t("acct.switch")}</DropdownLabel>
                {others.map((a) => (
                  <DropdownItem
                    key={a.id}
                    icon={<PlayerHead uuid={a.uuid} name={a.username} size={16} />}
                    onSelect={() => api.accountSetActive(a.id).catch((e) => toast.error(e))}
                  >
                    {a.username}
                  </DropdownItem>
                ))}
              </>
            )}
            <DropdownItem icon={<LogIn size={14} />} onSelect={() => setMsa(true)}>
              {active ? t("acct.add") : t("acct.sign_in")}
            </DropdownItem>
            {accounts.length > 0 && (
              <DropdownItem icon={<Users size={14} />} onSelect={() => nav({ to: "/accounts" })}>
                {t("rail.manage_accounts")}
              </DropdownItem>
            )}
            {active && (
              <DropdownItem icon={<LogOut size={14} />} onSelect={() => void signOut(active, t)}>
                {t("acct.signout")}
              </DropdownItem>
            )}
            <DropdownSeparator />
            <DropdownItem icon={<Shirt size={14} />} onSelect={() => nav({ to: "/skins" })}>
              {t("nav.skins")}
            </DropdownItem>

            {/* Vibe */}
            {vibe.on && (
              <>
                <DropdownSeparator />
                <DropdownLabel>
                  <span className="flex items-center gap-1.5">
                    {vibe.dot && <span className={cn("h-1.5 w-1.5 rounded-dot", vibe.dot)} />}
                    {vibe.conn === "no_access" ? t(`access.chip.${accessStatus}`) : t(`social.chip.${vibe.conn}`)}
                  </span>
                </DropdownLabel>
                {vibe.conn === "logged_out" ? (
                  <DropdownItem icon={<Cloud size={14} />} onSelect={() => connect().catch((e) => toast.error(e))}>
                    {t("social.conn.login")}
                  </DropdownItem>
                ) : (
                  <DropdownItem icon={<Link2Off size={14} />} onSelect={() => unlink()}>
                    {t("acct.vibe_unlink")}
                  </DropdownItem>
                )}
                <DropdownItem icon={<Cloud size={14} />} onSelect={() => openSettings("vibe")}>
                  {t("vibe.account.manage")}
                </DropdownItem>
              </>
            )}

            <DropdownSeparator />
            {/* Bedienmodus: Schalter direkt im Menü (Menü bleibt offen) */}
            <DM.Item
              className={menuStyles.item}
              onSelect={(e) => {
                e.preventDefault();
                setMode(simple ? "expert" : "simple").catch((err) => toast.error(err));
              }}
            >
              <span className="grid w-4 place-items-center text-muted">
                <Sparkles size={14} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{t("mode.simple_toggle")}</span>
              </span>
              <span
                role="switch"
                aria-checked={simple}
                className={cn("relative h-[18px] w-8 shrink-0 rounded-pill transition-colors duration-150", simple ? "bg-brand" : "bg-white/[.12]")}
              >
                <span
                  className={cn(
                    "absolute top-[3px] h-3 w-3 rounded-pill transition-[left] duration-150",
                    simple ? "left-[17px] bg-white" : "left-[3px] bg-white/75",
                  )}
                />
              </span>
            </DM.Item>
            <DropdownItem icon={<SettingsIcon size={14} />} onSelect={() => openSettings()}>
              {t("nav.settings")}
            </DropdownItem>
          </DM.Content>
        </DM.Portal>
      </DM.Root>
      <MsaDialog open={msa} onOpenChange={setMsa} />
    </>
  );
}
