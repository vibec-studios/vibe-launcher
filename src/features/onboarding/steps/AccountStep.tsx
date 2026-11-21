import { CheckCircle2, KeyRound, LogIn, ShieldCheck, Shirt } from "lucide-react";
import { useState } from "react";
import { openExternal } from "@/components/content/util";
import { Button } from "@/components/ui";
import { PlayerHead } from "@/components/PlayerHead";
import { useAccounts } from "@/lib/queries";
import { MsaDialog } from "@/features/accounts/MsaDialog";
import { useT } from "@/i18n";
import { Bullet, StepHead } from "../components/StepParts";

const MINECRAFT_STORE = "https://www.minecraft.net/store/minecraft-java-bedrock-edition-pc";

export function AccountStep() {
  const t = useT();
  const { data: accounts = [] } = useAccounts();
  const active = accounts.find((a) => a.active) ?? accounts[0];
  const [msa, setMsa] = useState(false);
  return (
    <>
      <StepHead eyebrow={t("onb.account.eyebrow")} title={t("onb.account.title")} lead={t("onb.account.lead")} />
      {active ? (
        <div className="flex items-center gap-4 rounded-panel bg-surface p-5">
          <PlayerHead uuid={active.uuid} name={active.username} size={52} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[17px] font-semibold text-text">{active.username}</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[13px] text-ok">
              <CheckCircle2 size={14} />
              {t("onb.account.done")}
            </div>
          </div>
          <Button variant="subtle" icon={<LogIn size={14} />} onClick={() => setMsa(true)}>
            {t("acct.add")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-6 rounded-panel bg-surface p-6">
          <Button variant="primary" size="lg" icon={<LogIn size={17} />} onClick={() => setMsa(true)}>
            {t("accounts.empty.cta")}
          </Button>
          <ul className="flex flex-col gap-2.5">
            <Bullet icon={<KeyRound size={14} />}>{t("onb.account.b1")}</Bullet>
            <Bullet icon={<ShieldCheck size={14} />}>{t("onb.account.b2")}</Bullet>
            <Bullet icon={<Shirt size={14} />}>{t("onb.account.b3")}</Bullet>
          </ul>
          <p className="text-[12.5px] text-dim">
            {t("usab.onb.no_game")}{" "}
            <button type="button" className="font-semibold text-accent hover:underline" onClick={() => void openExternal(MINECRAFT_STORE)}>
              {t("usab.onb.no_game.cta")}
            </button>
          </p>
        </div>
      )}
      <MsaDialog open={msa} onOpenChange={setMsa} />
    </>
  );
}
