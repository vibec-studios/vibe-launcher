import { Eye, Folders, Pencil, Plus, Power, PowerOff, Trash2 } from "lucide-react";
import { useMemo } from "react";
import { Button, DropdownItem, DropdownLabel, DropdownMenu, DropdownSeparator, DropdownSub, confirm, toast } from "@/components/ui";
import { t as tt, useT } from "@/i18n";
import type { ContentItem } from "@/lib/types";
import { indexOrganize, organizeApi, orgItemKey, setOrganize, toTargets, useOrganize, type OrgGroup } from "./api";
import { openOrgDialog } from "./dialogs";
import { setOrgFilter } from "./filter";

async function deleteGroup(instanceId: string, g: OrgGroup) {
  const ok = await confirm({ title: tt("org.group.delete_title", { name: g.name }), text: tt("org.group.delete_text"), confirmLabel: tt("org.group.delete"), danger: true });
  if (!ok) return;
  try {
    setOrganize(instanceId, await organizeApi.deleteGroup(instanceId, g.id));
    setOrgFilter(instanceId, { group: "all" });
  } catch (e) {
    toast.error(e);
  }
}

export function GroupsMenu({
  instanceId,
  items,
  selected,
  setEnabled,
  labelClassName,
}: {
  instanceId: string;
  items: ContentItem[];
  selected: ContentItem[];
  setEnabled: (items: ContentItem[], enabled: boolean) => void;
  labelClassName?: string;
}) {
  const t = useT();
  const { data } = useOrganize(instanceId);
  const members = useMemo(() => {
    const idx = indexOrganize(data);
    const m = new Map<string, ContentItem[]>();
    for (const c of items) {
      const g = idx.items.get(orgItemKey(c.kind, c.file_name))?.group;
      if (g) m.set(g, [...(m.get(g) ?? []), c]);
    }
    return m;
  }, [data, items]);
  const groups = data?.groups ?? [];

  return (
    <DropdownMenu
      trigger={
        <Button size="sm" variant="subtle" icon={<Folders size={14} />} title={t("org.groups")} className="data-[state=open]:bg-white/[.07] data-[state=open]:text-text">
          <span className={labelClassName}>{t("org.groups")}</span>
        </Button>
      }
    >
      <DropdownLabel>{t("org.groups")}</DropdownLabel>
      {groups.length === 0 && <div className="max-w-[300px] px-3 pb-2 text-[12.5px] leading-snug text-muted">{t("org.groups.none")}</div>}
      {groups.length > 0 && (
        <div className="scroll max-h-[300px]">
          {groups.map((g) => {
            const list = members.get(g.id) ?? [];
            const on = list.filter((c) => c.enabled).length;
            return (
              <DropdownSub
                key={g.id}
                icon={<span className="grid w-[14px] place-items-center"><span className="h-2.5 w-2.5 rounded-full" style={{ background: g.color ?? "currentColor" }} /></span>}
                label={
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="max-w-[180px] truncate">{g.name}</span>
                    <span className="text-[12px] text-dim">{t("org.groups.count", { on, total: list.length })}</span>
                  </span>
                }
              >
                <DropdownItem icon={<Eye size={14} />} onSelect={() => setOrgFilter(instanceId, { group: g.id })}>
                  {t("org.groups.show")}
                </DropdownItem>
                <DropdownItem icon={<Power size={14} />} disabled={!list.some((c) => !c.enabled)} onSelect={() => setEnabled(list, true)}>
                  {t("org.groups.enable_all")}
                </DropdownItem>
                <DropdownItem icon={<PowerOff size={14} />} disabled={!list.some((c) => c.enabled)} onSelect={() => setEnabled(list, false)}>
                  {t("org.groups.disable_all")}
                </DropdownItem>
                <DropdownSeparator />
                <DropdownItem icon={<Pencil size={14} />} onSelect={() => openOrgDialog({ type: "group", group: g })}>
                  {t("org.groups.edit")} …
                </DropdownItem>
                <DropdownItem icon={<Trash2 size={14} />} danger onSelect={() => void deleteGroup(instanceId, g)}>
                  {t("org.group.delete")}
                </DropdownItem>
              </DropdownSub>
            );
          })}
        </div>
      )}
      <DropdownSeparator />
      <DropdownItem icon={<Plus size={14} />} onSelect={() => openOrgDialog({ type: "group", targets: selected.length ? toTargets(selected) : undefined })}>
        {selected.length ? t("org.groups.new_from_sel", { n: selected.length }) : t("org.menu.new_group")} …
      </DropdownItem>
    </DropdownMenu>
  );
}
