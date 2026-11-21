import { useServerTargets } from "@/features/installtarget/hooks";
import { addonSupport } from "@/features/installtarget/registry";
import { ServerPickerSection, serverEligible, type PickerProject } from "@/features/discover/server/ServerPickerSection";

export function LinkServerTargets({ project, onDone }: { project: PickerProject; onDone: () => void }) {
  const { targets } = useServerTargets();
  if (!serverEligible(project) || !targets.some((s) => addonSupport(s))) return null;
  return (
    <div className="mt-3 rounded-card bg-surface p-1" data-testid="link-server-targets">
      <ServerPickerSection project={project} close={onDone} bare />
    </div>
  );
}
