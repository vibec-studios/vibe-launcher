// Inhalte der Tabs im Popup „Instanz-Einstellungen“. Alle Optionen der früheren Einstellungsseite sind hier
// zugeordnet: Allgemein (Name, Icon, Farbe, Gruppe, Auto-Update, Notizen, Verknüpfung), Version & Loader,
// Client (Client-Packs), Java & Speicher, Fenster & Start (Fenster, Start-Befehle, Wrapper, Spieloptionen),
// Vibe (Vibey Client, Cosmetics, Relay), Erweitert (Umgebungsvariablen, Export, Duplizieren, Ordner,
// Reparieren, Löschen).
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Copy, FolderOpen, ImageIcon, Plus, RotateCcw, Shirt, Trash2, Upload, Wrench, X } from "lucide-react";
import { api } from "@/lib/api";
import { qk, useInstances, useSettings, useSystemInfo } from "@/lib/queries";
import type { Instance, InstancePatch, JavaOptions, LaunchHooks, WindowOptions } from "@/lib/types";
import { instanceAccent, loaderNames } from "@/lib/format";
import { Button, IconButton, Input, NumberInput, Select, SettingRow, SettingsCard, Switch, Textarea, Tooltip, confirm, toast } from "@/components/ui";
import { InstanceIcon } from "@/components/instance/InstanceIcon";
import { VersionPicker, type VersionValue } from "@/components/instance/VersionPicker";
import { JavaPathField, MemoryField } from "@/components/instance/forms";
import { createShortcut, installInstance, openExport, openFolder, repairInstance, resetIcon, setIcon, useInstanceActions } from "@/components/instance/actions";
import { useRunPhase } from "@/components/instance/status";
import { openSettings } from "@/features/settings/store";
import { useVibe } from "@/lib/vibe";
import { useT } from "@/i18n";
import { useSimple } from "@/lib/mode";
import { AccentPicker, GroupInput } from "../NewInstanceDialog";
import { ClientPacks, useClientPacks } from "./ClientPacks";
import { closeInstanceSettings } from "./store";
import { ImportSettingsRow } from "@/features/import/SettingsOffer";
import { GpuRow, SimplePerfCard } from "@/features/perf/PerfControls";

export interface TabProps {
  instance: Instance;
  d: Instance;
  update: (p: InstancePatch, delay?: number) => void;
  local: (p: InstancePatch) => void;
  reset: () => void;
}

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

const NO_HOOKS: LaunchHooks = { pre_launch: null, post_exit: null, wrapper: null };

// ------------------------------------------------------------------ Allgemein

/** Simple-Modus: nur Name, Icon und Löschen (RAM, Java usw. stellt der Launcher selbst ein). */
function SimpleGeneralTab({ instance, d, update, local, reset }: TabProps) {
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
        <SettingRow title={t("inst.accent")} stacked>
          <AccentPicker value={accent} onChange={(c) => update({ accent: c })} />
        </SettingRow>
      </SettingsCard>
      <SimplePerfCard d={d} update={update} />
      <p className="px-1 text-[12.5px] text-dim">{t("simple.isd.auto")}</p>
      <ImportSettingsRow instance={instance} />
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

export function GeneralTab(props: TabProps) {
  return useSimple() ? <SimpleGeneralTab {...props} /> : <ExpertGeneralTab {...props} />;
}

function ExpertGeneralTab({ instance, d, update, local, reset }: TabProps) {
  const t = useT();
  const { data: settings } = useSettings();
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
        <SettingRow title={t("isettings.notes")} stacked>
          <Textarea value={d.notes ?? ""} placeholder={t("isettings.notes.placeholder")} onChange={(e) => update({ notes: e.target.value || null }, 800)} />
        </SettingRow>
      </SettingsCard>

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

      <ImportSettingsRow instance={instance} />

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
    </>
  );
}

// ------------------------------------------------------------------ Version & Loader

