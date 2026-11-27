// Aktionen auf Instanzen – gemeinsam für Karten-Kontextmenü, Mehr-Menü, Startseite und Instanzseite.
import { useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { create } from "zustand";
import { api, errorMessage } from "@/lib/api";
import { qk, queryClient, waitForTask } from "@/lib/queries";
import type { Account, Instance, Settings } from "@/lib/types";
import { confirm, toast } from "@/components/ui";
import { t } from "@/i18n";
import { chooseLaunchAccount } from "./AccountConflict";

export const FOLDERS = ["", "mods", "config", "saves", "resourcepacks", "shaderpacks", "screenshots", "logs"] as const;

// ------------------------------------------------------------------ Dialoge, die aus Menüs geöffnet werden

/** Ziel im geführten „Neues Spiel“-Assistenten (Simple-Modus), siehe features/instances/simple/goals.tsx */
export type NewGameGoal = "vanilla" | "fps" | "mods" | "friends";

interface DialogState {
  exportFor: Instance | null;
  groupFor: Instance | null;
  iconFor: Instance | null;
  newOpen: boolean;
  /** Simple-Modus: Ziel schon gewählt (Kachel auf der Startseite/im Onboarding) */
  newGoal: NewGameGoal | null;
  /** Simple-Modus: „Erweitert“ gewählt -> der volle Dialog statt des Assistenten */
  newExpert: boolean;
}
export const useInstanceDialogs = create<DialogState>(() => ({ exportFor: null, groupFor: null, iconFor: null, newOpen: false, newGoal: null, newExpert: false }));
let newDialogTrigger: HTMLElement | null = null;

export function openNewGame(goal: NewGameGoal | null) {
  if (!useInstanceDialogs.getState().newOpen) {
    const active = document.activeElement;
    newDialogTrigger = active instanceof HTMLElement ? active : null;
  }
  useInstanceDialogs.setState({ newOpen: true, newGoal: goal, newExpert: false });
}

/** „Neue Instanz“ – im Simple-Modus der geführte Assistent, sonst der volle Dialog. */
export const openNewInstance = () => openNewGame(null);

export function restoreNewInstanceFocus(event: Event) {
  if (useInstanceDialogs.getState().newOpen) return;
  event.preventDefault();
  newDialogTrigger?.focus({ preventScroll: true });
  newDialogTrigger = null;
}
/** Vom Assistenten in den vollen Dialog wechseln. */
export const openExpertNewInstance = () => useInstanceDialogs.setState({ newOpen: true, newGoal: null, newExpert: true });
export const openExport = (i: Instance) => useInstanceDialogs.setState({ exportFor: i });
export const openGroupPrompt = (i: Instance) => useInstanceDialogs.setState({ groupFor: i });
export const openIconPicker = (i: Instance) => useInstanceDialogs.setState({ iconFor: i });

// ------------------------------------------------------------------ Einzelaktionen

export async function pickImage(): Promise<string | null> {
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const r = await open({
      multiple: false,
      directory: false,
      title: t("inst.icon.pick"),
      filters: [{ name: t("inst.icon.images"), extensions: ["png", "jpg", "jpeg", "gif", "webp"] }],
    });
    return typeof r === "string" ? r : null;
  } catch (e) {
    toast.error(e);
    return null;
  }
}

export async function setIcon(i: Instance) {
  const path = await pickImage();
  if (!path) return;
  api.instanceSetIcon(i.id, path).catch((e) => toast.error(e, t("inst.icon.failed")));
}
export const setInstanceIcon = (i: Instance, icon: string | null) => api.instanceUpdate(i.id, { icon }).catch((e) => toast.error(e, t("inst.icon.failed")));
export const resetIcon = (i: Instance) => api.instanceSetIcon(i.id, null).catch((e) => toast.error(e));
export const setAccent = (i: Instance, accent: string | null) => api.instanceUpdate(i.id, { accent }).catch((e) => toast.error(e));
export const setGroup = (i: Instance, group: string | null) => api.instanceUpdate(i.id, { group: group?.trim() || null }).catch((e) => toast.error(e));
export const openFolder = (i: Instance, sub?: string) => api.instanceOpenFolder(i.id, sub || null).catch((e) => toast.error(e));
export const killInstance = (i: Instance, runId?: string | null) => api.instanceKill(i.id, runId).catch((e) => toast.error(e, t("inst.kill_failed")));
export const openConsole = (runId?: string | null) => api.consoleOpen(runId).catch((e) => toast.error(e));

