import { useState } from "react";
import { Send } from "lucide-react";
import { Button, Dialog, Field, Input, Select, Textarea, Tag, toast } from "@/components/ui";
import { ServerStatusLine } from "@/components/instance/motd";
import { useT } from "@/i18n";
import { formatRelative } from "@/lib/format";
import type { DiscoveryCategory } from "@/lib/vibe-sdk";
import { VibeError } from "@/lib/vibe-sdk";
import { errText } from "@/features/social/service";
import { CATEGORIES, submitServer, useMySubmissions } from "./api";
import { validAddress } from "./match";

export function SubmitDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<DiscoveryCategory>("survival");
  const [check, setCheck] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const addrOk = validAddress(address);
  const ok = name.trim().length > 0 && addrOk && description.trim().length > 0;

  const reset = () => {
    setName("");
    setAddress("");
    setDescription("");
    setCheck(null);
  };
  const send = async () => {
    setBusy(true);
    try {
      await submitServer({ name: name.trim(), address: address.trim(), description: description.trim(), category });
      toast.success(t("discovery.submit.sent"), t("discovery.submit.sent_text"));
      reset();
      onClose();
    } catch (e) {
      toast.error(e instanceof VibeError && e.code === "conflict" ? t("discovery.submit.conflict") : errText(e), t("discovery.submit.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      locked={busy}
      title={t("discovery.submit.title")}
      description={t("discovery.submit.desc")}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" icon={<Send size={14} />} loading={busy} disabled={!ok} onClick={send}>
            {t("discovery.submit.send")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        <div className="grid grid-cols-2 gap-4 max-[700px]:grid-cols-1">
          <Field label={t("discovery.submit.name")}>
            <Input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder={t("discovery.submit.name_ph")} />
          </Field>
          <Field label={t("discovery.submit.category")}>
            <Select<DiscoveryCategory> value={category} onChange={setCategory} options={CATEGORIES.map((c) => ({ value: c, label: t(`discovery.cat.${c}`) }))} />
          </Field>
        </div>
        <Field label={t("discovery.submit.address")} hint={t("discovery.submit.address_hint")} error={address && !addrOk ? t("discovery.submit.address_bad") : undefined}>
          <div className="flex gap-2">
            <Input value={address} maxLength={260} onChange={(e) => (setAddress(e.target.value), setCheck(null))} placeholder="play.example.net" className="flex-1" />
            <Button disabled={!addrOk} onClick={() => setCheck(address.trim())}>
              {t("discovery.submit.check")}
            </Button>
          </div>
        </Field>
        {check && <ServerStatusLine address={check} className="rounded-card bg-surface px-4 py-3" />}
        <Field label={t("discovery.submit.description")} hint={t("discovery.submit.description_hint")}>
          <Textarea value={description} maxLength={1000} rows={4} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <p className="text-[12px] leading-relaxed text-dim">{t("discovery.submit.rules")}</p>
      </div>
    </Dialog>
  );
}

export function MySubmissionsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const q = useMySubmissions(open);
  const list = q.data?.submissions ?? [];
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} size="md" title={t("discovery.mine.title")} description={t("discovery.mine.desc")} footer={<Button onClick={onClose}>{t("common.close")}</Button>}>
      {!q.data ? (
        <p className="py-6 text-center text-[13px] text-dim">{q.isError ? errText(q.error) : t("discovery.ping.loading")}</p>
      ) : list.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-muted">{t("discovery.mine.empty")}</p>
      ) : (
        <ul className="flex flex-col pb-2">
          {list.map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-2.5 [&+&]:border-t [&+&]:border-line">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-medium text-text">{s.name}</p>
                <p className="truncate text-[12px] text-dim">
                  {s.address} · {formatRelative(s.createdAt)}
                </p>
              </div>
              <Tag color={s.status === "approved" ? "var(--color-ok)" : s.status === "rejected" ? "var(--color-danger)" : undefined}>{t(`discovery.status.${s.status}`)}</Tag>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
