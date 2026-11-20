import { useEffect } from "react";
import { setWatching } from "@/components/content/install";
import { api } from "@/lib/api";

const RENEW_MS = 4 * 60_000;

export function useKeepWatching(instanceId: string, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const renew = () =>
      api
        .contentMissingWatch(instanceId)
        .then((u) => setWatching(instanceId, u))
        .catch(() => undefined);
    void renew();
    const h = setInterval(renew, RENEW_MS);
    return () => clearInterval(h);
  }, [instanceId, active]);
}
