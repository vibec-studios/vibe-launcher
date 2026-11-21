import { useState } from "react";
import { CloudDownload, CloudUpload, X } from "lucide-react";
import { Button, ChoiceCard, ChoiceGrid, Dialog, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { formatRelative } from "@/lib/format";
import type { CloudSettings, CloudSnapshot } from "@/lib/vibe-sdk";
import { errText } from "@/features/social/service";
import { CloudConflict, pushSnapshot, savedAt } from "./snapshot";
import { RestoreDialog } from "./RestoreDialog";

type Choice = "mine" | "theirs" | "cancel";

export function ConflictDialog({ conflict, onClose }: { conflict: { remote: CloudSettings; mine: CloudSnapshot } | null; onClose: () => void }) {
  const t = useT();
  const [choice, setChoice] = useState<Choice>("theirs");
  const [busy, setBusy] = useState(false);
  const [restore, setRestore] = useState(false);
  const r = conflict?.remote.snapshot;
  const when = savedAt(r);

  const go = async () => {
    if (!conflict) return;
    if (choice === "cancel") return onClose();
    if (choice === "theirs") return setRestore(true);
    setBusy(true);
    try {
      await pushSnapshot(conflict.remote.revision, conflict.mine);
      toast.success(t("cloud.backup.done"), t("cloud.backup.done_text", { n: conflict.mine.instances.length }));
      onClose();
    } catch (e) {
      if (e instanceof CloudConflict) toast.error(t("cloud.conflict.again"));
      else toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog
        open={!!conflict && !restore}
        onOpenChange={(o) => !o && onClose()}
        size="lg"
        locked={busy}
        title={t("cloud.conflict.title")}
        description={t("cloud.conflict.desc")}
        footer={
          <>
            <Button onClick={onClose} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" loading={busy} onClick={go}>
              {t("cloud.conflict.continue")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4 pb-2">
          <div className="grid grid-cols-2 gap-3 text-[12.5px] max-[700px]:grid-cols-1">
            <div className="rounded-card bg-surface px-4 py-3">
              <p className="font-medium text-text">{t("cloud.conflict.cloud")}</p>
              <p className="mt-1 text-muted">
                {when ? t("cloud.saved_at", { when: formatRelative(when) }) : t("cloud.saved_unknown")} · {t("cloud.count", { n: r?.instances.length ?? 0 })}
              </p>
            </div>
            <div className="rounded-card bg-surface px-4 py-3">
              <p className="font-medium text-text">{t("cloud.conflict.this")}</p>
              <p className="mt-1 text-muted">
                {t("cloud.conflict.now")} · {t("cloud.count", { n: conflict?.mine.instances.length ?? 0 })}
              </p>
            </div>
          </div>
          <ChoiceGrid columns={3}>
            <ChoiceCard icon={<CloudDownload size={20} />} title={t("cloud.conflict.theirs")} text={t("cloud.conflict.theirs.desc")} selected={choice === "theirs"} onClick={() => setChoice("theirs")} />
            <ChoiceCard icon={<CloudUpload size={20} />} title={t("cloud.conflict.mine")} text={t("cloud.conflict.mine.desc")} selected={choice === "mine"} onClick={() => setChoice("mine")} />
            <ChoiceCard icon={<X size={20} />} title={t("cloud.conflict.cancel")} text={t("cloud.conflict.cancel.desc")} selected={choice === "cancel"} onClick={() => setChoice("cancel")} />
          </ChoiceGrid>
        </div>
      </Dialog>
      <RestoreDialog
        open={restore}
        snapshot={r ?? null}
        onClose={() => {
          setRestore(false);
          onClose();
        }}
      />
    </>
  );
}
