import { toast } from "@/components/ui";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/queries";
import type { ContentKind } from "@/lib/types";

/** Dateien zu einer Instanz hinzufügen (Dialog, Drag & Drop, globale Ablage). */
export async function addContentFiles(instanceId: string, kind: ContentKind, paths: string[]) {
  if (!paths.length) return;
  try {
    const added = await api.contentAddFiles(instanceId, kind, paths);
    queryClient.invalidateQueries({ queryKey: ["content", instanceId] });
    toast.success(t("content.added", { n: added.length || paths.length }));
  } catch (e) {
    toast.error(e, t("content.add_failed"));
  }
}
