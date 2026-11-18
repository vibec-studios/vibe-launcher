// Einstellungen eines Servers: Server-Modell (automatisch gespeichert) und server.properties als Formular
// oder Rohtext. Änderungen an server.properties wirken beim nächsten Start.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, FolderOpen, ImageIcon, Info, RotateCcw, Trash2, Wrench } from "lucide-react";
import { api } from "@/lib/api";
import { queryClient, sqk, useServerStatus, useSystemInfo } from "@/lib/queries";
import type { Server, ServerPatch } from "@/lib/types";
import {
  Button,
  IconButton,
  Input,
  NumberInput,
  Segmented,
  Select,
  SettingRow,
  SettingsCard,
  Skeleton,
  Slider,
  Switch,
  Textarea,
  ErrorState,
  toast,
} from "@/components/ui";
import { JavaPathField, SaveIndicator, formatMb, useAutoSave } from "@/components/instance/forms";
import { AccentPicker } from "@/features/instances/NewInstanceDialog";
import { useT } from "@/i18n";
import { openServerFolder, removeServer, repairServer, resetServerIcon, setServerIcon, useServerTask } from "./actions";
import { ServerIcon, serverAccent } from "./parts";

const applyServer = (base: Server, p: ServerPatch): Server => ({ ...base, ...p }) as Server;
const DEFAULT_RAM = 2048;

// ------------------------------------------------------------------ Server-Modell

function ModelCards({ server }: { server: Server }) {
  const t = useT();
  const { data: sys } = useSystemInfo();
  const { draft: d, update, local, reset, state } = useAutoSave(server, applyServer, async (p: ServerPatch) => {
    const next = await api.serverUpdate(server.id, p);
    queryClient.setQueryData(sqk.server(server.id), next);
  });
  const total = sys?.total_memory_mb ?? 8192;
  const limit = Math.max(1024, Math.floor(total / 256) * 256);
  const ram = d.memory_mb ?? DEFAULT_RAM;

  return (
    <>
      <div className="pointer-events-none absolute bottom-4 right-8 z-10 rounded-ctl bg-overlay px-2 py-1 shadow-e2 empty:hidden">
        <SaveIndicator state={state} />
      </div>
      <SettingsCard title={t("srv.settings.general")}>
        <SettingRow title={t("srv.name")} stacked>
          <Input
            value={d.name}
            maxLength={64}
            invalid={!d.name.trim()}
            onChange={(e) => (e.target.value.trim() ? update({ name: e.target.value }, 600) : local({ name: e.target.value }))}
            onBlur={() => !d.name.trim() && reset()}
          />
        </SettingRow>
        <SettingRow title={t("srv.icon")} description={t("srv.icon.desc")}>
          <div className="flex items-center gap-3">
            <ServerIcon server={{ ...server, accent: d.accent }} size={44} />
            <Button size="sm" icon={<ImageIcon size={13} />} onClick={() => setServerIcon(server)}>
              {t("srv.icon.choose")}
            </Button>
            {server.icon && (
              <IconButton label={t("srv.icon.reset")} tip variant="ghost" size="sm" onClick={() => resetServerIcon(server)}>
                <RotateCcw size={13} />
              </IconButton>
            )}
          </div>
        </SettingRow>
        <SettingRow
          title={t("srv.accent")}
          stacked
          description={
            d.accent ? (
              <button className="flex items-center gap-1.5 text-[12px] text-dim hover:text-text" onClick={() => update({ accent: null })}>
                <RotateCcw size={11} />
                {t("isettings.accent.reset")}
              </button>
            ) : undefined
          }
        >
          <AccentPicker value={serverAccent(d)} onChange={(c) => update({ accent: c })} />
        </SettingRow>
        <SettingRow title={t("srv.port")} description={t("srv.port.desc")}>
          <NumberInput className="w-[130px]" value={d.port} min={1024} max={65535} onChange={(v) => v !== null && update({ port: v })} aria-label={t("srv.port")} />
        </SettingRow>
        <SettingRow title={t("srv.auto_start")} description={t("srv.auto_start.desc")}>
          <Switch checked={d.auto_start} onChange={(v) => update({ auto_start: v })} label={t("srv.auto_start")} />
        </SettingRow>
        <SettingRow title={t("srv.auto_restart")} description={t("srv.auto_restart.desc")}>
          <Switch checked={d.auto_restart} onChange={(v) => update({ auto_restart: v })} label={t("srv.auto_restart")} />
        </SettingRow>
      </SettingsCard>

      <SettingsCard title={t("srv.settings.java")}>
        <SettingRow title={t("srv.ram")} description={d.memory_mb === null ? t("srv.ram.default", { ram: formatMb(DEFAULT_RAM) }) : undefined} stacked>
          <div className="grid grid-cols-[minmax(0,1fr)_120px] items-center gap-4">
            <div className="flex flex-col gap-1">
              <Slider value={ram} min={512} max={limit} step={256} onChange={(v) => update({ memory_mb: v }, 400)} />
              <div className="flex justify-between text-[11px] tabular-nums text-dim">
                <span>{formatMb(512)}</span>
                <span className="text-muted">{formatMb(ram)}</span>
                <span>{formatMb(limit)}</span>
              </div>
            </div>
            <NumberInput value={ram} min={512} max={limit} unit="MB" onChange={(v) => v !== null && update({ memory_mb: v })} aria-label={t("srv.ram")} />
          </div>
          {ram > total * 0.6 && <p className="mt-2 text-[12px] text-warn">{t("form.ram.warn", { total: formatMb(total) })}</p>}
        </SettingRow>
        <SettingRow title={t("isettings.java.path")} description={t("srv.java.desc")} stacked>
          <JavaPathField value={d.java_path} onChange={(path, delay) => update({ java_path: path }, delay)} />
        </SettingRow>
        <SettingRow title={t("isettings.jvm")} description={t("isettings.jvm.desc")} stacked>
          <Input
            className="font-mono text-[12px]"
            value={d.jvm_args ?? ""}
            placeholder="-XX:+UseG1GC"
            onChange={(e) => update({ jvm_args: e.target.value || null }, 700)}
          />
        </SettingRow>
      </SettingsCard>
    </>
  );
}

