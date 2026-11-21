import { useEffect } from "react";
import { Plus } from "lucide-react";
import { Button, Dialog, EmptyState } from "@/components/ui";
import { useT } from "@/i18n";
import { AgentRow } from "./AgentRow";
import { loadAgents, useRemote } from "./store";

export function AgentsDialog() {
  const t = useT();
  const open = useRemote((s) => s.manageOpen);
  const agents = useRemote((s) => s.agents);
  useEffect(() => {
    if (open) void loadAgents(true);
  }, [open]);
  const close = () => useRemote.setState({ manageOpen: false });
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && close()}
      size="lg"
      title={t("rmt.agents.title")}
      description={t("rmt.agents.desc")}
      footer={
        <>
          <Button variant="primary" icon={<Plus size={15} />} className="mr-auto" onClick={() => useRemote.setState({ manageOpen: false, addOpen: true })}>
            {t("rmt.wiz.title")}
          </Button>
          <Button variant="subtle" onClick={close}>
            {t("common.close")}
          </Button>
        </>
      }
    >
      <div className="flex min-h-[220px] flex-col gap-2">
        {agents.length === 0 ? <EmptyState icon="monitor" title={t("rmt.agents.empty")} /> : agents.map((a) => <AgentRow key={a.key} agent={a} />)}
      </div>
    </Dialog>
  );
}
