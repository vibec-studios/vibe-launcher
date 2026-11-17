// OWNER: Frontend-Agent B. Wird von InstancePage (Agent A) für die Tabs Mods/Resourcepacks/Shader eingebunden.
import type { ContentKind, Instance } from "@/lib/types";

export function InstanceContentTab({ instance, kind }: { instance: Instance; kind: ContentKind }) {
  return <div className="p-6 text-muted">Inhalte ({kind}) für {instance.name} – folgt</div>;
}
