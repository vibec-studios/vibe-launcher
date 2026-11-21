// Dialoge, die aus Instanz-Menüs geöffnet werden (Export, Gruppe, Neue Instanz). Wird auf jeder Seite von
// Frontend A einmal eingebunden.
import { useEffect, useState } from "react";
import { useInstanceDialogs, setGroup } from "@/components/instance/actions";
import { IconDialog } from "./IconDialog";
import { useInstances } from "@/lib/queries";
import { Button, Dialog } from "@/components/ui";
import { ExportDialog } from "@/features/export/ExportDialog";
import { useT } from "@/i18n";
import { GroupInput, NewInstanceDialog } from "./NewInstanceDialog";
import { ActionHost } from "@/components/instance/ActionHost";
import { AutofixHost } from "@/features/content/AutoFix";
import { useSimple } from "@/lib/mode";
import { SimpleNewGameDialog } from "./simple/SimpleNewGame";

function GroupDialog() {
  const t = useT();
  const inst = useInstanceDialogs((s) => s.groupFor);
  const { data: all = [] } = useInstances();
  const groups = [...new Set(all.map((i) => i.group).filter((g): g is string => !!g))].sort();
  const [value, setValue] = useState("");
  useEffect(() => setValue(inst?.group ?? ""), [inst]);
  const close = () => useInstanceDialogs.setState({ groupFor: null });
  const save = () => {
    if (inst) setGroup(inst, value);
    close();
  };
  return (
    <Dialog
      open={!!inst}
      onOpenChange={(o) => !o && close()}
      title={t("inst.group.title")}
      description={inst?.name}
      size="sm"
      footer={
        <>
          <Button variant="subtle" onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={save}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <GroupInput value={value} onChange={setValue} groups={groups} autoFocus />
      </form>
    </Dialog>
  );
}

export function InstanceDialogs() {
  const exportFor = useInstanceDialogs((s) => s.exportFor);
  const newOpen = useInstanceDialogs((s) => s.newOpen);
  const newGoal = useInstanceDialogs((s) => s.newGoal);
  const newExpert = useInstanceDialogs((s) => s.newExpert);
  // Simple-Modus: geführter Assistent; „Erweitert“ öffnet den vollen Dialog
  const guided = useSimple() && !newExpert;
  const onOpenChange = (o: boolean) => useInstanceDialogs.setState(o ? { newOpen: true } : { newOpen: false, newGoal: null, newExpert: false });
  return (
    <>
      <NewInstanceDialog open={newOpen && !guided} onOpenChange={onOpenChange} />
      <SimpleNewGameDialog open={newOpen && guided} goal={newGoal} onOpenChange={onOpenChange} />
      <GroupDialog />
      <IconDialog />
      <ActionHost />
      <AutofixHost />
      {exportFor && <ExportDialog instance={exportFor} open onOpenChange={(o) => !o && useInstanceDialogs.setState({ exportFor: null })} />}
    </>
  );
}
