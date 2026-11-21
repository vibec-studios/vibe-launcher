import { ImageIcon, RotateCcw } from "lucide-react";
import { api } from "@/lib/api";
import { queryClient, sqk, useSystemInfo } from "@/lib/queries";
import type { Server, ServerPatch } from "@/lib/types";
import { Button, IconButton, Input, NumberInput, SettingRow, SettingsCard, Slider, Switch } from "@/components/ui";
import { JavaPathField, SaveIndicator, formatMb, useAutoSave } from "@/components/instance/forms";
import { AccentPicker } from "@/features/instances/NewInstanceDialog";
import { useT } from "@/i18n";
import { resetServerIcon, setServerIcon } from "../actions";
import { ServerIcon, serverAccent } from "../parts";

const applyServer = (base: Server, p: ServerPatch): Server => ({ ...base, ...p }) as Server;
const DEFAULT_RAM = 2048;

// ------------------------------------------------------------------ Server-Modell

export function ModelCards({ server }: { server: Server }) {
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
