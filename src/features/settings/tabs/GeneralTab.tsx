import type { ReactNode } from "react";
import { Button, Segmented, Select, SettingRow, SettingsCard, Switch, toast } from "@/components/ui";
import { useSystemInfo, useAccounts } from "@/lib/queries";
import { setMode, useSimple, type UiMode } from "@/lib/mode";
import { useExpert } from "@/lib/simple-mode";
import { LANGUAGES, useLang, useT, type Lang } from "@/i18n";
import { PortableCard } from "@/features/portable/PortableCard";
import { ModrinthLinksCard } from "@/features/mrlinks/ModrinthLinksCard";
import { SkinImportSettings } from "@/features/skins/SkinImport";
import { restartOnboarding, startTour } from "@/features/onboarding/store";
import { PlayerHead } from "@/components/PlayerHead";
import { useNavigate } from "@tanstack/react-router";
import { closeSettings } from "../store";
import { SecretInput } from "../components/SecretInput";
import type { TabProps } from "../types";

/** Bedienung: Simple/Expert, Einrichtung bzw. Einführung erneut starten (in beiden Modi). */
function ModeCard({ language }: { language: ReactNode }) {
  const t = useT();
  const simple = useSimple();
  return (
    <SettingsCard title={t("settings.section.general")}>
      {language}
      <SettingRow title={t("mode.title")} description={simple ? t("mode.simple.desc") : t("mode.expert.desc")}>
        <Segmented<UiMode>
          value={simple ? "simple" : "expert"}
          onChange={(m) => void setMode(m).catch((e) => toast.error(e))}
          items={[
            { value: "simple", label: t("mode.simple") },
            { value: "expert", label: t("mode.expert") },
          ]}
        />
      </SettingRow>
      {simple && (
        <SettingRow title={t("mode.tour.title")} description={t("mode.tour.desc")}>
          <Button
            size="sm"
            onClick={() => {
              closeSettings();
              startTour();
            }}
          >
            {t("mode.tour")}
          </Button>
        </SettingRow>
      )}
      <SettingRow title={t("mode.onboarding")} description={t("mode.onboarding.desc")}>
        <Button
          size="sm"
          onClick={() => {
            closeSettings();
            restartOnboarding();
          }}
        >
          {t("mode.onboarding.start")}
        </Button>
      </SettingRow>
    </SettingsCard>
  );
}

/** Simple-Modus: angemeldetes Konto mit Verwalten. */
function AccountCard() {
  const t = useT();
  const nav = useNavigate();
  const { data: accounts = [] } = useAccounts();
  const active = accounts.find((a) => a.active) ?? accounts[0];
  return (
    <SettingsCard title={t("simple.settings.account")}>
      <SettingRow
        icon={active ? <PlayerHead uuid={active.uuid} name={active.username} size={32} /> : undefined}
        title={active ? active.username : t("rail.no_account")}
        description={active ? t("acct.microsoft") : t("acct.sign_in_hint")}
      >
        <Button
          size="sm"
          onClick={() => {
            closeSettings();
            nav({ to: "/accounts" });
          }}
        >
          {accounts.length ? t("rail.manage_accounts") : t("acct.sign_in")}
        </Button>
      </SettingRow>
    </SettingsCard>
  );
}

export function GeneralTab({ s, update }: TabProps) {
  const simple = useSimple();
  const apiKeys = useExpert("api-keys");
  const t = useT();
  const sys = useSystemInfo();
  return (
    <>
      <ModeCard
        language={
          <SettingRow title={t("settings.language")} description={t("settings.language.desc")}>
            <Select<Lang>
              value={s.language}
              onChange={(language) => {
                useLang.getState().setLang(language);
                update({ language });
              }}
              className="w-[230px]"
              options={LANGUAGES.map((l) => ({ value: l.code, label: l.name }))}
            />
          </SettingRow>
        }
      />

      {simple && <AccountCard />}

      <SettingsCard title={t("settings.section.content")}>
        <SettingRow title={t("settings.auto_update")} description={t("settings.auto_update.desc")}>
          <Switch checked={s.auto_update_content} onChange={(v) => update({ auto_update_content: v })} label={t("settings.auto_update")} />
        </SettingRow>
      </SettingsCard>

      <ModrinthLinksCard />

      {apiKeys && (
      <SettingsCard title={t("settings.section.integrations")}>
        <SettingRow
          title="Microsoft Client-ID"
          description={
            <>
              {t("settings.msa.desc")}{" "}
              <span className={sys.data?.msa_available ? "text-ok" : "text-warn"}>
                {sys.data?.msa_available ? t("settings.status.active") : t("settings.status.inactive")}
              </span>
            </>
          }
          stacked
        >
          <SecretInput
            value={s.msa_client_id ?? ""}
            placeholder="00000000-0000-0000-0000-000000000000"
            onChange={(v) => update({ msa_client_id: v.trim() || null }, 700)}
          />
        </SettingRow>
      </SettingsCard>
      )}

      <SkinImportSettings />

      <PortableCard />
    </>
  );
}
