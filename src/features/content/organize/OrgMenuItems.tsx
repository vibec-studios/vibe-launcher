import { Check, FolderMinus, FolderPlus, Hash, Plus, UserRoundCheck } from "lucide-react";
import { ContextItem, ContextSeparator, ContextSub, DropdownItem, DropdownSeparator, DropdownSub, toast } from "@/components/ui";
import { t as tt, useT } from "@/i18n";
import { useExpert } from "@/lib/simple-mode";
import type { ContentItem } from "@/lib/types";
import { indexOrganize, organizeApi, orgItemKey, setOrganize, toTargets, useOrganize } from "./api";
import { openOrgDialog } from "./dialogs";

export type MenuKind = "context" | "dropdown";

export async function assignGroup(instanceId: string, items: ContentItem[], groupId: string | null, groupName?: string) {
  try {
    setOrganize(instanceId, await organizeApi.assign(instanceId, toTargets(items), groupId));
    if (groupId && groupName) toast.success(tt("org.group.assigned", { n: items.length, name: groupName }));
  } catch (e) {
    toast.error(e);
  }
}

export async function keepDeps(instanceId: string, items: ContentItem[]) {
  try {
    setOrganize(instanceId, await organizeApi.keep(instanceId, toTargets(items)));
    toast.success(tt("org.cleanup.kept", { n: items.length }));
  } catch (e) {
    toast.error(e);
  }
}

export function openTags(items: ContentItem[]) {
  openOrgDialog({ type: "tags", targets: toTargets(items), names: items.map((i) => i.name) });
}

export function OrgMenuItems({ instanceId, items, menu }: { instanceId: string; items: ContentItem[]; menu: MenuKind }) {
  const t = useT();
  const { data } = useOrganize(instanceId);
  const showTags = useExpert("mod-tags");
  const Item = menu === "context" ? ContextItem : DropdownItem;
  const Sub = menu === "context" ? ContextSub : DropdownSub;
  const Sep = menu === "context" ? ContextSeparator : DropdownSeparator;
  if (!items.length) return null;
  const idx = indexOrganize(data);
  const infos = items.map((i) => idx.items.get(orgItemKey(i.kind, i.file_name)));
  const grouped = infos.some((i) => i?.group);
  const autoItems = items.filter((_, n) => infos[n]?.auto);
  return (
    <>
      <Sub icon={<FolderPlus size={14} />} label={t("org.menu.to_group")}>
        {(data?.groups ?? []).map((g) => {
          const all = infos.every((i) => i?.group === g.id);
          return (
            <Item
              key={g.id}
              icon={all ? <Check size={14} /> : <span className="grid w-[14px] place-items-center"><span className="h-2 w-2 rounded-full" style={{ background: g.color ?? "currentColor" }} /></span>}
              onSelect={() => void assignGroup(instanceId, items, g.id, g.name)}
            >
              <span className="max-w-[220px] truncate">{g.name}</span>
            </Item>
          );
        })}
        {(data?.groups.length ?? 0) > 0 && <Sep />}
        <Item icon={<Plus size={14} />} onSelect={() => openOrgDialog({ type: "group", targets: toTargets(items) })}>
          {t("org.menu.new_group")} …
        </Item>
        {grouped && (
          <Item icon={<FolderMinus size={14} />} onSelect={() => void assignGroup(instanceId, items, null)}>
            {t("org.menu.ungroup")}
          </Item>
        )}
      </Sub>
      {showTags && (
        <Item icon={<Hash size={14} />} onSelect={() => openTags(items)}>
          {t("org.menu.tags")} …
        </Item>
      )}
      {autoItems.length > 0 && (
        <Item icon={<UserRoundCheck size={14} />} onSelect={() => void keepDeps(instanceId, autoItems)}>
          {t("org.menu.keep")}
        </Item>
      )}
    </>
  );
}
