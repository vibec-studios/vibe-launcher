import { ChevronDown, Hash, Package, Unlink, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { DropdownCheckItem, DropdownLabel, DropdownMenu, DropdownSeparator, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { useExpert } from "@/lib/simple-mode";
import type { Organize } from "./api";
import { GROUP_NONE, setOrgFilter, useOrgFilter, type Origin } from "./filter";

function Chip({ active, onClick, count, tone, icon, children }: { active: boolean; onClick: () => void; count?: number; tone?: "warn"; icon?: ReactNode; children: ReactNode }) {
  return (
    <button
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex h-8 items-center gap-1.5 rounded-pill px-2.5 text-[13px] font-semibold transition-colors duration-100",
        active ? (tone === "warn" ? "bg-warn/20 text-warn" : "bg-surface3 text-text") : "bg-surface text-muted hover:bg-surface2 hover:text-text",
      )}
    >
      {icon}
      {children}
      {count !== undefined && <span className={cn("text-[12px] font-medium tabular-nums", active ? "opacity-70" : tone === "warn" ? "text-warn" : "text-dim")}>{count}</span>}
    </button>
  );
}

const triggerCls = (on: boolean) =>
  cn(
    "flex h-8 max-w-[220px] items-center gap-1 rounded-ctl px-2 text-[13px] font-semibold transition-colors hover:bg-white/[.06] data-[state=open]:bg-white/[.06]",
    on ? "text-text" : "text-muted hover:text-text",
  );

export function OrgFilterBar({ instanceId, data, total }: { instanceId: string; data: Organize | undefined; total: number }) {
  const t = useT();
  const f = useOrgFilter(instanceId);
  const showTags = useExpert("mod-tags");
  if (!data) return null;
  const own = Math.max(0, total - data.pack_count);
  const setOrigin = (o: Origin) => setOrgFilter(instanceId, { origin: f.origin === o ? "all" : o });
  const group = data.groups.find((g) => g.id === f.group);
  const groupLabel = f.group === "all" ? t("org.filter.group_all") : f.group === GROUP_NONE ? t("org.filter.group_none") : (group?.name ?? t("org.filter.group_all"));
  return (
    <>
      {data.has_pack && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t("org.filter.origin")}>
          <Chip active={f.origin === "pack"} onClick={() => setOrigin("pack")} count={data.pack_count} icon={<Package size={13} />}>
            {t("org.filter.pack")}
          </Chip>
          <Chip active={f.origin === "own"} onClick={() => setOrigin("own")} count={own} icon={<UserRound size={13} />}>
            {t("org.filter.own")}
          </Chip>
        </div>
      )}
      {data.unused_count > 0 && (
        <Chip active={f.unused} tone="warn" onClick={() => setOrgFilter(instanceId, { unused: !f.unused })} count={data.unused_count} icon={<Unlink size={13} />}>
          {t("org.filter.unused")}
        </Chip>
      )}
      {data.groups.length > 0 && (
        <DropdownMenu
          align="start"
          trigger={
            <button className={triggerCls(f.group !== "all")}>
              {group && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: group.color ?? "currentColor" }} />}
              <span className="truncate">{groupLabel}</span>
              <ChevronDown size={13} className="shrink-0 text-dim" />
            </button>
          }
        >
          <DropdownLabel>{t("org.filter.group")}</DropdownLabel>
          <DropdownCheckItem checked={f.group === "all"} onCheckedChange={() => setOrgFilter(instanceId, { group: "all" })}>
            {t("org.filter.group_all")}
          </DropdownCheckItem>
          <DropdownCheckItem checked={f.group === GROUP_NONE} onCheckedChange={() => setOrgFilter(instanceId, { group: GROUP_NONE })}>
            {t("org.filter.group_none")}
          </DropdownCheckItem>
          <DropdownSeparator />
          {data.groups.map((g) => (
            <DropdownCheckItem key={g.id} checked={f.group === g.id} onCheckedChange={() => setOrgFilter(instanceId, { group: g.id })}>
              <span className="flex min-w-0 items-center gap-2">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: g.color ?? "currentColor" }} />
                <span className="max-w-[200px] truncate">{g.name}</span>
                <span className="text-[12px] text-dim">{g.count}</span>
              </span>
            </DropdownCheckItem>
          ))}
        </DropdownMenu>
      )}
      {showTags && data.tags.length > 0 && (
        <DropdownMenu
          align="start"
          trigger={
            <button className={triggerCls(!!f.tag)}>
              <Hash size={13} className="shrink-0" />
              <span className="truncate">{f.tag ?? t("org.filter.tag_all")}</span>
              <ChevronDown size={13} className="shrink-0 text-dim" />
            </button>
          }
        >
          <DropdownLabel>{t("org.filter.tag")}</DropdownLabel>
          <DropdownCheckItem checked={!f.tag} onCheckedChange={() => setOrgFilter(instanceId, { tag: null })}>
            {t("org.filter.tag_all")}
          </DropdownCheckItem>
          <DropdownSeparator />
          <div className="scroll max-h-[280px]">
            {data.tags.map((tag) => (
              <DropdownCheckItem key={tag} checked={f.tag === tag} onCheckedChange={() => setOrgFilter(instanceId, { tag })}>
                #{tag}
              </DropdownCheckItem>
            ))}
          </div>
        </DropdownMenu>
      )}
    </>
  );
}
