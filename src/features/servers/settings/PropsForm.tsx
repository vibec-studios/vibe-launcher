import { AlertTriangle } from "lucide-react";
import { api } from "@/lib/api";
import { queryClient, sqk } from "@/lib/queries";
import type { Server } from "@/lib/types";
import { Input, NumberInput, Select, SettingRow, Switch } from "@/components/ui";
import { SaveIndicator, useAutoSave } from "@/components/instance/forms";
import { useT } from "@/i18n";

// ------------------------------------------------------------------ server.properties

export type Props = Record<string, string>;
const applyProps = (b: Props, p: Props): Props => ({ ...b, ...p });

export function PropsForm({ server, values }: { server: Server; values: Props }) {
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
        <div className="w-[200px]">
          <Select
            value={d["gamemode"] ?? "survival"}
            onChange={(v) => set("gamemode", v)}
            options={["survival", "creative", "adventure", "spectator"].map((v) => ({ value: v, label: t(`srv.gamemode.${v}`) }))}
          />
        </div>
      </SettingRow>
      <SettingRow title={t("srv.prop.difficulty")}>
        <div className="w-[200px]">
          <Select
            value={d["difficulty"] ?? "easy"}
            onChange={(v) => set("difficulty", v)}
            options={["peaceful", "easy", "normal", "hard"].map((v) => ({ value: v, label: t(`srv.difficulty.${v}`) }))}
          />
        </div>
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
