import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Info, X } from "lucide-react";
import { Button, confirm, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { api } from "@/lib/api";
import { patchSettings } from "@/lib/mode";
import { isRunning, useGameState, useSettings } from "@/lib/queries";
import type { Instance } from "@/lib/types";
import { useVibeyClient } from "./detect";

const noticeId = (instanceId: string) => `vibey-eol:${instanceId}`;

export function VibeyEolNotice({ instance }: { instance: Instance }) {
  const t = useT();
  const qc = useQueryClient();
  const settings = useSettings().data;
  const vibey = useVibeyClient(instance);
  const running = isRunning(useGameState(instance.id));
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const id = noticeId(instance.id);
  if (!settings || hidden || !vibey.present || (settings.dismissed_notices ?? []).includes(id)) return null;

  const dismiss = () => {
    setHidden(true);
    const prev = settings.dismissed_notices ?? [];
    if (!prev.includes(id)) patchSettings({ dismissed_notices: [...prev, id] }).catch(() => {});
  };

  const remove = async () => {
    const ok = await confirm({ title: t("vibeyeol.confirm.title"), text: t("vibeyeol.confirm.text"), confirmLabel: t("common.remove"), danger: true });
    if (!ok) return;
    setBusy(true);
    try {
      if (vibey.managed) await api.clientPackRemove(instance.id, "vibey");
      const rest = vibey.managed ? (await api.contentList(instance.id, "mod")).filter((m) => vibey.files.includes(m.file_name)).map((m) => m.file_name) : vibey.files;
      if (rest.length) await api.contentRemove(instance.id, "mod", rest);
      toast.success(t("vibeyeol.removed"));
    } catch (e) {
      toast.error(e, t("vibeyeol.failed"));
    } finally {
      setBusy(false);
      void qc.invalidateQueries({ queryKey: ["content", instance.id] });
      void qc.invalidateQueries({ queryKey: ["client-packs"] });
    }
  };

  return (
    <div role="status" className="flex shrink-0 items-center gap-3 border-b border-line px-6 py-2.5">
      <Info size={15} className="shrink-0 text-dim" />
      <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-muted">{t("vibeyeol.text")}</p>
      <Button size="sm" variant="subtle" loading={busy} disabled={running} title={running ? t("vibeyeol.running") : undefined} onClick={() => void remove()}>
        {t("common.remove")}
      </Button>
      <button
        aria-label={t("notice.dismiss")}
        title={t("notice.dismiss")}
        onClick={dismiss}
        className="-mr-2 grid h-7 w-7 shrink-0 place-items-center rounded-ctl text-dim transition-colors duration-100 hover:bg-white/[.07] hover:text-text"
      >
        <X size={14} />
      </button>
    </div>
  );
}
