import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { router } from "@/app/router";
import { leanApi, type LeanRestore } from "./api";

function currentRoute(): string | null {
  const href = router.state.location.href;
  return href.startsWith("/") ? href : null;
}

function target(r: LeanRestore): string | null {
  if (r.reason === "crash" && r.instance_id) return `/instances/${encodeURIComponent(r.instance_id)}`;
  return r.route;
}

export function LeanBridge() {
  useEffect(() => {
    leanApi
      .restoreTake()
      .then((r) => {
        const to = r && target(r);
        if (to && to !== currentRoute()) router.history.replace(to);
      })
      .catch(() => {});
    const un = listen("lean://prepare", () => {
      void leanApi.handoff(currentRoute()).catch(() => {});
    });
    return () => {
      un.then((f) => f()).catch(() => {});
    };
  }, []);
  return null;
}
