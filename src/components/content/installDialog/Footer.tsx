import { ExternalLink, FolderPlus, ListPlus, PackagePlus } from "lucide-react";
import { Button, Tooltip } from "@/components/ui";
import { useT } from "@/i18n";
import { navigateTo } from "../util";
import { type Phase, useStartAction } from "./state";

export function Footer({ phase, setPhase, isPack, onClose }: { phase: Phase; setPhase: (p: Phase) => void; isPack: boolean; onClose: () => void }) {
  const t = useT();
  const start = useStartAction();
  if (phase.k === "select")
    return (
      <>
        {/* Manuell: drei Knöpfe passen nicht – Schließen über das X */}
        {!start.alt && (
          <Button variant="subtle" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        )}
        {start.alt && (
          <Tooltip content={<span className="block max-w-[260px] leading-snug">{t("manual.add_tip")}</span>}>
            <Button variant="ghost" disabled={start.disabled || start.busy} onClick={() => start.alt?.run()} icon={<ListPlus size={14} />}>
              {start.alt.label}
            </Button>
          </Tooltip>
        )}
        <Button
          variant="primary"
          disabled={start.disabled}
          loading={start.busy}
          onClick={() => start.run?.()}
          icon={isPack ? <FolderPlus size={14} /> : start.manual ? <ExternalLink size={14} /> : <PackagePlus size={14} />}
        >
          {start.label}
        </Button>
      </>
    );
  if (phase.k === "running")
    return (
      <Button variant="ghost" onClick={onClose}>
        {t("install.background")}
      </Button>
    );
  if (phase.k === "done")
    return (
      <>
        <Button
          variant="ghost"
          onClick={() => {
            onClose();
            navigateTo({ to: "/instances/$id", params: { id: phase.instanceId }, search: { tab: "content" } });
          }}
        >
          {t("install.go_instance")}
        </Button>
        <Button variant="primary" onClick={onClose} autoFocus>
          {t("common.done")}
        </Button>
      </>
    );
  return (
    <>
      <Button variant="subtle" onClick={onClose}>
        {t("common.close")}
      </Button>
      <Button variant="ghost" onClick={() => setPhase({ k: "select" })} autoFocus>
        {t("common.back")}
      </Button>
    </>
  );
}
