import { Check, LogIn, X } from "lucide-react";
import { Button } from "@/components/ui";
import { useT } from "@/i18n";
import type { SkinsPageState } from "../hooks/useSkinsPage";

export function PreviewBar({ c }: { c: SkinsPageState }) {
  const t = useT();
  const { preview, account, setPreview, busy, applyPreview, profile, setMsa } = c;
  if (!preview) return null;
  return (
    <div className="flex shrink-0 items-center gap-2 bg-surface2 px-4 py-2">
      <span className="min-w-0 flex-1 truncate text-meta text-muted">
        {account ? t("skins.apply_hint", { name: account.username }) : t("skins.no_account_title")}
      </span>
      <Button size="sm" variant="subtle" icon={<X size={14} />} onClick={() => setPreview(null)} disabled={!!busy}>
        {t("skins.cancel_preview")}
      </Button>
      {account ? (
        <Button size="sm" variant="primary" icon={<Check size={14} />} onClick={() => void applyPreview()} disabled={!profile} loading={busy === "apply"}>
          {t("skins.apply")}
        </Button>
      ) : (
        <Button size="sm" variant="primary" icon={<LogIn size={14} />} onClick={() => setMsa(true)}>
          {t("skins.login")}
        </Button>
      )}
    </div>
  );
}