// ------------------------------------------------------------------ server.properties

type Props = Record<string, string>;
const applyProps = (b: Props, p: Props): Props => ({ ...b, ...p });

function PropsForm({ server, values }: { server: Server; values: Props }) {
  const t = useT();
  const { draft: d, update, state } = useAutoSave(values, applyProps, async (p: Props) => {
    const next = await api.serverPropertiesSet(server.id, p);
    queryClient.setQueryData(sqk.properties(server.id), next);
  });
  const bool = (k: string, def = false) => (d[k] === undefined ? def : d[k] === "true");
  const set = (k: string, v: string | number | boolean, delay = 0) => update({ [k]: String(v) }, delay);
  const num = (k: string, def: number) => {
    const n = Number(d[k]);
    return Number.isFinite(n) && d[k] !== undefined && d[k] !== "" ? n : def;
  };
  const sw = (k: string, title: string, desc?: string, def = false) => (
    <SettingRow title={title} description={desc}>
      <Switch checked={bool(k, def)} onChange={(v) => set(k, v)} label={title} />
    </SettingRow>
  );
  const online = bool("online-mode", true);

  return (
    <>
      <div className="pointer-events-none absolute bottom-4 right-8 z-10 rounded-ctl bg-overlay px-2 py-1 shadow-e2 empty:hidden">
        <SaveIndicator state={state} />
      </div>
      <SettingRow title={t("srv.prop.motd")} description={t("srv.prop.motd.desc")} stacked>
        <Input value={d["motd"] ?? ""} maxLength={120} placeholder="A Minecraft Server" onChange={(e) => set("motd", e.target.value, 700)} />
      </SettingRow>
      <SettingRow title={t("srv.prop.gamemode")}>
        <Select
          className="w-[200px]"
          value={d["gamemode"] ?? "survival"}
          onChange={(v) => set("gamemode", v)}
          options={["survival", "creative", "adventure", "spectator"].map((v) => ({ value: v, label: t(`srv.gamemode.${v}`) }))}
        />
      </SettingRow>
      <SettingRow title={t("srv.prop.difficulty")}>
        <Select
          className="w-[200px]"
          value={d["difficulty"] ?? "easy"}
          onChange={(v) => set("difficulty", v)}
          options={["peaceful", "easy", "normal", "hard"].map((v) => ({ value: v, label: t(`srv.difficulty.${v}`) }))}
        />
      </SettingRow>
      <SettingRow title={t("srv.prop.max_players")}>
        <NumberInput className="w-[130px]" value={num("max-players", 20)} min={1} max={1000} onChange={(v) => v !== null && set("max-players", v)} aria-label={t("srv.prop.max_players")} />
      </SettingRow>
      <SettingRow title={t("srv.prop.view_distance")} description={t("srv.prop.view_distance.desc")}>
        <NumberInput
          className="w-[130px]"
          value={num("view-distance", 10)}
          min={2}
          max={32}
          unit={t("srv.chunks")}
          onChange={(v) => v !== null && set("view-distance", v)}
          aria-label={t("srv.prop.view_distance")}
        />
      </SettingRow>
      <SettingRow title={t("srv.prop.spawn_protection")} description={t("srv.prop.spawn_protection.desc")}>
        <NumberInput
          className="w-[130px]"
          value={num("spawn-protection", 16)}
          min={0}
          max={1000}
          onChange={(v) => v !== null && set("spawn-protection", v)}
          aria-label={t("srv.prop.spawn_protection")}
        />
      </SettingRow>
      {sw("pvp", t("srv.prop.pvp"), undefined, true)}
      {sw("hardcore", t("srv.prop.hardcore"), t("srv.prop.hardcore.desc"))}
      {sw("white-list", t("srv.prop.whitelist"), t("srv.prop.whitelist.desc"))}
      {sw("enable-command-block", t("srv.prop.command_blocks"))}
      <SettingRow title={t("srv.prop.online_mode")} description={t("srv.prop.online_mode.desc")}>
        <Switch checked={online} onChange={(v) => set("online-mode", v)} label={t("srv.prop.online_mode")} />
      </SettingRow>
      {!online && (
        <div className="mx-4 mb-3.5 flex items-start gap-3 rounded-card bg-warn/[.08] px-4 py-3 text-[13px] text-warn">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>{t("srv.prop.online_mode.warn")}</span>
        </div>
      )}
      <SettingRow title={t("srv.prop.seed")} description={t("srv.prop.seed.desc")} stacked>
        <Input className="font-mono text-[12px]" value={d["level-seed"] ?? ""} placeholder={t("srv.prop.seed.placeholder")} onChange={(e) => set("level-seed", e.target.value, 700)} />
      </SettingRow>
    </>
  );
}

