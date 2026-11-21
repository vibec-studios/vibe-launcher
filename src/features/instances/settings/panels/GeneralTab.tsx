import { useNavigate } from "@tanstack/react-router";
import { RotateCcw, Trash2 } from "lucide-react";
import { useInstances, useSettings } from "@/lib/queries";
import type { Instance } from "@/lib/types";
import { instanceAccent } from "@/lib/format";
import { Button, Input, Select, SettingRow, SettingsCard, Textarea } from "@/components/ui";
import { createShortcut, useInstanceActions } from "@/components/instance/actions";
import { useRunPhase } from "@/components/instance/status";
import { useT } from "@/i18n";
import { useSimple } from "@/lib/mode";
import { ExpertHint } from "@/features/simple/ExpertHint";
import { ImportSettingsRow } from "@/features/import/SettingsOffer";
import { SimplePerfCard } from "@/features/perf/PerfControls";
import { AccentPicker, GroupInput } from "../../NewInstanceDialog";
import { IconSetting } from "../IconSetting";
import { closeInstanceSettings } from "../store";
import type { TabProps } from "./types";

// ------------------------------------------------------------------ Allgemein

/** Simple-Modus: nur Name, Icon und Löschen (RAM, Java usw. stellt der Launcher selbst ein). */
export function SimpleGeneralTab({ instance, d, update, local, reset }: TabProps) {
  const t = useT();
  const nav = useNavigate();
  const actions = useInstanceActions();
  const { phase } = useRunPhase(instance.id);
  const running = phase === "running" || phase === "preparing";
  const accent = instanceAccent(d.id, d.accent);
  return (
    <>
      <SettingsCard title={t("isd.section.identity")}>
        <SettingRow title={t("newinst.name")} stacked>
          <Input
            value={d.name}
            maxLength={64}
            invalid={!d.name.trim()}
            onChange={(e) => (e.target.value.trim() ? update({ name: e.target.value }, 600) : local({ name: e.target.value }))}
            onBlur={() => !d.name.trim() && reset()}
          />
        </SettingRow>
        <SettingRow title={t("inst.icon")} description={t("iconart.desc")}>
          <IconSetting instance={instance} d={d} update={update} />
        </SettingRow>
        <SettingRow title={t("inst.accent")} stacked>
          <AccentPicker value={accent} onChange={(c) => update({ accent: c })} />
        </SettingRow>
      </SettingsCard>
      <div data-tour="instance-perf">
        <SimplePerfCard d={d} update={update} />
      </div>
      <AutoUpdateCard d={d} update={update} />
      <ImportSettingsRow instance={instance} />
      <ShortcutCard instance={instance} />
      <ExpertHint text={t("usab.expert.instance")} />
      <SettingsCard title={t("isettings.danger")} danger>
        <SettingRow title={t("isettings.delete")} description={t("isettings.delete.desc")}>
          <Button
            variant="danger"
            icon={<Trash2 size={14} />}
            disabled={running}
            onClick={() =>
              actions.remove(instance, () => {
                closeInstanceSettings();
                nav({ to: "/instances" });
              })
            }
          >
            {t("common.delete")}
          </Button>
        </SettingRow>
      </SettingsCard>
    </>
  );
}

export function AutoUpdateCard({ d, update }: Pick<TabProps, "d" | "update">) {
  const t = useT();
  const { data: settings } = useSettings();
  return (
    <SettingsCard title={t("isd.section.content")}>
      <SettingRow title={t("isettings.auto_update")} description={t("isettings.auto_update.desc")}>
        <Select<"default" | "on" | "off">
          className="w-[240px]"
          value={d.auto_update_content === null || d.auto_update_content === undefined ? "default" : d.auto_update_content ? "on" : "off"}
          onChange={(v) => update({ auto_update_content: v === "default" ? null : v === "on" })}
          options={[
            {
              value: "default",
              label: d.source?.project_id
                ? t("isettings.auto_update.default_pack")
                : t("isettings.auto_update.default", { state: settings?.auto_update_content ? t("common.on") : t("common.off") }),
            },
            { value: "on", label: t("isettings.auto_update.on") },
            { value: "off", label: t("isettings.auto_update.off") },
          ]}
        />
      </SettingRow>
    </SettingsCard>
  );
}

export function ShortcutCard({ instance }: { instance: Instance }) {
  const t = useT();
  return (
    <SettingsCard title={t("isd.section.shortcut")}>
      <SettingRow title={t("inst.shortcut")} description={t("inst.shortcut.desc")}>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => createShortcut(instance, "desktop")}>
            {t("inst.shortcut.desktop")}
          </Button>
          <Button size="sm" onClick={() => createShortcut(instance, "start_menu")}>
            {t("inst.shortcut.start_menu")}
          </Button>
        </div>
      </SettingRow>
    </SettingsCard>
  );
}

export function GeneralTab(props: TabProps) {
  return useSimple() ? <SimpleGeneralTab {...props} /> : <ExpertGeneralTab {...props} />;
}

export function ExpertGeneralTab({ instance, d, update, local, reset }: TabProps) {
  const t = useT();
  const { data: all = [] } = useInstances();
  const groups = [...new Set(all.map((i) => i.group).filter((g): g is string => !!g))].sort();
  const accent = instanceAccent(d.id, d.accent);
  return (
    <>
      <SettingsCard title={t("isd.section.identity")}>
        <SettingRow title={t("newinst.name")} stacked>
          <Input
            value={d.name}
            maxLength={64}
            invalid={!d.name.trim()}
            onChange={(e) => (e.target.value.trim() ? update({ name: e.target.value }, 600) : local({ name: e.target.value }))}
            onBlur={() => !d.name.trim() && reset()}
          />
        </SettingRow>
        <SettingRow title={t("inst.icon")} description={t("iconart.desc")}>
          <IconSetting instance={instance} d={d} update={update} />
        </SettingRow>
        <SettingRow
          title={t("inst.accent")}
          stacked
          description={
            d.accent ? (
              <button className="flex items-center gap-1.5 text-[12px] text-dim hover:text-text" onClick={() => update({ accent: null })}>
                <RotateCcw size={11} />
                {t("isettings.accent.reset")}
              </button>
            ) : (
              t("isettings.accent.auto_active")
            )
          }
        >
          <AccentPicker value={accent} onChange={(c) => update({ accent: c })} />
        </SettingRow>
        <SettingRow title={t("inst.group")} stacked>
          <GroupInput value={d.group ?? ""} groups={groups} onChange={(g) => update({ group: g.trim() || null }, 600)} />
        </SettingRow>
        <SettingRow title={t("isettings.notes")} stacked>
          <Textarea value={d.notes ?? ""} placeholder={t("isettings.notes.placeholder")} onChange={(e) => update({ notes: e.target.value || null }, 800)} />
        </SettingRow>
      </SettingsCard>

      <AutoUpdateCard d={d} update={update} />

      <ImportSettingsRow instance={instance} />

      <ShortcutCard instance={instance} />
    </>
  );
}
