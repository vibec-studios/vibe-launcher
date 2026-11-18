// Account-Knopf unten in der Icon-Leiste: aktiver Account, Wechseln, Microsoft-Konto hinzufügen.
import { useNavigate } from "@tanstack/react-router";
import { Check, Cloud, CloudOff, LogIn, LogOut, UserRound, Users } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import { useAccounts } from "@/lib/queries";
import { DropdownItem, DropdownLabel, DropdownMenu, DropdownSeparator, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { PlayerHead } from "@/components/PlayerHead";
import { MsaDialog } from "@/features/accounts/MsaDialog";
import { useVibe } from "@/lib/vibe";
import { login, logout, useSocial } from "@/features/social/service";
import { cn } from "@/components/ui";

export function AccountChip() {
  const t = useT();
  const nav = useNavigate();
  const { data: accounts = [] } = useAccounts();
  const active = accounts.find((a) => a.active) ?? accounts[0];
  const [msa, setMsa] = useState(false);
  const vibe = useVibe();
  const conn = useSocial((s) => s.conn);
  const vibeOn = vibe.enabled && conn !== "off" && conn !== "no_account";
  const dot = conn === "ready" ? "bg-ok" : conn === "reconnecting" || conn === "connecting" || conn === "logging_in" ? "bg-warn" : conn === "offline" ? "bg-danger" : null;

  return (
    <>
      <DropdownMenu
        side="right"
        align="end"
        trigger={
          <button
            aria-label={active ? active.username : t("nav.accounts")}
            className="relative mt-1 grid h-10 w-10 place-items-center border border-line bg-surface2 text-muted transition-colors duration-100 hover:border-line2 hover:text-white"
          >
            {active ? <PlayerHead uuid={active.uuid} name={active.username} size={30} /> : <UserRound size={18} />}
            {active?.needs_relogin && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 border-2 border-black bg-warn" />}
            {vibeOn && dot && <span className={cn("absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 border-2 border-black", dot)} aria-hidden />}
          </button>
        }
      >
        {accounts.length > 0 ? <DropdownLabel>{t("nav.accounts")}</DropdownLabel> : <DropdownLabel>{t("rail.no_account")}</DropdownLabel>}
        {accounts.map((a) => (
          <DropdownItem
            key={a.id}
            icon={a.id === active?.id ? <Check size={14} className="text-brand" /> : <PlayerHead uuid={a.uuid} name={a.username} size={16} />}
            onSelect={() => api.accountSetActive(a.id).catch((e) => toast.error(e))}
          >
            {a.username}
          </DropdownItem>
        ))}
        <DropdownSeparator />
        {vibeOn && (
          <>
            <DropdownLabel>{t(`social.chip.${conn}`)}</DropdownLabel>
            {conn === "logged_out" ? (
              <DropdownItem icon={<Cloud size={14} />} onSelect={() => login().catch((e) => toast.error(e))}>
                {t("social.conn.login")}
              </DropdownItem>
            ) : (
              <DropdownItem icon={conn === "offline" ? <CloudOff size={14} /> : <LogOut size={14} />} onSelect={() => logout()}>
                {t("social.chip.logout")}
              </DropdownItem>
            )}
          </>
        )}
        <DropdownSeparator />
        <DropdownItem icon={<LogIn size={14} />} onSelect={() => setMsa(true)}>
          {t("rail.add_account")}
        </DropdownItem>
        <DropdownItem icon={<Users size={14} />} onSelect={() => nav({ to: "/accounts" })}>
          {t("rail.manage_accounts")}
        </DropdownItem>
      </DropdownMenu>
      <MsaDialog open={msa} onOpenChange={setMsa} />
    </>
  );
}
