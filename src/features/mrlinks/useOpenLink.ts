import { useState } from "react";
import { toast } from "@/components/ui";
import { useT } from "@/i18n";
import { enqueueAppAction } from "@/lib/appActions";
import { mrLinksApi } from "./api";

export function useOpenLink() {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const openLink = async (url: string): Promise<boolean> => {
    setBusy(true);
    try {
      const a = await mrLinksApi.parse(url.trim());
      if (!a) {
        toast.error(t("mrlink.invalid"));
        return false;
      }
      enqueueAppAction(a);
      return true;
    } catch (e) {
      toast.error(e);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { openLink, busy };
}
