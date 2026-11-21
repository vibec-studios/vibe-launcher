import { useState } from "react";
import type { ServerEntry } from "@/lib/types";
import { Button, Dialog, Field, Input, Select } from "@/components/ui";
import { useT } from "@/i18n";

export function EditDialog({ entry, onSave, onClose }: { entry: ServerEntry; onSave: (e: ServerEntry) => void; onClose: () => void }) {
  const t = useT();
  const [name, setName] = useState(entry.name);
  const [ip, setIp] = useState(entry.ip);
  const [tex, setTex] = useState<"prompt" | "enabled" | "disabled">(entry.accept_textures == null ? "prompt" : entry.accept_textures ? "enabled" : "disabled");
  const valid = ip.trim().length > 0 && /^[A-Za-z0-9.\-_:[\]]+$/.test(ip.trim());
  const save = () =>
    valid && onSave({ ...entry, name: name.trim() || t("servers.default_name"), ip: ip.trim(), accept_textures: tex === "prompt" ? null : tex === "enabled" });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={entry.ip ? t("servers.edit") : t("servers.add")}
      size="sm"
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" disabled={!valid} onClick={save}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div
        className="flex flex-col gap-4"
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.target instanceof HTMLInputElement) save();
        }}
      >
        <Field label={t("servers.name")}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("servers.default_name")} maxLength={64} autoFocus />
        </Field>
        <Field label={t("servers.address")} error={ip && !valid ? t("servers.address_invalid") : undefined}>
          <Input className="font-mono" value={ip} onChange={(e) => setIp(e.target.value)} placeholder="play.example.net" maxLength={255} />
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="label">{t("servers.resourcepacks")}</span>
          <Select
            value={tex}
            onChange={(v) => setTex(v as typeof tex)}
            options={[
              { value: "prompt", label: t("servers.rp.prompt") },
              { value: "enabled", label: t("servers.rp.enabled") },
              { value: "disabled", label: t("servers.rp.disabled") },
            ]}
          />
        </div>
      </div>
    </Dialog>
  );
}
