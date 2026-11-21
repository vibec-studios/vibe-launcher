import { Info, Wrench } from "lucide-react";
import { Button, Dialog } from "@/components/ui";
import { useT } from "@/i18n";
import type { Instance, QuickCheck } from "@/lib/types";
import { skipLaunchCheck, useAutofix, type PreChoice } from "../autofixStore";

export function PreLaunchDialog({ inst, q, resolve }: { inst: Instance; q: QuickCheck; resolve: (c: PreChoice) => void }) {
  const t = useT();
  const done = (c: PreChoice) => {
    if (c === "launch") skipLaunchCheck(inst.id, q.errors);
    useAutofix.setState({ pre: null });
    resolve(c);
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && done("cancel")}
      title={t("fix.pre.title")}
      description={t(q.errors === 1 ? "fix.pre.text_1" : "fix.pre.text", { n: q.errors, name: inst.name })}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => done("launch")}>
            {t("fix.pre.launch")}
          </Button>
          <Button variant="accent" icon={<Wrench size={14} />} onClick={() => done("fix")}>
            {t("fix.pre.fix")}
          </Button>
        </>
      }
    >
      <div className="flex items-start gap-2.5 rounded-ctl bg-surface px-3 py-2.5 text-[12.5px] text-muted">
        <Info size={14} className="mt-px shrink-0 text-dim" />
        {t("fix.pre.hint")}
      </div>
    </Dialog>
  );
}
