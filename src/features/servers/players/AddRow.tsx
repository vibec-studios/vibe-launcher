import { useState } from "react";
import { Plus } from "lucide-react";
import { Button, Input, cn } from "@/components/ui";
import { useT } from "@/i18n";

export function AddRow({ placeholder, onAdd, withReason, mono }: { placeholder: string; onAdd: (name: string, reason: string | null) => Promise<boolean>; withReason?: boolean; mono?: boolean }) {
  const t = useT();
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    if (await onAdd(n, reason.trim() || null)) {
      setName("");
      setReason("");
    }
    setBusy(false);
  };
  return (
    <form
      className="mb-2 flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Input className={cn("flex-1", mono && "font-mono text-[13px]")} value={name} placeholder={placeholder} maxLength={64} onChange={(e) => setName(e.target.value)} />
      {withReason && <Input className="flex-1" value={reason} placeholder={t("srv.players.reason")} maxLength={120} onChange={(e) => setReason(e.target.value)} />}
      <Button type="submit" icon={<Plus size={14} />} disabled={!name.trim()} loading={busy}>
        {t("srv.players.add")}
      </Button>
    </form>
  );
}
