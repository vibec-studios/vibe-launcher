import { CircleHelp, GitBranch, Globe, LifeBuoy, MessageSquareWarning } from "lucide-react";
import { WEBSITE, WEBSITE_LABEL } from "@/lib/domains";
import { useSystemInfo } from "@/lib/queries";
import { Button, SettingRow, SettingsCard, Spinner } from "@/components/ui";
import { Logo3D } from "@/components/Logo3D";
import { openFeedback } from "@/features/feedback/store";
import { openTicket } from "@/features/tickets/store";
import { openHelp } from "@/features/help/store";
import { useT } from "@/i18n";
import { closeSettings } from "../store";
import { LinkRow } from "../components/LinkRow";

const GITHUB = "https://github.com/vibec-studios/vibe-launcher";

export function AboutTab() {
  const t = useT();
  const sys = useSystemInfo();
  return (
    <>
      <section className="flex items-center gap-5 px-1 py-2">
        <Logo3D size={64} speed={0} hoverSpin float={false} interactive={false} />
        <div className="min-w-0 flex-1">
          <div className="text-title text-text">Vibe Launcher</div>
          <div className="mt-0.5 text-meta tabular-nums text-muted">{sys.data ? `v${sys.data.version} · ${sys.data.os} ${sys.data.arch}` : <Spinner size={12} />}</div>
          <div className="mt-1.5 text-meta text-dim">{t("settings.about")}</div>
        </div>
      </section>
      <SettingsCard title={t("settings.section.links")}>
        <LinkRow href={WEBSITE} icon={<Globe size={15} />} title={t("settings.website")} text={WEBSITE_LABEL} />
        <LinkRow href={GITHUB} icon={<GitBranch size={15} />} title="GitHub" text={t("settings.about.opensource")} />
      </SettingsCard>
      <SettingsCard title={t("uic.about.support")}>
        <SettingRow title={t("help.settings.title")} description={t("help.settings.desc")}>
          <Button
            size="sm"
            icon={<CircleHelp size={13} />}
            data-testid="settings-help-open"
            onClick={() => {
              closeSettings();
              openHelp();
            }}
          >
            {t("help.settings.open")}
          </Button>
        </SettingRow>
        <SettingRow title={t("fb.title")} description={t("fb.desc")}>
          <Button
            size="sm"
            icon={<MessageSquareWarning size={13} />}
            onClick={() => {
              closeSettings();
              // erst nach der Schließ-Animation, damit der Fenster-Screenshot den Launcher zeigt
              setTimeout(() => void openFeedback({ source: "settings" }), 220);
            }}
          >
            {t("fb.button")}
          </Button>
        </SettingRow>
        <SettingRow title={t("tk.title")} description={t("tk.settings_desc")}>
          <Button
            size="sm"
            icon={<LifeBuoy size={13} />}
            onClick={() => {
              closeSettings();
              openTicket();
            }}
          >
            {t("tk.open_list")}
          </Button>
        </SettingRow>
      </SettingsCard>
    </>
  );
}
