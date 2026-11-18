// Einstiege in den Datei-Bereich: Instanzseite (Einstellungen → Dateien) und Serverseite (Tab „Dateien“).
import { useMemo } from "react";
import type { FileScope, Instance, Server } from "@/lib/types";
import { isRunning, isServerActive, useGameState, useServerStatus } from "@/lib/queries";
import { useT } from "@/i18n";
import { FilesBrowser, type QuickItem } from "./FilesBrowser";

const INSTANCE_QUICK: QuickItem[] = [
  { path: "config" },
  { path: "options.txt" },
  { path: "mods" },
  { path: "saves" },
  { path: "resourcepacks" },
  { path: "defaultconfigs" },
  { path: "kubejs" },
  { path: "logs/latest.log", label: "latest.log" },
];

const SERVER_QUICK: QuickItem[] = [
  { path: "server.properties" },
  { path: "config" },
  { path: "mods" },
  { path: "plugins" },
  { path: "world" },
  { path: "whitelist.json" },
  { path: "ops.json" },
  { path: "logs/latest.log", label: "latest.log" },
];

export function InstanceFilesTab({ instance }: { instance: Instance }) {
  const t = useT();
  const running = isRunning(useGameState(instance.id));
  const scope = useMemo<FileScope>(() => ({ kind: "instance", id: instance.id }), [instance.id]);
  return <FilesBrowser scope={scope} running={running} runningText={t("files.running.instance")} quick={INSTANCE_QUICK} />;
}

export function ServerFilesTab({ server }: { server: Server }) {
  const t = useT();
  const running = isServerActive(useServerStatus(server.id));
  const scope = useMemo<FileScope>(() => ({ kind: "server", id: server.id }), [server.id]);
  return <FilesBrowser scope={scope} running={running} runningText={t("files.running.server")} quick={SERVER_QUICK} />;
}
