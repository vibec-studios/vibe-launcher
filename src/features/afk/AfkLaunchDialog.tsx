import { useEffect, useState } from "react";
import { create } from "zustand";
import { useQuery } from "@tanstack/react-query";
import { Check, Globe, Home, Minus, MoonStar, Server } from "lucide-react";
import { api } from "@/lib/api";
import type { Instance } from "@/lib/types";
import { Button, Dialog, Input, Select, Tooltip, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { supportsQuickPlay, useInstanceActions } from "@/components/instance/actions";
import { afkApi } from "./api";
import { AfkRulesNote } from "./AfkSettingsCard";
import type { AfkSupport, AfkVia } from "./types";

export const useAfkLaunch = create<{ inst: Instance | null }>(() => ({ inst: null }));
export const openAfkLaunch = (inst: Instance) => useAfkLaunch.setState({ inst });

type Target = "menu" | "server" | "world";

function TargetTile({ icon, title, text, on, onClick }: { icon: React.ReactNode; title: string; text: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "flex min-w-0 items-start gap-2.5 rounded-card border p-3 text-left transition-colors",
        on ? "border-accent/70 bg-accent/10" : "border-transparent bg-surface hover:bg-surface2",
      )}
    >
      <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-ctl", on ? "bg-accent text-[var(--on-accent)]" : "bg-surface2 text-accent")}>{icon}</span>
      <span className="min-w-0 leading-snug">
        <span className="block text-[13.5px] font-semibold text-text">{title}</span>
        <span className="block text-[12px] text-muted">{text}</span>
      </span>
    </button>
  );
}

function SupportRow({ label, via, yes }: { label: string; via?: AfkVia; yes?: boolean }) {
  const t = useT();
  const ok = via ? via !== "none" : !!yes;
  return (
    <li className="flex items-center gap-2.5 py-1 text-[13px]">
      <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-dot", ok ? "bg-ok/15 text-ok" : "bg-surface3 text-dim")}>{ok ? <Check size={12} strokeWidth={3} /> : <Minus size={12} />}</span>
      <span className="flex-1 text-text">{label}</span>
      <span className="text-[12px] text-muted">{via ? t(`afk.via.${via}`) : t(ok ? "afk.via.yes" : "afk.via.none")}</span>
    </li>
  );
}

export function SupportList({ s }: { s: AfkSupport }) {
  const t = useT();
  return (
    <div data-testid="afk-support">
      <ul className="divide-y divide-line">
        <SupportRow label={t("afk.sup.window")} via={s.window} />
        <SupportRow label={t("afk.sup.fps")} via={s.fps} />
        <SupportRow label={t("afk.sup.sound")} via={s.sound} />
        <SupportRow label={t("afk.sup.chat_read")} via={s.chat_read} />
        <SupportRow label={t("afk.sup.chat_send")} yes={s.chat_send} />
        <SupportRow label={t("afk.sup.reconnect")} yes={s.reconnect} />
      </ul>
      <p className="mt-2 text-[12px] leading-relaxed text-muted">
        {s.agent === "ready" ? t("afk.agent.ready", { v: s.agent_version ?? "" }) : t("afk.agent.download")}{" "}
        {s.window === "system" && `${t("afk.agent.unsupported")} `}
        <Tooltip content={<span className="block max-w-[300px]">{t("afk.helper_explain")}</span>}>
          <span className="cursor-help underline decoration-dotted underline-offset-2">{t("afk.helper_term")}?</span>
        </Tooltip>
      </p>
    </div>
  );
}

