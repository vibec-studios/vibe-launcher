// Hält Caches/Stores per Backend-Events aktuell.
import { useEffect } from "react";
import { api } from "@/lib/api";
import { useEvent } from "@/lib/events";
import { qk, queryClient, useGameStore, useTaskStore } from "@/lib/queries";
import type { Instance } from "@/lib/types";
import { useLang } from "@/i18n";

export function EventBridge() {
  // Anfangszustand laden
  useEffect(() => {
    api.tasksList().then((l) => useTaskStore.getState().set(l)).catch(() => {});
    api.gameStates().then((l) => useGameStore.getState().setAll(l)).catch(() => {});
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
  useEvent("game://log", ({ instance_id, lines }) => useGameStore.getState().appendLogs(instance_id, lines));

  useEvent("content://changed", ({ instance_id }) => {
    queryClient.invalidateQueries({ queryKey: ["content", instance_id] });
    queryClient.invalidateQueries({ queryKey: qk.contentUpdates(instance_id) });
    queryClient.invalidateQueries({ queryKey: qk.worlds(instance_id) });
  });

  useEvent("accounts://changed", (accounts) => queryClient.setQueryData(qk.accounts, accounts));

  useEvent("settings://changed", (s) => {
    queryClient.setQueryData(qk.settings, s);
    queryClient.invalidateQueries({ queryKey: qk.system });
    if (s.language !== useLang.getState().lang) useLang.getState().setLang(s.language);
    document.documentElement.dataset.reduceMotion = String(s.reduce_motion);
  });

  return null;
}
