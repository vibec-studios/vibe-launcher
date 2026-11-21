import type { ReactNode } from "react";
import { confirm } from "@/components/ui";
import type { ContentItem } from "@/lib/types";
import { organizeApi, toTargets, type RemovalExtra } from "./api";
import { askRemoveWithExtras } from "./dialogs";

export async function confirmRemoval(instanceId: string, items: ContentItem[], title: ReactNode, text: ReactNode, confirmLabel: string): Promise<RemovalExtra[] | null> {
  const mods = items.filter((i) => i.kind === "mod");
  const extras = mods.length ? await organizeApi.removalExtras(instanceId, toTargets(mods)).catch(() => [] as RemovalExtra[]) : [];
  if (extras.length) return askRemoveWithExtras(title, text, extras);
  const ok = await confirm({ title, text, confirmLabel, danger: true });
  return ok ? [] : null;
}
