import { ModpackUpdateDialog } from "@/features/content/ModpackUpdate";
import { PackSourceDialog } from "./PackSourceDialog";
import { closePackUpdate, openPackPreview, usePackUpdate } from "./store";

export function PackUpdateHost() {
  const { pick, preview } = usePackUpdate();
  if (pick) return <PackSourceDialog instance={pick} onNext={(input) => openPackPreview(pick, input)} onClose={closePackUpdate} />;
  if (preview) return <ModpackUpdateDialog instance={preview.instance} versionId={null} input={preview.input} onClose={closePackUpdate} />;
  return null;
}
