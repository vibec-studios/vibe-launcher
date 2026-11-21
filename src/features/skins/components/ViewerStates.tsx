import { LogIn, UserRound } from "lucide-react";
import { Button, Spinner } from "@/components/ui";
import { useT } from "@/i18n";

export function CenterSpinner() {
  return (
    <div className="absolute inset-0 grid place-items-center">
      <Spinner size={20} />
    </div>
  );
}

export function NoAccount({ onLogin, relogin }: { onLogin: () => void; relogin?: boolean }) {
  const t = useT();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      <UserRound size={24} className="text-dim" />
      <div>
        <div className="text-[15px] font-semibold text-text">{t("skins.no_account_title")}</div>
        <p className="mt-1 max-w-[360px] text-[13px] text-muted">{relogin ? t("skins.relogin_text") : t("skins.no_account_text")}</p>
      </div>
      <Button variant="primary" icon={<LogIn size={15} />} onClick={onLogin}>
        {t("skins.login")}
      </Button>
    </div>
  );
}
