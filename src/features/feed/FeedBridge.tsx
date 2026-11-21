import { useEffect } from "react";
import { queryClient, useGameStore } from "@/lib/queries";
import type { Instance } from "@/lib/types";
import { publishFeedEvent } from "./api";

export function FeedBridge() {
  useEffect(() => {
    let running = new Set(Object.keys(useGameStore.getState().states).filter((k) => useGameStore.getState().states[k].state === "running"));
    const offGame = useGameStore.subscribe((s) => {
      const now = new Set(Object.keys(s.states).filter((k) => s.states[k].state === "running"));
      for (const k of now) if (!running.has(k)) publishFeedEvent("played");
      running = now;
    });
    let known: Set<string> | null = null;
    const read = () => queryClient.getQueryData<Instance[]>(["instances"]);
    const first = read();
    if (first) known = new Set(first.map((i) => i.id));
    const offCache = queryClient.getQueryCache().subscribe((ev) => {
      if (ev.query.queryKey.length !== 1 || ev.query.queryKey[0] !== "instances" || ev.type !== "updated") return;
      const list = read();
      if (!list) return;
      if (known && list.some((i) => !known!.has(i.id))) publishFeedEvent("created_instance");
      known = new Set(list.map((i) => i.id));
    });
    return () => {
      offGame();
      offCache();
    };
  }, []);
  return null;
}
