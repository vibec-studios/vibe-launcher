import { Button } from "@/components/ui";
import { ImportSources } from "@/features/import/ImportSources";
import { openImport } from "@/features/import/importStore";
import { useT } from "@/i18n";

// ------------------------------------------------------------------ Tab: Importieren

export function ImportTab({ onDone }: { onDone: () => void }) {
  const t = useT();
  return (
    <>
      <div className="scroll min-h-0 flex-1 px-6 py-4">
        <ImportSources onSelect={(mode) => {
          onDone();
          openImport(null, mode);
        }} />
      </div>
      <footer className="flex justify-end border-t border-line px-6 py-3">
        <Button variant="subtle" onClick={onDone}>{t("common.cancel")}</Button>
      </footer>
    </>
  );
}