function RawEditor({ server, onSaved }: { server: Server; onSaved: () => void }) {
  const t = useT();
  const raw = useQuery({ queryKey: sqk.propertiesRaw(server.id), queryFn: () => api.serverPropertiesRaw(server.id), staleTime: 0, placeholderData: undefined });
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setText(null), [raw.data]);
  const value = text ?? raw.data ?? "";
  const dirty = text !== null && text !== raw.data;

  const save = async () => {
    setBusy(true);
    try {
      await api.serverPropertiesRawSet(server.id, value);
      await Promise.all([raw.refetch(), queryClient.invalidateQueries({ queryKey: sqk.properties(server.id) })]);
      toast.success(t("srv.prop.raw.saved"));
      onSaved();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  if (raw.isError) return <ErrorState error={raw.error} onRetry={() => raw.refetch()} />;
  if (raw.isLoading) return <Skeleton className="m-4 h-[420px]" />;
  return (
    <div className="flex flex-col gap-3 px-4 py-4">
      <Textarea className="h-[440px] font-mono text-[12px] leading-5" value={value} onChange={(e) => setText(e.target.value)} />
      <div className="flex justify-end gap-2">
        <Button variant="subtle" disabled={!dirty || busy} onClick={() => setText(null)}>
          {t("srv.prop.raw.discard")}
        </Button>
        <Button variant="accent" disabled={!dirty} loading={busy} onClick={save}>
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}

function PropertiesCard({ server }: { server: Server }) {
  const t = useT();
  const st = useServerStatus(server.id);
  const [mode, setMode] = useState<"form" | "raw">("form");
  const props = useQuery({ queryKey: sqk.properties(server.id), queryFn: () => api.serverPropertiesGet(server.id), staleTime: 30_000 });
  const values = useMemo(() => (props.data ? Object.fromEntries(props.data) : null), [props.data]);
  const active = st?.state === "running" || st?.state === "starting";

  return (
    <SettingsCard
      title="server.properties"
      right={<Segmented value={mode} onChange={setMode} items={[{ value: "form", label: t("srv.prop.form") }, { value: "raw", label: t("srv.prop.raw") }]} />}
    >
      <div className={`flex items-center gap-2 border-b border-line px-4 py-2 text-[12px] ${active ? "text-warn" : "text-dim"}`}>
        <Info size={13} className="shrink-0" />
        {t("srv.prop.next_start")}
      </div>
      {mode === "raw" ? (
        <RawEditor server={server} onSaved={() => {}} />
      ) : props.isError && !values ? (
        <ErrorState error={props.error} onRetry={() => props.refetch()} />
      ) : !values ? (
        <div className="flex flex-col gap-3 px-4 py-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : (
        <PropsForm server={server} values={values} />
      )}
    </SettingsCard>
  );
}

// ------------------------------------------------------------------ Tab

export function ServerSettingsTab({ server }: { server: Server }) {
  const t = useT();
  const nav = useNavigate();
  const st = useServerStatus(server.id);
  const task = useServerTask(server.id);
  const active = !!st && st.state !== "stopped" && st.state !== "crashed";

  return (
    <div className="relative h-full">
      <div className="scroll h-full">
        <div className="grid w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-5 px-6 py-5">
          <div className="flex flex-col gap-5">
            <ModelCards server={server} />
            <SettingsCard title={t("isettings.danger")} danger>
              <SettingRow title={t("srv.repair")} description={t("srv.repair.desc")}>
                <Button icon={<Wrench size={14} />} disabled={active || !!task} onClick={() => repairServer(server)}>
                  {t("srv.repair")}
                </Button>
              </SettingRow>
              <SettingRow title={t("common.open_folder")} description={t("srv.folder.desc")}>
                <Button icon={<FolderOpen size={14} />} onClick={() => openServerFolder(server)}>
                  {t("common.open_folder")}
                </Button>
              </SettingRow>
              <SettingRow title={t("srv.delete")} description={t("srv.delete.desc")}>
                <Button variant="danger" icon={<Trash2 size={14} />} disabled={active} onClick={() => removeServer(server, () => nav({ to: "/servers" }))}>
                  {t("common.delete")}
                </Button>
              </SettingRow>
            </SettingsCard>
          </div>
          <div className="flex flex-col gap-5">
            <PropertiesCard server={server} />
          </div>
        </div>
      </div>
    </div>
  );
}
