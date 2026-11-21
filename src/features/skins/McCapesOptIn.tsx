import { ShieldCheck, Sparkles } from "lucide-react";
import { useState } from "react";
import { Button, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { patchSettings } from "@/lib/mode";

export function McCapesOptIn() {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const enable = async () => {
    setBusy(true);
    try {
      await patchSettings({ minecraftcapes: true });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="scroll min-h-0 flex-1 p-0.5 pt-2">
      <div className="flex flex-col items-center gap-3 rounded-card bg-surface px-6 py-8 text-center">
        <Sparkles size={22} className="text-brand" />
        <div className="text-[15px] font-semibold text-text">{t("mccapes.optin.title")}</div>
        <p className="max-w-[420px] text-[13px] leading-relaxed text-muted">{t("mccapes.optin.text")}</p>
        <p className="flex max-w-[420px] items-start gap-2 text-left text-[12.5px] leading-snug text-dim">
          <ShieldCheck size={15} className="mt-px shrink-0" />
          <span>{t("mccapes.optin.privacy")}</span>
        </p>
        <Button size="sm" variant="primary" loading={busy} onClick={() => void enable()}>
          {t("mccapes.optin.enable")}
        </Button>
      </div>
    </div>
  );
}
