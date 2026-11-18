// Launcher-Selbstupdate: prüft beim Start und alle 30 min im eingestellten Kanal (Release/Dev).
// Ist ein Update da, erscheint in der Topbar „Update verfügbar“ – Klick zeigt Details,
// „Jetzt aktualisieren“ lädt und installiert es (Launcher startet danach neu).
import * as Popover from "@radix-ui/react-popover";
import { ArrowDownToLine } from "lucide-react";
import { useEffect } from "react";
import { create } from "zustand";
import { api, errorMessage } from "@/lib/api";
import { qk, queryClient, useTask } from "@/lib/queries";
import type { Settings, UpdateInfo } from "@/lib/types";
import { Button, Progress, toast } from "@/components/ui";
import { t, useT } from "@/i18n";

interface UpdateState {
  info: UpdateInfo | null;
  checking: boolean;
  lastChecked: number | null;
  error: string | null;
  taskId: string | null;
}

export const useUpdate = create<UpdateState>(() => ({ info: null, checking: false, lastChecked: null, error: null, taskId: null }));

/** Jetzt prüfen. `manual` zeigt auch „aktuell“/Fehler als Toast. */
export async function checkForUpdate(manual = false): Promise<UpdateInfo | null> {
  if (useUpdate.getState().checking) return useUpdate.getState().info;
  useUpdate.setState({ checking: true, error: null });
  try {
    const info = await api.updateCheck();
    useUpdate.setState({ info, checking: false, lastChecked: Date.now() });
    if (manual && !info) toast.success(t("update.none"));
    return info;
  } catch (e) {
    useUpdate.setState({ checking: false, lastChecked: Date.now(), error: errorMessage(e) });
    if (manual) toast.error(e, t("update.check_failed"));
    return null;
  }
}

export async function installUpdate() {
  try {
    const id = await api.updateInstall();
    useUpdate.setState({ taskId: id });
  } catch (e) {
    toast.error(e, t("update.install_failed"));
  }
}

/** Hintergrund-Prüfung; rendert nichts. */
export function UpdateChecker() {
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const enabled = () => (queryClient.getQueryData<Settings>(qk.settings)?.check_updates ?? true) && !import.meta.env.DEV;
    const first = setTimeout(() => enabled() && checkForUpdate(), 4000);
    timer = setInterval(() => enabled() && checkForUpdate(), 30 * 60_000);
    // Kanalwechsel -> sofort neu prüfen
    let lastChannel = queryClient.getQueryData<Settings>(qk.settings)?.update_channel;
    const un = queryClient.getQueryCache().subscribe((ev) => {
      if (ev.query.queryKey[0] !== "settings") return;
      const ch = (ev.query.state.data as Settings | undefined)?.update_channel;
      if (ch && lastChannel && ch !== lastChannel) {
        useUpdate.setState({ info: null });
        checkForUpdate();
      }
      if (ch) lastChannel = ch;
    });
    return () => {
      clearTimeout(first);
      if (timer) clearInterval(timer);
      un();
    };
  }, []);
  return null;
}

/** Knopf in der Topbar, nur sichtbar wenn ein Update bereitliegt (oder gerade installiert wird). */
export function UpdateButton() {
  const tt = useT();
  const info = useUpdate((s) => s.info);
  const taskId = useUpdate((s) => s.taskId);
  const task = useTask(taskId);
  if (!info) return null;
  const running = task?.status === "running";
  const failed = task?.status === "failed";
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button className="flex h-8 items-center gap-2 rounded-ctl bg-brand px-3 text-[13px] font-semibold text-[var(--ui-on-accent)] transition-[filter] duration-150 hover:brightness-110">
          <ArrowDownToLine size={15} />
          {running ? tt("update.installing_short") : tt("update.available_short")}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          collisionPadding={8}
          className="glass z-[60] w-[360px] overflow-hidden rounded-card bg-overlay shadow-e2 data-[state=open]:animate-[pop-in_.12s_var(--ease-snap)]"
        >
          <div className="border-b border-line px-4 py-3">
            <div className="text-[15px] font-semibold text-white">{tt("update.title", { version: info.version })}</div>
            <div className="mt-0.5 text-[12px] text-muted">
              {tt("update.current", { version: info.current_version })} · {info.channel === "dev" ? tt("update.channel.dev") : tt("update.channel.release")}
            </div>
          </div>
          {info.notes && <div className="selectable scroll max-h-[220px] whitespace-pre-wrap px-4 py-3 text-[13px] text-muted">{info.notes}</div>}
          <div className="flex flex-col gap-2 border-t border-line px-4 py-3">
            {task && (running || failed) && (
              <>
                {running && <Progress value={task.progress} />}
                <div className={failed ? "text-[12px] text-danger" : "text-[12px] text-muted"}>{failed ? task.error : task.message}</div>
              </>
            )}
            <Button variant="primary" loading={running} disabled={running} onClick={installUpdate}>
              {tt("update.install")}
            </Button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

