import { useState } from "react";
import { Globe2, Laptop, Radio, Users } from "lucide-react";
import type { AccountApi } from "@/api/gateway";
import { IS_MOCK } from "@/app/runtime";
import { useT } from "@/i18n";
import { Button } from "@/components/ui";
import { AsidePitch, AuthLayout } from "./AuthLayout";
import { DevicePairing } from "./DevicePairing";

function MicrosoftMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden>
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

export function GatewayWelcome({ account, onSignedIn }: { account: AccountApi; onSignedIn: () => void }) {
  const t = useT();
  const [showCode, setShowCode] = useState(false);
  return (
    <AuthLayout
      aside={
        <AsidePitch
          title={t("welcome.pitch")}
          points={[
            { icon: <Globe2 size={19} />, title: t("welcome.p1.t"), text: t("welcome.p1.d") },
            { icon: <Radio size={19} />, title: t("welcome.p2.t"), text: t("welcome.p2.d") },
            { icon: <Users size={19} />, title: t("welcome.p3.t"), text: t("welcome.p3.d") },
          ]}
        />
      }
    >
      <h2 className="text-[22px] font-bold tracking-tight">{t("welcome.title")}</h2>
      <p className="mt-1.5 text-[13.5px] text-muted">{t("welcome.desc")}</p>
      <a
        href={account.microsoftLoginUrl()}
        className="mt-7 flex h-14 w-full items-center justify-center gap-3 rounded-ctl bg-brand text-[15.5px] font-semibold text-[var(--ui-on-accent)] transition hover:brightness-110"
      >
        <span className="grid size-7 place-items-center rounded-xs bg-white">
          <MicrosoftMark />
        </span>
        {t("welcome.microsoft")}
      </a>
      <p className="mt-2.5 text-center text-meta text-dim">{t("welcome.microsoft_hint")}</p>
      <div className="my-6 flex items-center gap-3 text-meta text-dim">
        <span className="h-px flex-1 bg-line" />
        {t("common.or")}
        <span className="h-px flex-1 bg-line" />
      </div>
      {!showCode ? (
        <Button variant="ghost" className="w-full" size="lg" icon={<Laptop size={17} />} onClick={() => setShowCode(true)}>
          {t("welcome.code_button")}
        </Button>
      ) : (
        <DevicePairing account={account} onSignedIn={onSignedIn} />
      )}
      <p className="mt-7 text-center text-caption text-dim">{t("welcome.beta")}</p>
      {IS_MOCK && <p className="mt-2 text-center text-meta text-warn">{t("welcome.mock_hint")}</p>}
    </AuthLayout>
  );
}
