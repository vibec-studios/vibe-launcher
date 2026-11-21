import { ChevronDown, Monitor, MoonStar, PanelsTopLeft } from "lucide-react";
import { DropdownItem, DropdownMenu, DropdownSeparator, cn, toast } from "@/components/ui";
import { useT, t as tt } from "@/i18n";
import { useSettings } from "@/lib/queries";
import { api } from "@/lib/api";
import type { GameState, Instance } from "@/lib/types";
import { afkApi } from "./api";
import { afkSettings } from "./AfkSettingsCard";
import { openAfkLaunch } from "./AfkLaunchDialog";
import { isBackground, useAfkSessions, useAfkStore } from "./store";

export function useAfkEnabled(): boolean {
  const { data } = useSettings();
  return afkSettings(data).enabled;
}

export async function afkToggle(runId: string, background: boolean) {
  try {
    const s = await afkApi.setBackground(runId, background);
    useAfkStore.getState().setSession(s);
  } catch (e) {
    toast.error(e, tt("afk.toggle_failed"));
  }
}

export const openAfkView = (runId: string) => api.consoleOpen(runId).catch((e) => toast.error(e));

export function AfkLaunchItem({ instance }: { instance: Instance }) {
  const t = useT();
  if (instance.bedrock) return null;
  return (
    <DropdownItem icon={<MoonStar size={14} />} onSelect={() => openAfkLaunch(instance)}>
      {t("afk.launch")}
    </DropdownItem>
  );
}

export function AfkSessionItems({ instance, runs }: { instance: Instance; runs: GameState[] }) {
  const t = useT();
  const enabled = useAfkEnabled();
  const sessions = useAfkSessions();
  if (!enabled || instance.bedrock) return null;
  const running = runs.filter((r) => r.state === "running");
  const many = running.length > 1;
  return (
    <>
      <DropdownSeparator />
      {running.map((r) => {
        const bg = isBackground(sessions[r.run_id]);
        const suffix = many ? ` · #${r.slot}` : "";
        return (
          <DropdownItem key={r.run_id} icon={bg ? <Monitor size={14} /> : <MoonStar size={14} />} onSelect={() => afkToggle(r.run_id, !bg)}>
            {(bg ? t("afk.to_fg") : t("afk.to_bg")) + suffix}
          </DropdownItem>
        );
      })}
      {running.some((r) => sessions[r.run_id]) && (
        <DropdownItem icon={<PanelsTopLeft size={14} />} onSelect={() => openAfkView(running.find((r) => sessions[r.run_id])!.run_id)}>
          {t("afk.view")}
        </DropdownItem>
      )}
      <AfkLaunchItem instance={instance} />
    </>
  );
}

export function AfkSplitTrigger({ instance, className }: { instance: Instance; className?: string }) {
  const t = useT();
  return (
    <DropdownMenu
      align="end"
      trigger={
        <button
          aria-label={t("afk.launch")}
          title={t("afk.launch")}
          data-testid="afk-split"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          className={cn("grid w-9 shrink-0 place-items-center rounded-r-ctl border-l border-black/15 bg-accent text-[var(--on-accent)] transition-[filter] hover:brightness-110", className)}
        >
          <ChevronDown size={15} />
        </button>
      }
    >
      <AfkLaunchItem instance={instance} />
    </DropdownMenu>
  );
}
