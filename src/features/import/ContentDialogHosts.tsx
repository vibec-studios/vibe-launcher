import { DeferredMount } from "@/components/DeferredMount";
import { useInstallDialog } from "@/components/content/installStore";
import { useImportDialog } from "./importStore";

const loadImportDialog = () => import("./ImportDialog").then((m) => m.ImportDialog);
const loadInstallDialogHost = () => import("@/components/content/InstallDialog").then((m) => m.InstallDialogHost);

export function ContentDialogHosts() {
  const importing = useImportDialog((s) => s.open);
  const installing = useInstallDialog((s) => !!s.target);
  return (
    <>
      <DeferredMount active={importing} load={loadImportDialog} />
      <DeferredMount active={installing} load={loadInstallDialogHost} />
    </>
  );
}