function Body({ inst, onDone }: { inst: Instance; onDone: () => void }) {
  const t = useT();
  const { launch } = useInstanceActions();
  const [target, setTarget] = useState<Target>("menu");
  const [server, setServer] = useState("");
  const [world, setWorld] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const support = useQuery({ queryKey: ["afk-support", inst.id], queryFn: () => afkApi.support(inst.id), staleTime: 30_000 });
  const servers = useQuery({ queryKey: ["afk-servers", inst.id], queryFn: () => api.instanceServersList(inst.id), enabled: target === "server", staleTime: 30_000 });
  const worlds = useQuery({ queryKey: ["afk-worlds", inst.id], queryFn: () => api.worldsList(inst.id), enabled: target === "world", staleTime: 30_000 });
  const quick = supportsQuickPlay(inst.mc_version);
  useEffect(() => {
    if (!world && worlds.data?.length) setWorld(worlds.data[0].folder);
  }, [worlds.data, world]);
  const ready = target === "menu" || (target === "server" && server.trim().length > 2) || (target === "world" && !!world && quick);
  const start = async () => {
    setBusy(true);
    await launch(inst, target === "world" ? world : null, target === "server" ? server.trim() : null, { afk: true });
    setBusy(false);
    onDone();
  };
  return (
    <div className="flex flex-col gap-4" data-testid="afk-launch">
      <p className="text-[13.5px] leading-relaxed text-muted">{t("afk.dialog.text", { name: inst.name })}</p>
      <div>
        <div className="mb-2 text-[12.5px] font-semibold text-muted">{t("afk.dialog.target")}</div>
        <div className="grid grid-cols-3 gap-2 max-[640px]:grid-cols-1">
          <TargetTile icon={<Home size={16} />} title={t("afk.target.menu")} text={t("afk.target.menu.text")} on={target === "menu"} onClick={() => setTarget("menu")} />
          <TargetTile icon={<Server size={16} />} title={t("afk.target.server")} text={t("afk.target.server.text")} on={target === "server"} onClick={() => setTarget("server")} />
          <TargetTile icon={<Globe size={16} />} title={t("afk.target.world")} text={t("afk.target.world.text")} on={target === "world"} onClick={() => setTarget("world")} />
        </div>
      </div>
      {target === "server" && (
        <div className="flex flex-col gap-2">
          <Input autoFocus value={server} placeholder={t("afk.dialog.server_ph")} onChange={(e) => setServer(e.target.value)} aria-label={t("afk.target.server")} />
          {!!servers.data?.length && (
            <div className="flex flex-wrap gap-1.5">
              <span className="w-full text-[12px] text-dim">{t("afk.dialog.saved_servers")}</span>
              {servers.data.filter((s) => !s.hidden).slice(0, 8).map((s) => (
                <button
                  key={s.ip}
                  onClick={() => setServer(s.ip)}
                  className={cn("h-7 rounded-pill px-3 text-[12.5px] transition-colors", server === s.ip ? "bg-accent text-[var(--on-accent)]" : "bg-surface2 text-text hover:bg-surface3")}
                >
                  {s.name || s.ip}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {target === "world" &&
        (!quick ? (
          <p className="text-[12.5px] text-warn">{t("afk.dialog.world_old")}</p>
        ) : worlds.data && worlds.data.length === 0 ? (
          <p className="text-[12.5px] text-muted">{t("afk.dialog.no_worlds")}</p>
        ) : (
          <Select<string> value={world ?? ""} onChange={setWorld} options={(worlds.data ?? []).map((w) => ({ value: w.folder, label: w.name || w.folder }))} />
        ))}
      <div className="rounded-card bg-surface px-4 py-3">
        <div className="mb-1 text-[12.5px] font-semibold text-muted">{t("afk.dialog.support")}</div>
        {support.data ? <SupportList s={support.data} /> : <div className="h-28 animate-pulse rounded-ctl bg-surface2" />}
      </div>
      <AfkRulesNote />
      <div className="flex justify-end gap-2 pt-1">
        <Button onClick={onDone}>{t("common.cancel")}</Button>
        <Button variant="accent" icon={<MoonStar size={15} />} disabled={!ready || support.data?.supported === false} loading={busy} onClick={start}>
          {t("afk.dialog.start")}
        </Button>
      </div>
    </div>
  );
}

export function AfkLaunchHost() {
  const t = useT();
  const inst = useAfkLaunch((s) => s.inst);
  const close = () => useAfkLaunch.setState({ inst: null });
  return (
    <Dialog open={!!inst} onOpenChange={(o) => !o && close()} title={t("afk.dialog.title")} size="lg">
      {inst && <Body inst={inst} onDone={close} />}
    </Dialog>
  );
}
