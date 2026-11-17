// Aktiver Account in der Titelleiste, Umschalten per Dropdown.
import { useNavigate } from "@tanstack/react-router";
import { Check, ChevronDown, UserPlus, Users } from "lucide-react";
import { api } from "@/lib/api";
import { useAccounts } from "@/lib/queries";
import { DropdownItem, DropdownLabel, DropdownMenu, DropdownSeparator, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { PlayerHead } from "@/components/PlayerHead";

export function AccountChip() {
  const t = useT();
  const nav = useNavigate();
  const { data: accounts = [] } = useAccounts();
  const active = accounts.find((a) => a.active) ?? accounts[0];

  return (
    <DropdownMenu
      trigger={
        <button className="flex h-8 items-center gap-2 border border-transparent pl-1 pr-2 text-[13px] text-muted transition-colors duration-150 hover:border-line2 hover:text-white">
          {active ? <PlayerHead uuid={active.uuid} name={active.username} size={22} /> : <Users size={16} className="mx-0.5" />}
          <span className="max-w-[140px] truncate">{active ? active.username : t("nav.accounts")}</span>
          <ChevronDown size={13} className="text-dim" />
        </button>
      }
    >
      {accounts.length > 0 && <DropdownLabel>{t("nav.accounts")}</DropdownLabel>}
      {accounts.map((a) => (
        <DropdownItem
          key={a.id}
          icon={a.active ? <Check size={14} className="text-accent" /> : <PlayerHead uuid={a.uuid} name={a.username} size={16} />}
          onSelect={() => api.accountSetActive(a.id).catch((e) => toast.error(e))}
        >
          {a.username}
          <span className="ml-2 font-mono text-[10px] uppercase text-dim">{a.kind === "microsoft" ? "MSA" : "Offline"}</span>
        </DropdownItem>
      ))}
      {accounts.length > 0 && <DropdownSeparator />}
      <DropdownItem icon={<UserPlus size={14} />} onSelect={() => nav({ to: "/accounts" })}>
        {t("nav.accounts")}
      </DropdownItem>
    </DropdownMenu>
  );
}
