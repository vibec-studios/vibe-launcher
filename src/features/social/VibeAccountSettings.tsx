// Einstellungen → Vibe-Dienste: Anmeldestatus, Status, Privatsphäre (nur wenn angemeldet).
import { Cloud, LogIn, LogOut } from "lucide-react";
import { useState } from "react";
import { Button, Select, SettingRow, Spinner, toast } from "@/components/ui";
import { useT } from "@/i18n";
import type { Me, Privacy, PrivacyLevel, PresenceStatusSetting } from "@/lib/vibe-sdk";
import { errText, login, logout, requireClient, useSocial } from "./service";

export function VibeAccountSettings() {
  const t = useT();
  const conn = useSocial((s) => s.conn);
  const me = useSocial((s) => s.me);
  const identity = useSocial((s) => s.identity);
  const error = useSocial((s) => s.error);
  const [busy, setBusy] = useState(false);

  const status =
    conn === "ready"
      ? t("social.settings.connected", { name: me?.name ?? identity ?? "" })
      : conn === "logged_out"
        ? t("social.settings.logged_out")
        : conn === "no_account"
          ? t("social.conn.no_account_title")
          : conn === "offline"
            ? t("social.conn.offline_title")
            : conn === "off"
              ? t("social.settings.gateway_off")
              : t("social.conn.connecting");

  return (
    <>
      <SettingRow title={t("social.settings.account")} description={error && conn === "logged_out" ? <span className="text-danger">{error}</span> : status} className="pl-8">
        {conn === "logged_out" ? (
          <Button
            size="sm"
            variant="primary"
            icon={<LogIn size={14} />}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              await login().catch(() => {});
              setBusy(false);
            }}
          >
            {t("social.conn.login")}
          </Button>
        ) : conn === "ready" || conn === "offline" || conn === "reconnecting" ? (
          <Button size="sm" icon={<LogOut size={14} />} onClick={() => logout()}>
            {t("social.chip.logout")}
          </Button>
        ) : conn === "connecting" || conn === "logging_in" ? (
          <Spinner size={14} />
        ) : (
          <Cloud size={16} className="text-dim" />
        )}
      </SettingRow>
      {conn === "ready" && me && <PrivacyRows me={me} />}
    </>
  );
}

function PrivacyRows({ me }: { me: Me }) {
  const t = useT();
  const levels = (keys: PrivacyLevel[]) => keys.map((k) => ({ value: k, label: t(`social.privacy.level.${k}`) }));
  const patch = async (p: { privacy?: Partial<Privacy> }) => {
    try {
      const next = await requireClient().me.update(p);
      useSocial.setState({ me: next });
    } catch (e) {
      toast.error(errText(e));
    }
  };
  const setStatus = async (s: PresenceStatusSetting) => {
    useSocial.setState({ me: { ...me, presenceStatus: s } });
    try {
      await requireClient().presence.set({ status: s });
    } catch (e) {
      toast.error(errText(e));
    }
  };
  return (
    <>
      <SettingRow title={t("social.settings.status")} description={t("social.settings.status.desc")} className="pl-8">
        <Select<PresenceStatusSetting>
          size="sm"
          className="w-[200px]"
          value={me.presenceStatus}
          onChange={setStatus}
          options={(["online", "away", "busy", "invisible"] as const).map((k) => ({ value: k, label: t(`social.status.${k}`) }))}
        />
      </SettingRow>
      <SettingRow title={t("social.privacy.requests")} className="pl-8">
        <Select<PrivacyLevel>
          size="sm"
          className="w-[200px]"
          value={me.privacy.friendRequests}
          onChange={(v) => patch({ privacy: { friendRequests: v } })}
          options={levels(["everyone", "friends_of_friends", "nobody"])}
        />
      </SettingRow>
      <SettingRow title={t("social.privacy.dms")} className="pl-8">
        <Select<PrivacyLevel>
          size="sm"
          className="w-[200px]"
          value={me.privacy.directMessages}
          onChange={(v) => patch({ privacy: { directMessages: v } })}
          options={levels(["everyone", "friends_of_friends", "friends", "nobody"])}
        />
      </SettingRow>
      <SettingRow title={t("social.privacy.invites")} className="pl-8">
        <Select<PrivacyLevel>
          size="sm"
          className="w-[200px]"
          value={me.privacy.invites}
          onChange={(v) => patch({ privacy: { invites: v } })}
          options={levels(["everyone", "friends_of_friends", "friends", "nobody"])}
        />
      </SettingRow>
      <SettingRow title={t("social.privacy.hosting")} description={t("social.privacy.hosting.desc")} className="pl-8">
        <Select<"1" | "0">
          size="sm"
          className="w-[200px]"
          value={me.privacy.showHosting ? "1" : "0"}
          onChange={(v) => patch({ privacy: { showHosting: v === "1" } })}
          options={[
            { value: "1", label: t("social.privacy.level.friends") },
            { value: "0", label: t("social.privacy.level.nobody") },
          ]}
        />
      </SettingRow>
    </>
  );
}
