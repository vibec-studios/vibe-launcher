import { Info } from "lucide-react";
import { Button, Dialog, cn } from "@/components/ui";
import { useT } from "@/i18n";

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <span className="w-24 shrink-0 text-meta text-dim">{label}</span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-text">{children}</span>
    </div>
  );
}

export function Notice({ tone, icon, title, children }: { tone: "warn" | "danger" | "muted"; icon: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-card bg-surface px-3 py-2.5">
      <span className={cn("mt-0.5 shrink-0", tone === "warn" ? "text-warn" : tone === "danger" ? "text-danger" : "text-dim")}>{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-text">{title}</p>
        {children}
      </div>
    </div>
  );
}

export function Shell({
  title,
  children,
  confirm,
  onConfirm,
  onClose,
  disabled,
  retry,
  closeLabel,
}: {
  title: string;
  children: React.ReactNode;
  confirm?: string;
  onConfirm?: () => void;
  onClose: () => void;
  disabled?: boolean;
  retry?: () => void;
  closeLabel?: string;
}) {
  const t = useT();
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={title}
      description={t("play.source_hint")}
      size="md"
      footer={
        <>
          <span className="mr-auto flex items-center gap-1.5 text-caption text-dim">
            <Info size={12} />
            {t("play.footer")}
          </span>
          {retry && (
            <Button variant="subtle" onClick={retry}>
              {t("common.retry")}
            </Button>
          )}
          <Button variant="subtle" onClick={onClose}>
            {closeLabel ?? (confirm ? t("common.cancel") : t("common.close"))}
          </Button>
          {confirm && onConfirm && (
            <Button variant="primary" onClick={onConfirm} disabled={disabled} autoFocus>
              {confirm}
            </Button>
          )}
        </>
      }
    >
      {children}
    </Dialog>
  );
}