async function launchAccount(i: Instance): Promise<{ accountId: string | null } | null> {
  if (i.bedrock) return { accountId: null };
  const accounts = queryClient.getQueryData<Account[]>(qk.accounts) ?? (await api.accountsList().catch(() => [] as Account[]));
  return chooseLaunchAccount(accounts, queryClient.getQueryData<Instance[]>(qk.instances), null);
}

export async function repairInstance(i: Instance) {
  try {
    const id = await api.instanceInstall(i.id, true);
    toast.info(t("inst.repair.started"), i.name);
    waitForTask(id)
      .then(() => toast.success(t("inst.repair.done"), i.name))
      .catch(() => {});
  } catch (e) {
    toast.error(e, t("inst.repair.failed"));
  }
}

/** Neue Instanz nach dem Anlegen installieren (Fehler landen als Toast über das TaskDock). */
export function installInstance(id: string) {
  api.instanceInstall(id, false).catch((e) => toast.error(e, t("inst.install_failed")));
}

export function useInstanceActions() {
  const nav = useNavigate();
  return useMemo(() => makeActions(nav), [nav]);
}

function makeActions(nav: ReturnType<typeof useNavigate>) {
  const open = (i: Instance, tab?: "content" | "worlds" | "logs" | "settings") =>
    nav({ to: "/instances/$id", params: { id: i.id }, search: { tab: tab ?? "content" } });

  /** `world`: per Quick Play direkt in diese Welt (Ordnername unter saves/). */
  const launch = async (i: Instance, world?: string | null, server?: string | null, opts?: { afk?: boolean }) => {
    const pick = await launchAccount(i);
    if (!pick) return;
    try {
      await api.instanceLaunch(i.id, pick.accountId, world ?? null, server ?? null, undefined, opts?.afk);
      const s = queryClient.getQueryData<Settings>(qk.settings);
      if (s?.open_log_on_launch) open(i, "logs");
    } catch (e) {
      const kind = (e as { kind?: string })?.kind;
      if (!i.bedrock && (kind === "auth" || kind === "not_configured")) {
        toast.info(t("inst.need_account"), errorMessage(e), { label: t("nav.accounts"), onClick: () => nav({ to: "/accounts" }) });
      } else toast.error(e, t("inst.launch_failed"));
    }
  };

  const duplicate = async (i: Instance) => {
    try {
      const copy = await api.instanceDuplicate(i.id, null);
      toast.success(t("inst.duplicated"), copy.name, { label: t("inst.open"), onClick: () => open(copy) });
    } catch (e) {
      toast.error(e, t("inst.duplicate_failed"));
    }
  };

  const remove = async (i: Instance, after?: () => void) => {
    const ok = await confirm({
      title: t("inst.delete.title", { name: i.name }),
      text: t("inst.delete.text"),
      confirmLabel: t("common.delete"),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.instanceDelete(i.id);
      toast.success(t("inst.deleted"), i.name);
      after?.();
    } catch (e) {
      toast.error(e, t("inst.delete_failed"));
    }
  };

  const launchAgain = (i: Instance) => launch(i, null, null);

  return { open, launch, launchAgain, duplicate, remove };
}

/** Quick Play (`--quickPlaySingleplayer`) gibt es ab Minecraft 1.20 bzw. Snapshot 23w14a. */
export function supportsQuickPlay(mc: string): boolean {
  let m = /^1\.(\d+)/.exec(mc);
  if (m) return Number(m[1]) >= 20;
  m = /^(\d+)w(\d+)/.exec(mc);
  if (m) return Number(m[1]) > 23 || (Number(m[1]) === 23 && Number(m[2]) >= 14);
  m = /^(\d+)\./.exec(mc);
  return !!m && Number(m[1]) >= 2;
}

/** Desktop-/Startmenü-Verknüpfung, die die Instanz direkt startet. */
export async function createShortcut(i: Instance, location: "desktop" | "start_menu") {
  try {
    const path = await api.shortcutCreate(i.id, location);
    toast.success(t("inst.shortcut.created"), path);
  } catch (e) {
    toast.error(e, t("inst.shortcut.failed"));
  }
}
