// Aktionen auf lokalen Servern – gemeinsam für Liste, Kontextmenü, Detailseite und Dialoge.
import { create } from "zustand";
import { api } from "@/lib/api";
import { sqk, queryClient, useServerStore, useTaskStore, waitForTask } from "@/lib/queries";
import type { Instance, Server, ServerStatus, TaskInfo } from "@/lib/types";
import { confirm, toast } from "@/components/ui";
import { copyText } from "@/features/logs/logText";
import { t } from "@/i18n";

// ------------------------------------------------------------------ Globale Dialoge

interface ServerDialogState {
  newOpen: boolean;
  /** „Aus Instanz“-Modus mit vorausgewählter Instanz */
  fromInstance: string | null;
  /** EULA-Abfrage vor dem Start */
  eulaFor: Server | null;
  /** Fenster soll schließen, N Server laufen */
  quit: number | null;
}

export const useServerDialogs = create<ServerDialogState>(() => ({ newOpen: false, fromInstance: null, eulaFor: null, quit: null }));

/** „Neuer Server“ öffnen; mit Instanz-ID direkt im Modus „Aus Instanz“. */
export const openNewServer = (fromInstanceId?: string | null) => useServerDialogs.setState({ newOpen: true, fromInstance: fromInstanceId ?? null });

// ------------------------------------------------------------------ Hilfen

export const serverTaskKey = (id: string) => `server:${id}`;

/** Laufende Installations-/Backup-Aufgabe eines Servers (neueste). */
export function useServerTask(id: string): TaskInfo | undefined {
  const key = serverTaskKey(id);
  return useTaskStore((s) => {
    let best: TaskInfo | undefined;
    for (const k in s.tasks) {
      const task = s.tasks[k];
      if (task.instance_id === key && task.status === "running" && (!best || task.started_at > best.started_at)) best = task;
    }
    return best;
  });
}

/** Adresse für Freunde: Tunnel-Adresse, sonst localhost:port. */
export function serverAddress(s: Server, st: ServerStatus | undefined): string {
  if (s.connection !== "local" && st?.tunnel?.address) return st.tunnel.address;
  return `localhost:${s.port}`;
}

export const copyAddress = (addr: string) => copyText(addr);

// ------------------------------------------------------------------ Steuerung

export async function startServer(s: Server) {
  if (!s.eula) {
    useServerDialogs.setState({ eulaFor: s });
    return;
  }
  try {
    await api.serverStart(s.id);
  } catch (e) {
    toast.error(e, t("srv.start_failed"));
  }
}

export async function acceptEulaAndStart(s: Server) {
  try {
    const next = await api.serverAcceptEula(s.id);
    queryClient.setQueryData(sqk.server(s.id), next);
    await api.serverStart(s.id);
  } catch (e) {
    toast.error(e, t("srv.start_failed"));
  }
}

/** Mit einer passenden Instanz direkt auf den Server joinen (Quellinstanz bevorzugt). */
export async function joinServer(s: Server) {
  try {
    const list = queryClient.getQueryData<Instance[]>(["instances"]) ?? (await api.instancesList());
    const fits = (i: Instance) => i.mc_version === s.mc_version && (s.loader.kind === "vanilla" || i.loader.kind === s.loader.kind);
    const inst = list.find((i) => i.id === s.source_instance && fits(i)) ?? list.find((i) => fits(i) && i.loader.kind === s.loader.kind) ?? list.find(fits);
    if (!inst) {
      toast.error(t("srv.join.no_instance", { version: s.mc_version }), t("srv.join.failed"));
      return;
    }
    const addr = s.port === 25565 ? "localhost" : `localhost:${s.port}`;
    await api.instanceLaunch(inst.id, null, null, addr);
    toast.info(t("srv.join.started", { name: inst.name }), s.name);
  } catch (e) {
    toast.error(e, t("srv.join.failed"));
  }
}

export const stopServer = (s: Server) => api.serverStop(s.id).catch((e) => toast.error(e, t("srv.stop_failed")));
export const restartServer = (s: Server) => api.serverRestart(s.id).catch((e) => toast.error(e, t("srv.restart_failed")));

export async function killServer(s: Server) {
  const ok = await confirm({ title: t("srv.kill.title", { name: s.name }), text: t("srv.kill.text"), confirmLabel: t("srv.kill"), danger: true });
  if (ok) api.serverKill(s.id).catch((e) => toast.error(e, t("srv.stop_failed")));
}

export const openServerFolder = (s: Server, sub?: string | null) => api.serverOpenFolder(s.id, sub ?? null).catch((e) => toast.error(e));

export async function repairServer(s: Server) {
  try {
    const id = await api.serverInstall(s.id, true);
    toast.info(t("srv.repair.started"), s.name);
    waitForTask(id)
      .then(() => toast.success(t("srv.repair.done"), s.name))
      .catch(() => {});
  } catch (e) {
    toast.error(e, t("srv.repair.failed"));
  }
}

export async function removeServer(s: Server, after?: () => void) {
  const ok = await confirm({
    title: t("srv.delete.title", { name: s.name }),
    text: t("srv.delete.text"),
    confirmLabel: t("common.delete"),
    danger: true,
  });
  if (!ok) return;
  try {
    await api.serverDelete(s.id);
    useServerStore.getState().remove(s.id);
    toast.success(t("srv.deleted"), s.name);
    after?.();
  } catch (e) {
    toast.error(e, t("srv.delete_failed"));
  }
}

export async function pickPng(): Promise<string | null> {
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const r = await open({ multiple: false, directory: false, title: t("srv.icon.pick"), filters: [{ name: "PNG", extensions: ["png"] }] });
    return typeof r === "string" ? r : null;
  } catch (e) {
    toast.error(e);
    return null;
  }
}

export async function setServerIcon(s: Server) {
  const path = await pickPng();
  if (!path) return;
  api
    .serverSetIcon(s.id, path)
    .then((next) => queryClient.setQueryData(sqk.server(s.id), next))
    .catch((e) => toast.error(e, t("srv.icon.failed")));
}

export const resetServerIcon = (s: Server) =>
  api
    .serverSetIcon(s.id, null)
    .then((next) => queryClient.setQueryData(sqk.server(s.id), next))
    .catch((e) => toast.error(e));
