import { ErrorBoundary } from "@/app/ErrorBoundary";
import { PackSyncHost } from "@/features/packsync/PackSyncHost";
import { HostPanelHost } from "@/features/hostpanel/HostPanelHost";

export function VibeExtrasHost() {
  return (
    <ErrorBoundary>
      <PackSyncHost />
      <HostPanelHost />
    </ErrorBoundary>
  );
}