export function VersionTab({ instance: i }: TabProps) {
  const t = useT();
  const { phase } = useRunPhase(i.id);
  const [editing, setEditing] = useState(false);
  const [ver, setVer] = useState<VersionValue>({ mc: i.mc_version, loader: i.loader.kind, loaderVersion: i.loader.version });
  const [busy, setBusy] = useState(false);
  const packs = useClientPacks(i);
  const installedPacks = (packs.data?.packs ?? []).filter((p) => p.installed);
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
    <SettingsCard title={t("isd.section.installed")}>
      {!editing ? (
        // „Ändern“ gehört zur Zeile, nicht in die Abschnitts-Überschrift
        <SettingRow title={`Minecraft ${i.mc_version}`} description={i.loader.kind === "vanilla" ? "Vanilla" : `${loaderNames[i.loader.kind]} ${i.loader.version ?? ""}`}>
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
        </SettingRow>
      ) : (
        <div className="flex flex-col gap-5 px-4 py-5">
          <div className="flex items-start gap-3 border border-warn/30 bg-warn/[.06] px-4 py-3 text-[13px] text-warn">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>
              {t("isettings.version.warn")}
              {installedPacks.length > 0 && ` ${t("isd.version.packs", { list: installedPacks.map((p) => t(`cp.${p.id}.name`)).join(", ") })}`}
            </span>
          </div>
          <VersionPicker value={ver} onChange={setVer} listHeight={300} />
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

// ------------------------------------------------------------------ Client

export function ClientTab({ instance }: TabProps) {
  const t = useT();
  return (
    <>
      <p className="px-1 text-[13px] text-muted">{t("cp.lead")}</p>
      <ClientPacks instance={instance} />
    </>
  );
}

// ------------------------------------------------------------------ Java & Speicher

export function JavaTab({ instance, d, update }: TabProps) {
  const t = useT();
  const { data: settings } = useSettings();
  const { data: sys } = useSystemInfo();
  const java = (p: Partial<JavaOptions>, delay = 0) => update({ java: { ...d.java, ...p } }, delay);
  const ramOverride = d.java.max_memory_mb !== null || d.java.min_memory_mb !== null;
  const modsQ = useQuery({ queryKey: qk.content(instance.id, "mod"), queryFn: () => api.contentList(instance.id, "mod"), staleTime: 60_000 });
  const modCount = modsQ.data?.filter((m) => m.enabled).length ?? null;
  const total = sys?.total_memory_mb ?? 8192;
  return (
    <>
      <SettingsCard title={t("isd.section.java")}>
        <SettingRow title={t("isettings.java.path")} description={t("isettings.java.path.desc")} stacked>
          <JavaPathField value={d.java.path} onChange={(path, delay) => java({ path }, delay)} />
        </SettingRow>
      </SettingsCard>

      <SettingsCard title={t("isd.section.performance")}>
        <SettingRow
          title={t("isettings.ram")}
          description={
            <>
              {ramOverride ? t("isettings.ram.custom") : t("isettings.ram.global", { min: settings?.min_memory_mb ?? 0, max: settings?.max_memory_mb ?? 0 })}
              {modCount !== null && (
                <span className="mt-1 flex items-center gap-2 text-text">
                  {t("ram.recommend", { n: modCount, gb: recommendRam(modCount, total) / 1024 })}
                  {(d.java.max_memory_mb ?? settings?.max_memory_mb) !== recommendRam(modCount, total) && (
                    <button
                      className="text-[12.5px] font-semibold text-accent hover:underline"
                      onClick={() => java({ min_memory_mb: d.java.min_memory_mb ?? 1024, max_memory_mb: recommendRam(modCount, total) })}
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
              java(on ? { min_memory_mb: settings?.min_memory_mb ?? 512, max_memory_mb: settings?.max_memory_mb ?? 4096 } : { min_memory_mb: null, max_memory_mb: null })
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
        <GpuRow />
        <SettingRow title={t("isettings.jvm")} description={t("isettings.jvm.desc")} stacked>
          <div className="mb-2 w-[260px]">
            <Select<"none" | "g1" | "zgc" | "low">
              size="sm"
              placeholder={t("jvm.presets")}
              value={
                !d.java.jvm_args ? "none" : ((Object.entries(JVM_PRESETS).find(([, v]) => v === d.java.jvm_args)?.[0] as "g1" | "zgc" | "low" | undefined) ?? null)
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
      </SettingsCard>
    </>
  );
}

// ------------------------------------------------------------------ Fenster & Start

export function LaunchTab({ d, update }: TabProps) {
  const t = useT();
  const { data: settings } = useSettings();
  const { data: sys } = useSystemInfo();
  const win = (p: Partial<WindowOptions>, delay = 0) => update({ window: { ...d.window, ...p } }, delay);
  const hooks = d.hooks ?? NO_HOOKS;
  const hook = (p: Partial<LaunchHooks>, delay = 700) => update({ hooks: { ...hooks, ...p } }, delay);
  const winOverride = d.window.width !== null || d.window.height !== null || d.window.fullscreen !== null;
  const win32 = (sys?.os ?? "").toLowerCase().startsWith("win");
  const vars = ["INST_ID", "INST_NAME", "INST_DIR", "INST_MC_DIR", "INST_MC_VER", "INST_LOADER", "INST_JAVA"].map((v) => (win32 ? `%${v}%` : `$${v}`)).join(", ");
  return (
    <>
      <SettingsCard title={t("isettings.window")}>
        <SettingRow
          title={t("isettings.window.override")}
          description={winOverride ? t("isettings.window.custom") : t("isettings.window.global", { w: settings?.game_width ?? 0, h: settings?.game_height ?? 0 })}
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
                <NumberInput className="w-[110px]" value={d.window.width} min={320} max={7680} unit="px" onChange={(w) => win({ width: w })} aria-label="width" />
                <span className="text-dim">×</span>
                <NumberInput className="w-[110px]" value={d.window.height} min={240} max={4320} unit="px" onChange={(h) => win({ height: h })} aria-label="height" />
              </div>
            </SettingRow>
            <SettingRow title={t("settings.fullscreen")}>
              <Switch checked={!!d.window.fullscreen} onChange={(v) => win({ fullscreen: v })} label={t("settings.fullscreen")} />
            </SettingRow>
          </>
        )}
      </SettingsCard>

      <SettingsCard title={t("isd.hooks")}>
        <SettingRow title={t("isd.hooks.pre")} description={t("isd.hooks.pre.desc")} stacked>
          <Input className="font-mono text-[12px]" value={hooks.pre_launch ?? ""} placeholder={win32 ? "backup.bat" : "./backup.sh"} onChange={(e) => hook({ pre_launch: e.target.value || null })} />
        </SettingRow>
        <SettingRow title={t("isd.hooks.post")} description={t("isd.hooks.post.desc")} stacked>
          <Input className="font-mono text-[12px]" value={hooks.post_exit ?? ""} onChange={(e) => hook({ post_exit: e.target.value || null })} />
        </SettingRow>
        <SettingRow
          title={t("isd.hooks.wrapper")}
          description={t("isd.hooks.wrapper.desc", { global: settings?.wrapper_command || t("isd.hooks.wrapper.none") })}
          stacked
        >
          <Input
            className="font-mono text-[12px]"
            value={hooks.wrapper ?? ""}
            placeholder={settings?.wrapper_command || "gamemoderun"}
            onChange={(e) => hook({ wrapper: e.target.value.trim() ? e.target.value : null })}
          />
        </SettingRow>
        <div className="border-t border-line px-4 py-2.5 text-[12px] text-dim">
          <span className="font-mono">{t("isd.hooks.vars", { vars })}</span>
        </div>
      </SettingsCard>
    </>
  );
}

// ------------------------------------------------------------------ Vibe

export function VibeTab({ instance }: TabProps) {
  const t = useT();
  const nav = useNavigate();
  const vibe = useVibe();
  const packs = useClientPacks(instance);
  const vibey = packs.data?.packs.find((p) => p.id === "vibey");
  return (
    <>
      <SettingsCard title="Vibey Client">
        <div className="p-3">
          <ClientPacks instance={instance} only={["vibey"]} compact />
        </div>
      </SettingsCard>
      <SettingsCard title={t("isd.section.vibe_services")}>
        <SettingRow
          title={t("isd.vibe.cosmetics")}
          description={
            <>
              {t("isd.vibe.cosmetics.desc")}
              {!vibey?.installed && <span className="mt-1 block text-warn">{t("isd.vibe.cosmetics.needs_client")}</span>}
            </>
          }
        >
          <Button
            size="sm"
            icon={<Shirt size={13} />}
            onClick={() => {
              closeInstanceSettings();
              nav({ to: "/cosmetics" });
            }}
          >
            {t("isd.vibe.wardrobe")}
          </Button>
        </SettingRow>
        <SettingRow
          title={t("isd.vibe.relay")}
          description={
            <>
              {t("isd.vibe.relay.desc")}{" "}
              <span className={vibe.hosting ? "text-ok" : "text-warn"}>{vibe.hosting ? t("isd.vibe.relay.on") : t("isd.vibe.relay.off")}</span>
            </>
          }
        >
          <Button
            size="sm"
            onClick={() => {
              closeInstanceSettings();
              openSettings("vibe");
            }}
          >
            {t("isd.vibe.settings")}
          </Button>
        </SettingRow>
      </SettingsCard>
    </>
  );
}

// ------------------------------------------------------------------ Erweitert

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
  return (
    <>
      <SettingsCard title={t("isd.section.process")}>
        <SettingRow title={t("isettings.env")} description={t("isettings.env.desc")} stacked>
          <EnvEditor env={d.java.env} onChange={(env, delay) => update({ java: { ...d.java, env } }, delay)} />
        </SettingRow>
      </SettingsCard>

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
