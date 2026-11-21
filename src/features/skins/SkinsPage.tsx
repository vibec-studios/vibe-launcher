// OWNER: Auth-Agent. Skins & Capes: 3D-Vorschau, aktueller Skin/Cape des Accounts, lokale Skin-Bibliothek.
import { MsaDialog } from "@/features/accounts/MsaDialog";
import { SkinEditorDialog } from "./editor/SkinEditorDialog";
import { useSkinsPage } from "./hooks/useSkinsPage";
import { CapeStrip } from "./components/CapeStrip";
import { LibraryPanel } from "./components/LibraryPanel";
import { PreviewBar } from "./components/PreviewBar";
import { RenameDialog } from "./components/RenameDialog";
import { SkinsToolbar } from "./components/SkinsToolbar";
import { ViewerHeader } from "./components/ViewerHeader";
import { ViewerStage } from "./components/ViewerStage";

export function SkinsPage() {
  const c = useSkinsPage();
  return (
    <div ref={c.pageRef} className="flex h-full min-h-0 flex-col bg-panel">
      <SkinsToolbar c={c} />

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(340px,1fr)_minmax(360px,1.1fr)] gap-4 px-6 pb-6">
        {/* ------------------------------------------------------------ Viewer + aktueller Skin */}
        <section data-tour="skins-viewer" className="flex min-h-0 flex-col overflow-hidden rounded-card bg-surface">
          <ViewerHeader c={c} />
          <ViewerStage c={c} />
          <PreviewBar c={c} />
          <CapeStrip c={c} />
        </section>

        {/* ------------------------------------------------------------ Bibliothek */}
        <LibraryPanel c={c} />
      </div>

      <RenameDialog skin={c.renaming} onClose={() => c.setRenaming(null)} />
      <SkinEditorDialog open={c.editorOpen} onOpenChange={c.setEditorOpen} source={c.editorSource} account={c.editorAccount} />
      <MsaDialog open={c.msa} onOpenChange={c.setMsa} />
    </div>
  );
}
