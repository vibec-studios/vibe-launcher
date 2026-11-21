import { Check } from "lucide-react";
import { useState } from "react";
import { Button, Dialog, Field, Input, cn, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { organizeApi, setOrganize, type OrgGroup, type Target } from "./api";
import { GROUP_COLORS } from "./filter";

export function GroupDialog({ instanceId, group, targets, onClose }: { instanceId: string; group?: OrgGroup; targets?: Target[]; onClose: () => void }) {
  const t = useT();
  const [name, setName] = useState(group?.name ?? "");
  const [color, setColor] = useState<string | null>(group?.color ?? GROUP_COLORS[0]);
  const [busy, setBusy] = useState(false);
  const n = targets?.length ?? 0;

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const d = await organizeApi.saveGroup(instanceId, group?.id ?? null, name, color, targets ?? []);
      setOrganize(instanceId, d);
      toast.success(group ? t("org.group.renamed", { name: name.trim() }) : n ? t("org.group.created_n", { name: name.trim(), n }) : t("org.group.created", { name: name.trim() }));
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={group ? t("org.group.edit_title") : t("org.group.new_title")}
      description={group ? undefined : n ? t("org.group.new_text_n", { n }) : t("org.group.new_text")}
      size="md"
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="accent" loading={busy} disabled={!name.trim()} onClick={() => void submit()}>
            {group ? t("common.save") : t("org.group.create")}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4 pb-1"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label={t("org.group.name")} hint={t("org.group.name_hint")}>
          <Input autoFocus value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder={t("org.group.name_ph")} />
        </Field>
        <Field label={t("org.group.color")}>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("org.group.color")}>
            {GROUP_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={c}
                onClick={() => setColor(c)}
                className={cn("grid h-8 w-8 place-items-center rounded-full transition-transform hover:scale-110", color === c && "ring-2 ring-text ring-offset-2 ring-offset-[var(--overlay,transparent)]")}
                style={{ background: c }}
              >
                {color === c && <Check size={15} strokeWidth={3} className="text-white" />}
              </button>
            ))}
          </div>
        </Field>
      </form>
    </Dialog>
  );
}
