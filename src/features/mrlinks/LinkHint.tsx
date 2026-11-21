import { Link2 } from "lucide-react";
import { Button } from "@/components/ui";
import { useT } from "@/i18n";
import { looksLikeModrinthLink } from "./api";
import { useOpenLink } from "./useOpenLink";

export function LinkHint({ text, onOpened }: { text: string; onOpened: () => void }) {
  const t = useT();
  const { openLink, busy } = useOpenLink();
  if (!looksLikeModrinthLink(text)) return null;
  return (
    <div className="mx-6 mt-2 flex flex-wrap items-center gap-3 rounded-card bg-accent/[.08] px-3.5 py-2.5">
      <Link2 size={15} className="shrink-0 text-accent" />
      <span className="min-w-0 flex-1 text-[13px] text-text">{t("mrlink.detected")}</span>
      <Button size="sm" variant="primary" loading={busy} onClick={() => void openLink(text).then((ok) => ok && onOpened())}>
        {t("mrlink.open_button")}
      </Button>
    </div>
  );
}
