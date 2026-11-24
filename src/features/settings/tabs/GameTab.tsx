import type { LaunchBehavior } from "@/lib/types";
import { Input, NumberInput, Select, SettingRow, SettingsCard, Switch } from "@/components/ui";
import { MasterOptSync, SyncOverview } from "@/components/instance/OptSync";
import { FixBackupPicker } from "@/features/backups/FixBackupPicker";
import { AfkSettingsCard } from "@/features/afk/AfkSettingsCard";
import { LeanSettingsRows } from "@/features/lean/LeanSettingsRows";
import { VibeFixCard } from "@/features/vibefix/VibeFixCard";
import { CustomLoadersCard } from "@/features/customloaders/CustomLoadersCard";
import { useExpert } from "@/lib/simple-mode";
import { Term } from "@/features/help/glossary/Term";
import { useT } from "@/i18n";
import type { TabProps } from "../types";

export function GameTab({ s, update }: TabProps) {
  const t = useT();
  const logs = useExpert("game-logs");
  const hooks = useExpert("launch-hooks");
  return (
    <>
      <SettingsCard title={t("settings.section.window")}>
        <SettingRow title={t("settings.resolution")} description={t("settings.resolution.desc")}>
          <div className="flex items-center gap-2">
            <NumberInput
              className="w-[110px]"
              value={s.game_width}
              min={320}
              max={7680}
              unit="px"
              onChange={(w) => w !== null && update({ game_width: w })}
              aria-label="width"
            />
            <span className="text-dim">×</span>
            <NumberInput
              className="w-[110px]"
              value={s.game_height}
              min={240}
              max={4320}
              unit="px"
              onChange={(h) => h !== null && update({ game_height: h })}
              aria-label="height"
            />
          </div>
        </SettingRow>
        <SettingRow title={t("settings.fullscreen")} description={t("settings.fullscreen.desc")}>
          <Switch checked={s.fullscreen} onChange={(fullscreen) => update({ fullscreen })} label={t("settings.fullscreen")} />
        </SettingRow>
      </SettingsCard>

      <SettingsCard title={t("settings.section.launch")}>
        <SettingRow title={t("settings.launch_behavior")} description={t("settings.launch_behavior.desc")}>
          <div className="w-[230px]">
            <Select<LaunchBehavior>
              value={s.launch_behavior}
              onChange={(launch_behavior) => update({ launch_behavior })}
              options={(["keep", "minimize", "hide"] as const).map((v) => ({ value: v, label: t(`settings.launch_behavior.${v}`) }))}
            />
          </div>
        </SettingRow>
        <LeanSettingsRows s={s} update={update} />
        {logs && (
          <SettingRow title={t("settings.open_log")} description={t("settings.open_log.desc")}>
            <Switch checked={s.open_log_on_launch} onChange={(open_log_on_launch) => update({ open_log_on_launch })} label={t("settings.open_log")} />
          </SettingRow>
        )}
        {logs && (
          <SettingRow title={t("settings.console")} description={t("settings.console.desc")}>
            <Switch checked={s.console_on_launch} onChange={(console_on_launch) => update({ console_on_launch })} label={t("settings.console")} />
          </SettingRow>
        )}
        <SettingRow title={<Term id="snapshot">{t("settings.snapshots")}</Term>} description={t("settings.snapshots.desc")}>
          <Switch checked={s.show_snapshots} onChange={(show_snapshots) => update({ show_snapshots })} label={t("settings.snapshots")} />
        </SettingRow>
        {hooks && (
          <SettingRow title={t("settings.wrapper")} description={t("settings.wrapper.desc")} stacked>
            <Input
              className="font-mono text-[12px]"
              value={s.wrapper_command ?? ""}
              placeholder="gamemoderun"
              onChange={(e) => update({ wrapper_command: e.target.value.trim() ? e.target.value : null }, 700)}
            />
          </SettingRow>
        )}
      </SettingsCard>

      <SettingsCard title={t("settings.section.sync")}>
        <SyncOverview />
      </SettingsCard>

      <SettingsCard title={t("sync.overview.master")}>
        <MasterOptSync />
      </SettingsCard>

      <div data-tour="settings-backups">
      <SettingsCard title={t("settings.section.backups")}>
        <SettingRow title={t("settings.backups.snapshot_keep")} description={t("settings.backups.snapshot_keep.desc")}>
          <NumberInput
            className="w-[110px]"
            value={s.snapshot_keep}
            min={1}
            max={100}
            onChange={(v) => v !== null && update({ snapshot_keep: v })}
            aria-label={t("settings.backups.snapshot_keep")}
          />
        </SettingRow>
        <SettingRow title={t("settings.backups.fix")} description={t("settings.backups.fix.desc")} stacked>
          <FixBackupPicker value={s.fix_backup} onChange={(fix_backup) => update({ fix_backup })} />
        </SettingRow>
        <SettingRow title={t("settings.backups.world_on_launch")} description={t("settings.backups.world_on_launch.desc")}>
          <Switch
            checked={s.world_backup_on_launch}
            onChange={(world_backup_on_launch) => update({ world_backup_on_launch })}
            label={t("settings.backups.world_on_launch")}
          />
        </SettingRow>
        <SettingRow title={t("settings.backups.world_keep")} description={t("settings.backups.world_keep.desc")}>
          <NumberInput
            className="w-[110px]"
            value={s.world_backups_keep}
            min={1}
            max={100}
            onChange={(v) => v !== null && update({ world_backups_keep: v })}
            aria-label={t("settings.backups.world_keep")}
          />
        </SettingRow>
      </SettingsCard>
      </div>

      <VibeFixCard s={s} update={update} />

      <AfkSettingsCard s={s} update={update} />

      <CustomLoadersCard s={s} update={update} />
    </>
  );
}
