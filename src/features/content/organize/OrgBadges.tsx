import { Link2, Unlink, UserRound } from "lucide-react";
import { memo } from "react";
import { Tag, Tooltip } from "@/components/ui";
import { useT } from "@/i18n";
import { useExpert } from "@/lib/simple-mode";
import type { OrgGroup, OrgItem } from "./api";

function names(list: string[], more: (n: number) => string) {
  if (list.length <= 3) return list.join(", ");
  return `${list.slice(0, 3).join(", ")} ${more(list.length - 3)}`;
}

export const OrgBadges = memo(function OrgBadges({ info, group, hasPack }: { info?: OrgItem; group?: OrgGroup; hasPack?: boolean }) {
  const t = useT();
  const showTags = useExpert("mod-tags");
  if (!info) return null;
  const tip = (text: string) => <span className="block max-w-[280px] leading-snug">{text}</span>;
  return (
    <>
      {group && (
        <Tag className="shrink-0" color={group.color ?? undefined}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: group.color ?? "currentColor" }} />
          <span className="max-w-[120px] truncate">{group.name}</span>
        </Tag>
      )}
      {hasPack && !info.from_pack && (
        <Tooltip content={tip(t("org.badge.own_tip"))}>
          <span className="shrink-0">
            <Tag className="text-accent">
              <UserRound size={11} />
              {t("org.badge.own")}
            </Tag>
          </span>
        </Tooltip>
      )}
      {info.auto && info.unused && (
        <Tooltip content={tip(t("org.badge.unused_tip"))}>
          <span className="shrink-0">
            <Tag className="bg-warn/15 text-warn">
              <Unlink size={11} />
              {t("org.badge.unused")}
            </Tag>
          </span>
        </Tooltip>
      )}
      {info.auto && !info.unused && (
        <Tooltip content={tip(info.needed_by.length ? t("org.badge.dep_tip", { names: names(info.needed_by, (n) => t("org.badge.more", { n })) }) : t("org.badge.dep_tip_generic"))}>
          <span className="shrink-0">
            <Tag>
              <Link2 size={11} />
              {t("org.badge.dep")}
            </Tag>
          </span>
        </Tooltip>
      )}
      {showTags &&
        info.tags.slice(0, 2).map((tag) => (
          <Tag key={tag} className="hidden shrink-0 @min-[760px]:inline-flex">
            #{tag}
          </Tag>
        ))}
      {showTags && info.tags.length > 2 && (
        <Tooltip content={info.tags.slice(2).map((x) => `#${x}`).join(" ")}>
          <span className="hidden shrink-0 text-[11px] text-dim @min-[760px]:inline">+{info.tags.length - 2}</span>
        </Tooltip>
      )}
    </>
  );
});
