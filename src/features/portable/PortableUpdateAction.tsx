import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui";
import { openExternal } from "@/components/content/util";
import { useT } from "@/i18n";
import { usePortable } from "./api";

export function PortableUpdateAction() {
  const t = useT();
  const url = usePortable().data?.releases_url;
  return (
    <>
      <p className="text-meta text-muted">{t("update.portable_hint")}</p>
      <Button variant="primary" icon={<ExternalLink size={14} />} disabled={!url} onClick={() => url && void openExternal(url)}>
        {t("portable.download")}
      </Button>
    </>
  );
}
