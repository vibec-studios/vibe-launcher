import { resetIcon, setIcon, setInstanceIcon, useInstanceDialogs } from "@/components/instance/actions";
import { IconGallery } from "@/components/instance/blocks/IconGallery";
import { Dialog } from "@/components/ui";
import { instanceAccent } from "@/lib/format";
import { useInstances } from "@/lib/queries";
import { useT } from "@/i18n";

export function IconDialog() {
  const t = useT();
  const picked = useInstanceDialogs((s) => s.iconFor);
  const { data: all = [] } = useInstances();
  const inst = picked ? (all.find((i) => i.id === picked.id) ?? picked) : null;
  const close = () => useInstanceDialogs.setState({ iconFor: null });
  return (
    <Dialog open={!!inst} onOpenChange={(o) => !o && close()} title={t("inst.icon.choose")} description={inst?.name} size="sm">
      {inst && (
        <IconGallery
          value={inst.icon}
          seed={inst.id}
          accent={instanceAccent(inst.id, inst.accent)}
          onChange={(icon) => setInstanceIcon(inst, icon)}
          onImage={() => {
            close();
            setIcon(inst);
          }}
          onReset={inst.icon ? () => resetIcon(inst) : undefined}
        />
      )}
    </Dialog>
  );
}
