import { useState, type ReactNode } from "react";
import { Button, Dialog } from "@/components/ui";
import { Term } from "@/features/help/glossary/Term";
import { useT } from "@/i18n";
import type { ContentItem } from "@/lib/types";
import { orgItemKey, type RemovalExtra } from "./api";
import { DepChecklist } from "./DepChecklist";

export function RemoveDialog({
  title,
  text,
  extras,
  items,
  onDone,
}: {
  title: ReactNode;
  text: ReactNode;
  extras: RemovalExtra[];
  items: ContentItem[];
  onDone: (v: RemovalExtra[] | null) => void;
}) {
  const t = useT();
  const key = (e: RemovalExtra) => orgItemKey(e.kind, e.file_name);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(extras.map(key)));
  const icons = new Map(items.map((i) => [orgItemKey(i.kind, i.file_name), i.icon]));
  const chosen = extras.filter((e) => picked.has(key(e)));
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onDone(null)}
      title={title}
      description={text}
      size="md"
      footer={
        <>
          <Button variant="subtle" onClick={() => onDone(null)}>
            {t("common.cancel")}
          </Button>
          <Button variant="danger" autoFocus onClick={() => onDone(chosen)}>
            {chosen.length ? t("org.remove.with_deps", { n: chosen.length }) : t("common.remove")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 pb-1">
        <p className="text-[13px] leading-relaxed text-muted">
          {t(extras.length === 1 ? "org.remove.deps_intro_a1" : "org.remove.deps_intro_a")} <Term id="dependency">{t(extras.length === 1 ? "org.dep.one" : "org.dep.many")}</Term> {t(extras.length === 1 ? "org.remove.deps_intro_b1" : "org.remove.deps_intro_b")}
        </p>
        <DepChecklist
          rows={extras.map((e) => ({ key: key(e), name: e.name, icon: icons.get(key(e)), detail: t("org.remove.deps_detail"), enabled: e.enabled }))}
          picked={picked}
          onChange={setPicked}
        />
        <p className="text-[12px] text-dim">{t("org.remove.deps_hint")}</p>
      </div>
    </Dialog>
  );
}
