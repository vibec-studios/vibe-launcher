import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe, Laptop, ShieldAlert, Smartphone, Trash2 } from "lucide-react";
import { Button, Dialog, Input, SettingRow, SettingsCard, Skeleton, Tag, confirm, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { formatRelative } from "@/lib/format";
import type { DeviceSession } from "@/lib/vibe-sdk";
import { VibeError } from "@/lib/vibe-sdk";
import { errText, requireClient, useSocial } from "@/features/social/service";

const CODE_RE = /^[2-9A-HJ-NP-Z]{8}$/;
const sessionsKey = ["vibe", "sessions"] as const;

export function normCode(v: string) {
  return v.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 8);
}

function deviceIcon(s: DeviceSession) {
  if (s.client.platform === "web-companion") return /android|iphone|ipad|mobile/i.test(s.client.name) ? <Smartphone size={16} /> : <Globe size={16} />;
  return <Laptop size={16} />;
}

function ApproveDialog({ code, onClose, onDone }: { code: string | null; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const approve = async () => {
    if (!code) return;
    setBusy(true);
    try {
      await requireClient().approveDevicePairing(code);
      toast.success(t("companion.approved"), t("companion.approved_text"));
      onDone();
    } catch (e) {
      toast.error(e instanceof VibeError && e.status === 404 ? t("companion.err.code") : e instanceof VibeError && e.status === 403 ? t("companion.err.forbidden") : errText(e), t("companion.err.title"));
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={!!code}
      onOpenChange={(o) => !o && onClose()}
      size="md"
      locked={busy}
      title={t("companion.confirm.title")}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" loading={busy} onClick={approve}>
            {t("companion.confirm.ok")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 pb-2">
        <div className="flex gap-3 rounded-card bg-warn/10 px-4 py-3">
          <ShieldAlert size={18} className="mt-0.5 shrink-0 text-warn" />
          <p className="text-[13px] leading-relaxed text-text">{t("companion.confirm.warn")}</p>
        </div>
        <p className="text-[12.5px] leading-relaxed text-muted">{t("companion.confirm.access")}</p>
        <p className="text-center font-mono text-[22px] font-semibold tracking-[0.3em] text-text">
          {code?.slice(0, 4)}-{code?.slice(4)}
        </p>
        <p className="text-[12px] leading-relaxed text-dim">{t("companion.confirm.only_you")}</p>
      </div>
    </Dialog>
  );
}

function Sessions() {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: sessionsKey, queryFn: () => requireClient().auth.sessions(), staleTime: 15_000 });
  const revoke = async (s: DeviceSession) => {
    const ok = await confirm({ title: t("companion.revoke.title"), text: t("companion.revoke.text", { name: s.client.name }), confirmLabel: t("companion.revoke"), danger: true });
    if (!ok) return;
    try {
      await requireClient().auth.revokeSession(s.id);
      qc.setQueryData<DeviceSession[]>(sessionsKey, (l) => l?.filter((x) => x.id !== s.id));
      toast.success(t("companion.revoked"));
    } catch (e) {
      toast.error(errText(e));
    }
  };
  if (!q.data)
    return (
      <div className="px-4 py-3">{q.isError ? <p className="text-[12.5px] text-dim">{errText(q.error)}</p> : <Skeleton className="h-4 w-56" />}</div>
    );
  const list = [...q.data].sort((a, b) => Number(b.current) - Number(a.current) || Date.parse(b.lastUsedAt) - Date.parse(a.lastUsedAt));
  return (
    <>
      {list.map((s) => (
        <SettingRow
          key={s.id}
          icon={<span className="grid h-8 w-8 place-items-center rounded-ctl bg-surface2 text-muted">{deviceIcon(s)}</span>}
          title={
            <span className="flex items-center gap-2">
              {s.client.platform === "web-companion" ? t("companion.web") : s.client.name}
              {s.current && <Tag color="var(--color-ok)">{t("companion.this_device")}</Tag>}
            </span>
          }
          description={t("companion.last_used", { when: formatRelative(s.lastUsedAt), since: formatRelative(s.createdAt) })}
        >
          {!s.current && (
            <Button size="sm" variant="danger" icon={<Trash2 size={13} />} onClick={() => void revoke(s)}>
              {t("companion.revoke")}
            </Button>
          )}
        </SettingRow>
      ))}
    </>
  );
}

export function DevicesCard() {
  const t = useT();
  const qc = useQueryClient();
  const linked = useSocial((s) => s.linked);
  const [code, setCode] = useState("");
  const [confirmCode, setConfirmCode] = useState<string | null>(null);
  if (!linked) return null;
  const ok = CODE_RE.test(code);
  return (
    <SettingsCard title={t("companion.title")}>
      <SettingRow title={t("companion.pair")} description={t("companion.pair.desc")} stacked>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (ok) setConfirmCode(code);
          }}
        >
          <div className="w-[220px]">
            <Input
              value={code.length > 4 ? `${code.slice(0, 4)}-${code.slice(4)}` : code}
              onChange={(e) => setCode(normCode(e.target.value))}
              placeholder="ABCD-2345"
              aria-label={t("companion.code")}
              className="font-mono tracking-[0.15em]"
              invalid={code.length === 8 && !ok}
            />
          </div>
          <Button type="submit" variant="primary" disabled={!ok}>
            {t("companion.pair.go")}
          </Button>
        </form>
        {code.length === 8 && !ok && <p className="mt-1.5 text-[12px] text-danger">{t("companion.err.format")}</p>}
      </SettingRow>
      <div className="border-t border-line px-4 pb-1 pt-3 text-[12px] font-semibold text-muted">{t("companion.devices")}</div>
      <Sessions />
      <ApproveDialog
        code={confirmCode}
        onClose={() => setConfirmCode(null)}
        onDone={() => {
          setConfirmCode(null);
          setCode("");
          void qc.invalidateQueries({ queryKey: sessionsKey });
        }}
      />
    </SettingsCard>
  );
}
