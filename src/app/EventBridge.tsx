// Hält Caches/Stores per Backend-Events aktuell.
import { useEffect } from "react";
import { api } from "@/lib/api";
import { useEvent } from "@/lib/events";
import { qk, queryClient, sqk, useGameStore, useServerStore, useTaskStore } from "@/lib/queries";
import type { Instance, Server } from "@/lib/types";
import { t, useLang } from "@/i18n";
import { toast } from "@/components/ui";
import { manualArrived } from "@/components/content/install";
import { navigateTo } from "@/components/content/util";
import { useServerDialogs } from "@/features/servers/actions";

export function EventBridge() {
  // Anfangszustand laden
  useEffect(() => {
    api.tasksList().then((l) => useTaskStore.getState().set(l)).catch(() => {});
    api.gameStates().then((l) => useGameStore.getState().setAll(l)).catch(() => {});
    api.serverStatuses().then((l) => useServerStore.getState().setAll(l)).catch(() => {});
    api
      .settingsGet()
      .then((s) => {
        queryClient.setQueryData(qk.settings, s);
        if (s.language !== useLang.getState().lang) useLang.getState().setLang(s.language);
        document.documentElement.dataset.reduceMotion = String(s.reduce_motion);
      })
      .catch(() => {});
  }, []);

  useEvent("task://update", (t) => useTaskStore.getState().upsert(t));

  useEvent("instance://changed", (inst) => {
    queryClient.setQueryData<Instance>(qk.instance(inst.id), inst);
    queryClient.setQueryData<Instance[]>(qk.instances, (list) => {
      if (!list) return list;
      const i = list.findIndex((x) => x.id === inst.id);
      if (i === -1) return [inst, ...list];
      const next = list.slice();
      next[i] = inst;
      return next;
    });
  });

  useEvent("instance://removed", ({ id }) => {
    queryClient.setQueryData<Instance[]>(qk.instances, (list) => list?.filter((x) => x.id !== id));
    queryClient.removeQueries({ queryKey: qk.instance(id) });
  });

  useEvent("game://state", (s) => useGameStore.getState().setState(s));
  useEvent("game://log", ({ run_id, lines }) => useGameStore.getState().appendLogs(run_id, lines));

  useEvent("content://changed", ({ instance_id }) => {
    queryClient.invalidateQueries({ queryKey: ["content", instance_id] });
    queryClient.invalidateQueries({ queryKey: qk.contentUpdates(instance_id) });
    queryClient.invalidateQueries({ queryKey: qk.worlds(instance_id) });
  });

  // Manuell geladene CurseForge-Datei aus dem Download-Ordner übernommen
  useEvent("content://manual-arrived", (m) => {
    manualArrived(m.instance_id, m.project_id);
    const inst = queryClient.getQueryData<Instance[]>(qk.instances)?.find((i) => i.id === m.instance_id);
    toast.success(t("manual.arrived_title", { name: m.project_name }), t("manual.arrived_text", { file: m.file_name, instance: inst?.name ?? m.instance_id }), {
      label: t("install.go_instance"),
      onClick: () => navigateTo({ to: "/instances/$id", params: { id: m.instance_id }, search: { tab: "content" } }),
    });
  });

  useEvent("accounts://changed", (accounts) => queryClient.setQueryData(qk.accounts, accounts));

  // ---------------------------------------------------------------- Lokale Server
  useEvent("servers://changed", (srv) => {
    queryClient.setQueryData<Server>(sqk.server(srv.id), srv);
    queryClient.setQueryData<Server[]>(sqk.servers, (list) => {
      if (!list) return list;
      const i = list.findIndex((x) => x.id === srv.id);
      if (i === -1) return [srv, ...list];
      const next = list.slice();
      next[i] = srv;
      return next;
    });
  });
  useEvent("servers://removed", ({ id }) => {
    queryClient.setQueryData<Server[]>(sqk.servers, (list) => list?.filter((x) => x.id !== id));
    queryClient.removeQueries({ queryKey: sqk.server(id) });
    useServerStore.getState().remove(id);
  });
  useEvent("server://status", (s) => {
    const prev = useServerStore.getState().statuses[s.server_id];
    useServerStore.getState().setStatus(s);
    // Nach dem Stoppen haben sich Welten/Spielerlisten evtl. geändert
    if (prev && prev.state !== s.state && (s.state === "stopped" || s.state === "running")) {
      queryClient.invalidateQueries({ queryKey: sqk.worlds(s.server_id) });
      queryClient.invalidateQueries({ queryKey: sqk.players(s.server_id) });
    }
  });
  useEvent("server://log", ({ server_id, lines }) => useServerStore.getState().appendLogs(server_id, lines));
  useEvent("servers://close-requested", ({ running }) => useServerDialogs.setState({ quit: running }));

  useEvent("settings://changed", (s) => {
    queryClient.setQueryData(qk.settings, s);
    queryClient.invalidateQueries({ queryKey: qk.system });
    if (s.language !== useLang.getState().lang) useLang.getState().setLang(s.language);
    document.documentElement.dataset.reduceMotion = String(s.reduce_motion);
  });

  return null;
}
