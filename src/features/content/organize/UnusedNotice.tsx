import { Unlink } from "lucide-react";
import { Button } from "@/components/ui";
import { Term } from "@/features/help/glossary/Term";
import { useT } from "@/i18n";
import type { Organize } from "./api";
import { openOrgDialog } from "./dialogs";

export function UnusedNotice({ data }: { data: Organize | undefined }) {
  const t = useT();
  const n = data?.unused_count ?? 0;
  if (!n) return null;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-card bg-warn/10 px-3.5 py-2.5">
      <Unlink size={16} className="shrink-0 text-warn" />
      <p className="min-w-[220px] flex-1 text-[13px] leading-snug text-text">
        {n === 1 ? t("org.notice.one_a") : t("org.notice.many_a", { n })} <Term id="dependency">{t(n === 1 ? "org.dep.one" : "org.dep.many")}</Term> {n === 1 ? t("org.notice.one_b") : t("org.notice.many_b")}
      </p>
      <Button size="sm" variant="subtle" onClick={() => openOrgDialog({ type: "cleanup" })}>
        {t("org.notice.action")}
      </Button>
    </div>
  );
}
