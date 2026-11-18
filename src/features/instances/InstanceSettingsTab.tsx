// Einstellungen einer Instanz. Speichert automatisch (gebündelt, verzögert); Änderungen kommen per
// `instance://changed` zurück.
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, ImageIcon, Plus, RotateCcw, Trash2, Wrench, X } from "lucide-react";
import { api } from "@/lib/api";
import { qk, useSettings, useSystemInfo } from "@/lib/queries";
import { useQuery } from "@tanstack/react-query";
import type { Instance, InstancePatch, JavaOptions, WindowOptions } from "@/lib/types";
import { instanceAccent, loaderNames } from "@/lib/format";
import { Button, IconButton, Input, NumberInput, Select, SettingRow, SettingsCard, Switch, Textarea, Tooltip, confirm, toast } from "@/components/ui";
import { InstanceIcon } from "@/components/instance/InstanceIcon";
import { VersionPicker, type VersionValue } from "@/components/instance/VersionPicker";
import { JavaPathField, MemoryField, SaveIndicator, useAutoSave } from "@/components/instance/forms";
import { repairInstance, resetIcon, setIcon, useInstanceActions, installInstance } from "@/components/instance/actions";
import { useRunPhase } from "@/components/instance/status";
import { useInstances } from "@/lib/queries";
import { VibeyClientSlot } from "@/features/cosmetics/VibeyClientSlot";
import { useT } from "@/i18n";
import { InstanceOptSync } from "@/components/instance/OptSync";
import { createShortcut } from "@/components/instance/actions";
import { AccentPicker, GroupInput } from "./NewInstanceDialog";

const apply = (base: Instance, p: InstancePatch): Instance => ({ ...base, ...p }) as Instance;

/** JVM-Flag-Vorlagen (Content-Agent). */
const JVM_PRESETS: Record<"g1" | "zgc" | "low", string> = {
  g1: "-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:+AlwaysPreTouch -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 -XX:G1HeapRegionSize=8M -XX:G1ReservePercent=20 -XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4 -XX:InitiatingHeapOccupancyPercent=15 -XX:G1MixedGCLiveThresholdPercent=90 -XX:G1RSetUpdatingPauseTimePercent=5 -XX:SurvivorRatio=32 -XX:+PerfDisableSharedMem -XX:MaxTenuringThreshold=1",
  zgc: "-XX:+UseZGC -XX:+ZGenerational -XX:+AlwaysPreTouch -XX:+DisableExplicitGC",
  low: "-XX:+UseG1GC -XX:MaxGCPauseMillis=50 -XX:+UseStringDeduplication -XX:+DisableExplicitGC",
};

/** RAM-Empfehlung (MB) nach Mod-Anzahl, höchstens die Hälfte des Systemspeichers. */
function recommendRam(mods: number, totalMb: number): number {
  const gb = mods === 0 ? 2 : mods <= 30 ? 3 : mods <= 80 ? 4 : mods <= 150 ? 6 : mods <= 250 ? 8 : 10;
  return Math.max(2048, Math.min(gb * 1024, Math.floor(totalMb / 2 / 512) * 512));
}

