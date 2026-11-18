// Einstiege in den Datei-Bereich: Instanzseite (Einstellungen → Dateien) und Serverseite (Tab „Dateien“).
import { useMemo } from "react";
import type { FileScope, Instance, Server } from "@/lib/types";
import { isRunning, isServerActive, useGameState, useServerStatus } from "@/lib/queries";
import { useT } from "@/i18n";
import { FilesBrowser } from "./FilesBrowser";

export function InstanceFilesTab({ instance }: { instance: Instance }) {
  const t = useT();
  const running = isRunning(useGameState(instance.id));
  const scope = useMemo<FileScope>(() => ({ kind: "instance", id: instance.id }), [instance.id]);
  return <FilesBrowser scope={scope} running={running} runningText={t("files.running.instance")} />;
}

export function ServerFilesTab({ server }: { server: Server }) {
  const t = useT();
  const running = isServerActive(useServerStatus(server.id));
  const scope = useMemo<FileScope>(() => ({ kind: "server", id: server.id }), [server.id]);
  return <FilesBrowser scope={scope} running={running} runningText={t("files.running.server")} />;
}
