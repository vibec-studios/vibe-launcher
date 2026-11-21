import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Copy, FolderOpen, Plus, Trash2, Upload, Wrench, X } from "lucide-react";
import { Button, IconButton, Input, SettingRow, SettingsCard } from "@/components/ui";
import { openExport, openFolder, repairInstance, useInstanceActions } from "@/components/instance/actions";
import { useRunPhase } from "@/components/instance/status";
import { useT } from "@/i18n";
import { useExpert } from "@/lib/simple-mode";
import { closeInstanceSettings } from "../store";
import type { TabProps } from "./types";

// ------------------------------------------------------------------ Erweitert

export function EnvEditor({ env, onChange }: { env: Record<string, string>; onChange: (env: Record<string, string>, delay?: number) => void }) {
  const t = useT();
  const [rows, setRows] = useState<[string, string][]>(() => Object.entries(env));
  const commit = (next: [string, string][], delay = 600) => {
    setRows(next);
    onChange(Object.fromEntries(next.filter(([k]) => k.trim()).map(([k, v]) => [k.trim(), v])), delay);
  };
  return (
    <div className="flex flex-col gap-2">
      {rows.map(([k, v], idx) => (
        <div key={idx} className="flex gap-2">
          <Input className="w-[220px] font-mono text-[12px]" value={k} placeholder="NAME" onChange={(e) => commit(rows.map((r, j) => (j === idx ? [e.target.value, r[1]] : r)))} />
          <Input
            className="flex-1 font-mono text-[12px]"
            value={v}
            placeholder={t("isettings.env.value")}
            onChange={(e) => commit(rows.map((r, j) => (j === idx ? [r[0], e.target.value] : r)))}
          />
          <IconButton label={t("common.remove")} onClick={() => commit(rows.filter((_, j) => j !== idx), 0)} className="h-10 w-10">
            <X size={15} />
          </IconButton>
        </div>
      ))}
      <div>
        <Button size="sm" icon={<Plus size={13} />} onClick={() => setRows([...rows, ["", ""]])}>
          {t("isettings.env.add")}
        </Button>
      </div>
    </div>
  );
}

export function AdvancedTab({ instance, d, update }: TabProps) {
  const t = useT();
  const nav = useNavigate();
  const actions = useInstanceActions();
  const { phase } = useRunPhase(instance.id);
  const running = phase === "running" || phase === "preparing";
  const env = useExpert("env-vars");
  return (
    <>
      {env && (
        <SettingsCard title={t("isd.section.process")}>
          <SettingRow title={t("isettings.env")} description={t("isettings.env.desc")} stacked>
            <EnvEditor env={d.java.env} onChange={(env, delay) => update({ java: { ...d.java, env } }, delay)} />
          </SettingRow>
        </SettingsCard>
      )}

      <SettingsCard title={t("isd.adv.manage")}>
        <SettingRow title={t("isd.adv.export")} description={t("isd.adv.export.desc")}>
          <Button
            size="sm"
            icon={<Upload size={13} />}
            onClick={() => {
              closeInstanceSettings();
              openExport(instance);
            }}
          >
            {t("inst.export")}
          </Button>
        </SettingRow>
        <SettingRow title={t("inst.duplicate")} description={t("isd.adv.duplicate.desc")}>
          <Button size="sm" icon={<Copy size={13} />} onClick={() => actions.duplicate(instance)}>
            {t("inst.duplicate")}
          </Button>
        </SettingRow>
        <SettingRow title={t("isd.adv.folder")} description={t("isd.adv.folder.desc")}>
          <Button size="sm" icon={<FolderOpen size={13} />} onClick={() => openFolder(instance)}>
            {t("common.open_folder")}
          </Button>
        </SettingRow>
        {/* Reparieren ist nicht gefährlich -> zu den normalen Aktionen statt in die Gefahrenzone */}
        <SettingRow title={t("inst.repair")} description={t("isettings.repair.desc")}>
          <Button size="sm" icon={<Wrench size={13} />} disabled={running || phase === "busy"} onClick={() => repairInstance(instance)}>
            {t("inst.repair")}
          </Button>
        </SettingRow>
      </SettingsCard>

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