function VersionCard({ instance: i }: { instance: Instance }) {
  const t = useT();
  const { phase } = useRunPhase(i.id);
  const [editing, setEditing] = useState(false);
  const [ver, setVer] = useState<VersionValue>({ mc: i.mc_version, loader: i.loader.kind, loaderVersion: i.loader.version });
  const [busy, setBusy] = useState(false);
  const changed = ver.mc !== i.mc_version || ver.loader !== i.loader.kind || (ver.loader !== "vanilla" && ver.loaderVersion !== i.loader.version);
  const valid = !!ver.mc && (ver.loader === "vanilla" || !!ver.loaderVersion);

  const applyChange = async () => {
    const ok = await confirm({
      title: t("isettings.version.confirm"),
      text: t("isettings.version.confirm_text"),
      confirmLabel: t("isettings.version.apply"),
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.instanceUpdate(i.id, { mc_version: ver.mc!, loader: { kind: ver.loader, version: ver.loader === "vanilla" ? null : ver.loaderVersion } });
      installInstance(i.id);
      setEditing(false);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsCard
      title={t("isettings.version")}
      right={
        !editing && (
          <Button
            size="sm"
            disabled={phase !== "idle"}
            onClick={() => {
              setVer({ mc: i.mc_version, loader: i.loader.kind, loaderVersion: i.loader.version });
              setEditing(true);
            }}
          >
            {t("isettings.version.change")}
          </Button>
        )
      }
    >
      {!editing ? (
        <SettingRow
          title={`Minecraft ${i.mc_version}`}
          description={i.loader.kind === "vanilla" ? "Vanilla" : `${loaderNames[i.loader.kind]} ${i.loader.version ?? ""}`}
        />
      ) : (
        <div className="flex flex-col gap-5 px-4 py-5">
          <div className="flex items-start gap-3 border border-warn/30 bg-warn/[.06] px-4 py-3 text-[13px] text-warn">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>{t("isettings.version.warn")}</span>
          </div>
          <VersionPicker value={ver} onChange={setVer} listHeight={240} />
          <div className="flex justify-end gap-3">
            <Button variant="subtle" onClick={() => setEditing(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="accent" disabled={!changed || !valid} loading={busy} onClick={applyChange}>
              {t("isettings.version.apply")}
            </Button>
          </div>
        </div>
      )}
    </SettingsCard>
  );
}

function EnvEditor({ env, onChange }: { env: Record<string, string>; onChange: (env: Record<string, string>, delay?: number) => void }) {
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
          <Input
            className="w-[220px] font-mono text-[12px]"
            value={k}
            placeholder="NAME"
            onChange={(e) => commit(rows.map((r, j) => (j === idx ? [e.target.value, r[1]] : r)))}
          />
          <Input
            className="flex-1 font-mono text-[12px]"
            value={v}
            placeholder={t("isettings.env.value")}
            onChange={(e) => commit(rows.map((r, j) => (j === idx ? [r[0], e.target.value] : r)))}
          />
          <IconButton
            label={t("common.remove")}
            onClick={() =>
              commit(
                rows.filter((_, j) => j !== idx),
                0,
              )
            }
            className="h-10 w-10"
          >
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

export function InstanceSettingsTab({ instance }: { instance: Instance }) {
  const t = useT();
  const nav = useNavigate();
  const { data: settings } = useSettings();
  const { data: sys } = useSystemInfo();
  const { data: all = [] } = useInstances();
  const actions = useInstanceActions();
  const { phase } = useRunPhase(instance.id);
  const groups = [...new Set(all.map((i) => i.group).filter((g): g is string => !!g))].sort();
  const { draft: d, update, local, reset, state } = useAutoSave(instance, apply, (p: InstancePatch) => api.instanceUpdate(instance.id, p));

  const accent = instanceAccent(d.id, d.accent);
  const java = (p: Partial<JavaOptions>, delay = 0) => update({ java: { ...d.java, ...p } }, delay);
  const win = (p: Partial<WindowOptions>, delay = 0) => update({ window: { ...d.window, ...p } }, delay);
  const ramOverride = d.java.max_memory_mb !== null || d.java.min_memory_mb !== null;
  const modsQ = useQuery({ queryKey: qk.content(instance.id, "mod"), queryFn: () => api.contentList(instance.id, "mod"), staleTime: 60_000 });
  const modCount = modsQ.data?.filter((m) => m.enabled).length ?? null;
  const winOverride = d.window.width !== null || d.window.height !== null || d.window.fullscreen !== null;
  const total = sys?.total_memory_mb ?? 8192;
  const running = phase === "running" || phase === "preparing";

  return (
    <div className="relative h-full">
      {state !== "idle" && (
        <div className="pointer-events-none absolute bottom-4 right-8 z-10 rounded-ctl bg-overlay px-2 py-1 shadow-e2">
          <SaveIndicator state={state} />
        </div>
      )}
      <div className="scroll h-full">
        <div className="flex w-full flex-col gap-4 px-6 pb-8 pt-5">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-5">
            <div className="flex flex-col gap-5">
              <SettingsCard title={t("isettings.general")}>
                <SettingRow title={t("newinst.name")} stacked>
                  <Input
                    value={d.name}
                    maxLength={64}
                    invalid={!d.name.trim()}
                    onChange={(e) => (e.target.value.trim() ? update({ name: e.target.value }, 600) : local({ name: e.target.value }))}
                    onBlur={() => !d.name.trim() && reset()}
                  />
                </SettingRow>
                <SettingRow title={t("inst.icon")} description={t("isettings.icon.desc")}>
                  <div className="flex items-center gap-3">
                    <InstanceIcon icon={d.icon} accent={accent} size={44} />
                    <Button size="sm" icon={<ImageIcon size={13} />} onClick={() => setIcon(instance)}>
                      {t("inst.icon.choose")}
                    </Button>
                    {d.icon && (
                      <Tooltip content={t("inst.icon.reset")}>
                        <IconButton label={t("inst.icon.reset")} size="sm" onClick={() => resetIcon(instance)}>
                          <RotateCcw size={13} />
                        </IconButton>
                      </Tooltip>
                    )}
                  </div>
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
                <SettingRow title={t("isettings.auto_update")} description={t("isettings.auto_update.desc")}>
                  <Select<"default" | "on" | "off">
                    className="w-[220px]"
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
                <SettingRow title={t("isettings.notes")} stacked>
                  <Textarea
                    value={d.notes ?? ""}
                    placeholder={t("isettings.notes.placeholder")}
                    onChange={(e) => update({ notes: e.target.value || null }, 800)}
                  />
                </SettingRow>
              </SettingsCard>
              <VibeyClientSlot instance={instance} />
              <VersionCard instance={instance} />
              <SettingsCard title={t("optsync.card")}>
                <InstanceOptSync instance={instance} />
              </SettingsCard>
              <SettingsCard title={t("inst.shortcut")}>
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
            </div>

            <div className="flex flex-col gap-5">
              <SettingsCard title={t("isettings.java")}>
                <SettingRow title={t("isettings.java.path")} description={t("isettings.java.path.desc")} stacked>
                  <JavaPathField value={d.java.path} onChange={(path, delay) => java({ path }, delay)} />
                </SettingRow>
                <SettingRow
                  title={t("isettings.ram")}
                  description={
                    <>
                      {ramOverride
                        ? t("isettings.ram.custom")
                        : t("isettings.ram.global", { min: settings?.min_memory_mb ?? 0, max: settings?.max_memory_mb ?? 0 })}
                      {modCount !== null && (
                        <span className="mt-1 flex items-center gap-2 text-text">
                          {t("ram.recommend", { n: modCount, gb: recommendRam(modCount, sys?.total_memory_mb ?? 8192) / 1024 })}
                          {(d.java.max_memory_mb ?? settings?.max_memory_mb) !== recommendRam(modCount, sys?.total_memory_mb ?? 8192) && (
                            <button
                              className="text-[12.5px] font-semibold text-accent hover:underline"
                              onClick={() =>
                                java({ min_memory_mb: d.java.min_memory_mb ?? 1024, max_memory_mb: recommendRam(modCount, sys?.total_memory_mb ?? 8192) })
                              }
                            >
                              {t("ram.apply")}
                            </button>
                          )}
                        </span>
                      )}
                    </>
                  }
                >
                  <Switch
                    checked={ramOverride}
                    label={t("isettings.override")}
                    onChange={(on) =>
                      java(
                        on
                          ? { min_memory_mb: settings?.min_memory_mb ?? 512, max_memory_mb: settings?.max_memory_mb ?? 4096 }
                          : { min_memory_mb: null, max_memory_mb: null },
                      )
                    }
                  />
                </SettingRow>
                {ramOverride && (
                  <div className="border-t border-line px-4 py-4">
                    <MemoryField
                      min={d.java.min_memory_mb ?? 512}
                      max={d.java.max_memory_mb ?? 4096}
                      total={total}
                      onChange={(v, delay) => java({ min_memory_mb: v.min, max_memory_mb: v.max }, delay)}
                    />
                  </div>
                )}
                <SettingRow title={t("isettings.jvm")} description={t("isettings.jvm.desc")} stacked>
                  <div className="mb-2 w-[260px]">
                  <Select<"none" | "g1" | "zgc" | "low">
                    size="sm"
                    placeholder={t("jvm.presets")}
                    value={
                      !d.java.jvm_args
                        ? "none"
                        : ((Object.entries(JVM_PRESETS).find(([, v]) => v === d.java.jvm_args)?.[0] as "g1" | "zgc" | "low" | undefined) ?? null)
                    }
                    onChange={(v) => java({ jvm_args: v === "none" ? null : JVM_PRESETS[v] })}
                    options={(["none", "g1", "zgc", "low"] as const).map((v) => ({ value: v, label: t(`jvm.preset.${v}`) }))}
                  />
                  </div>
                  <Input
                    className="font-mono text-[12px]"
                    value={d.java.jvm_args ?? ""}
                    placeholder={settings?.jvm_args || "-XX:+UseG1GC"}
                    onChange={(e) => java({ jvm_args: e.target.value || null }, 700)}
                  />
                </SettingRow>
                <SettingRow title={t("isettings.env")} description={t("isettings.env.desc")} stacked>
                  <EnvEditor env={d.java.env} onChange={(env, delay) => java({ env }, delay)} />
                </SettingRow>
              </SettingsCard>

              <SettingsCard title={t("isettings.window")}>
                <SettingRow
                  title={t("isettings.window.override")}
                  description={
                    winOverride ? t("isettings.window.custom") : t("isettings.window.global", { w: settings?.game_width ?? 0, h: settings?.game_height ?? 0 })
                  }
                >
                  <Switch
                    checked={winOverride}
                    label={t("isettings.override")}
                    onChange={(on) =>
                      win(
                        on
                          ? { width: settings?.game_width ?? 1280, height: settings?.game_height ?? 720, fullscreen: settings?.fullscreen ?? false }
                          : { width: null, height: null, fullscreen: null },
                      )
                    }
                  />
                </SettingRow>
                {winOverride && (
                  <>
                    <SettingRow title={t("settings.resolution")}>
                      <div className="flex items-center gap-2">
                        <NumberInput
                          className="w-[110px]"
                          value={d.window.width}
                          min={320}
                          max={7680}
                          unit="px"
                          onChange={(w) => win({ width: w })}
                          aria-label="width"
                        />
                        <span className="text-dim">×</span>
                        <NumberInput
                          className="w-[110px]"
                          value={d.window.height}
                          min={240}
                          max={4320}
                          unit="px"
                          onChange={(h) => win({ height: h })}
                          aria-label="height"
                        />
                      </div>
                    </SettingRow>
                    <SettingRow title={t("settings.fullscreen")}>
                      <Switch checked={!!d.window.fullscreen} onChange={(v) => win({ fullscreen: v })} label={t("settings.fullscreen")} />
                    </SettingRow>
                  </>
                )}
              </SettingsCard>

              <SettingsCard title={t("isettings.danger")} danger>
                <SettingRow title={t("inst.repair")} description={t("isettings.repair.desc")}>
                  <Button icon={<Wrench size={14} />} disabled={running || phase === "busy"} onClick={() => repairInstance(instance)}>
                    {t("inst.repair")}
                  </Button>
                </SettingRow>
                <SettingRow title={t("isettings.delete")} description={t("isettings.delete.desc")}>
                  <Button
                    variant="danger"
                    icon={<Trash2 size={14} />}
                    disabled={running}
                    onClick={() => actions.remove(instance, () => nav({ to: "/instances" }))}
                  >
                    {t("common.delete")}
                  </Button>
                </SettingRow>
              </SettingsCard>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
