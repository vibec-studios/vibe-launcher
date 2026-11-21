import type { SnapshotInfo } from "@/lib/types";
import { useT } from "@/i18n";
import { Skeleton, Tag, Tooltip } from "@/components/ui";
import { useScopeList } from "../FixBackupPicker";

export function AutoTag() {
  const t = useT();
  return (
    <Tooltip content={t("backups.auto_hint")}>
      <span>
        <Tag color="#5aa9ff">{t("backups.auto")}</Tag>
      </span>
    </Tooltip>
  );
}

/** Teil-Snapshot: nur einige Bereiche gesichert (Wiederherstellen lässt den Rest in Ruhe). */
export function PartialTag({ scopes }: { scopes: NonNullable<SnapshotInfo["scopes"]> }) {
  const t = useT();
  const list = useScopeList();
  return (
    <Tooltip content={t("backups.partial_hint", { areas: list(scopes) })}>
      <span>
        <Tag color="#e0a33f">{t("backups.partial")}</Tag>
      </span>
    </Tooltip>
  );
}

/** Abschnittskopf: Titel + kurze Erklärung links, Aktionen rechts. */
export function SectionHead({ title, desc, actions }: { title: string; desc: string; actions?: React.ReactNode }) {
  return (
    <div className="flex items-end gap-3 px-6 pb-2">
      <div className="min-w-0 flex-1">
        <h3 className="text-section text-text">{title}</h3>
        <p className="text-[12.5px] text-muted">{desc}</p>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
  );
}

/** Kompakter Leerzustand innerhalb eines Abschnitts (statt zwei riesiger, zentrierter Leerzustände untereinander). */
export function SectionEmpty({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="mx-6 mt-1 flex items-center gap-3.5 rounded-card border border-dashed border-line2 px-4 py-3.5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-ctl bg-surface2 text-dim">{icon}</span>
      <div className="min-w-0">
        <div className="text-[13.5px] font-semibold text-text">{title}</div>
        <div className="text-[12.5px] text-muted">{text}</div>
      </div>
    </div>
  );
}

export function RowSkeleton() {
  return (
    <div className="flex h-12 items-center gap-3 px-6">
      <Skeleton className="h-4 w-4" />
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-3 w-32" />
      </div>
    </div>
  );
}
