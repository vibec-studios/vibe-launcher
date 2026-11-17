// OWNER: Frontend-Agent A.
import type { Instance } from "@/lib/types";

export function LogsTab({ instance }: { instance: Instance }) {
  return <div className="p-6 text-muted">Logs für {instance.name} – folgt</div>;
}
