import { queryClient, qk } from "@/lib/queries";
import type { Instance } from "@/lib/types";
import { closeSettings, openSettings } from "@/features/settings/store";
import { openImport, useImportDialog } from "@/features/import/ImportDialog";
import { closeInstanceSettings, openInstanceSettings } from "@/features/instances/settings/store";
import { useLang } from "@/i18n";
import type { TourAction } from "../types";

export function recentInstanceId(): string | null {
  const list = queryClient.getQueryData<Instance[]>(qk.instances) ?? [];
  const java = list.filter((i) => !i.bedrock);
  const sorted = [...java].sort((a, b) => (b.last_played ?? b.created_at ?? 0) - (a.last_played ?? a.created_at ?? 0));
  return sorted[0]?.id ?? null;
}

export function resolveRoute(route: string): string | null {
  if (!route.includes("{recent}")) return route;
  const id = recentInstanceId();
  return id ? route.replace("{recent}", encodeURIComponent(id)) : null;
}

export function runAction(action: TourAction) {
  const [kind, arg] = action.split(":");
  if (kind === "settings") openSettings(arg as Parameters<typeof openSettings>[0]);
  if (kind === "import" && !useImportDialog.getState().open) openImport(null, arg as "launcher" | "file");
  if (kind === "instance-settings") {
    const id = recentInstanceId();
    if (id) openInstanceSettings(id, useLang.getState().simple ? "general" : "java");
  }
}

export function closeAction(action: TourAction) {
  const [kind] = action.split(":");
  if (kind === "settings") closeSettings();
  if (kind === "import") useImportDialog.setState({ open: false });
  if (kind === "instance-settings") closeInstanceSettings();
}
