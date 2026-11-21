import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, FolderOpen, KeyRound, Usb } from "lucide-react";
import { useState } from "react";
import { Button, SettingRow, SettingsCard, Switch, confirm, toast } from "@/components/ui";
import { openExternal } from "@/components/content/util";
import { Term } from "@/features/help/glossary/Term";
import { useT } from "@/i18n";
import { api } from "@/lib/api";
import { portableApi, portableKey, usePortable, type PortableStatus } from "./api";

async function pickFolder(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const r = await open({ directory: true, multiple: false });
  return typeof r === "string" ? r : null;
}

function CreateCopyRow() {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const create = async () => {
    try {
      const dir = await pickFolder();
      if (!dir) return;
      setBusy(true);
      const r = await portableApi.createCopy(dir);
      toast.success(t(r.updated ? "portable.updated" : "portable.created", { dir: r.dir }));
      api.openPath(r.dir).catch(() => {});
    } catch (e) {
      toast.error(e, t("portable.create_failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingRow
      icon={<Usb size={18} className="text-brand" />}
      title={t("portable.off.title")}
      description={
        <>
          {t("portable.off.desc")}
          <span className="mt-1 block text-dim">{t("portable.how")}</span>
        </>
      }
    >
      <Button size="sm" icon={<Usb size={13} />} loading={busy} onClick={() => void create()}>
        {t("portable.create")}
      </Button>
    </SettingRow>
  );
}

function ActiveRows({ p }: { p: PortableStatus }) {
  const t = useT();
  const qc = useQueryClient();
  const [forgetting, setForgetting] = useState(false);
  const setForget = async (on: boolean) => {
    try {
      qc.setQueryData(portableKey, await portableApi.setForget(on));
    } catch (e) {
      toast.error(e);
    }
  };
  const forgetNow = async () => {
    const ok = await confirm({ title: t("portable.forget_confirm.title"), text: t("portable.forget_confirm.text"), confirmLabel: t("portable.forget_now"), danger: true });
    if (!ok) return;
    setForgetting(true);
    try {
      const n = await portableApi.forgetHere();
      toast.success(t("portable.forget_done", { n }));
    } catch (e) {
      toast.error(e);
    } finally {
      setForgetting(false);
    }
  };
  return (
    <>
      <SettingRow
        icon={<Usb size={18} className="text-brand" />}
        title={t("portable.on.title")}
        description={
          <>
            {t("portable.on.desc")}
            <span className="selectable mt-1 block break-all font-mono text-[11px]">{p.root}</span>
          </>
        }
      >
        <Button size="sm" icon={<FolderOpen size={13} />} onClick={() => api.openPath(p.root).catch((e) => toast.error(e))}>
          {t("portable.open")}
        </Button>
      </SettingRow>
      <SettingRow icon={<KeyRound size={18} className="text-muted" />} title={t("portable.vault.title")} description={t("portable.vault.desc")}>
        <Button size="sm" variant="danger" loading={forgetting} onClick={() => void forgetNow()}>
          {t("portable.forget_now")}
        </Button>
      </SettingRow>
      <SettingRow title={t("portable.forget_exit")} description={t("portable.forget_exit.desc")}>
        <Switch checked={p.forget_on_exit} onChange={(on) => void setForget(on)} label={t("portable.forget_exit")} />
      </SettingRow>
      <SettingRow title={t("portable.updates")} description={t("portable.updates.desc")}>
        <Button size="sm" icon={<ExternalLink size={13} />} onClick={() => void openExternal(p.releases_url)}>
          {t("portable.download")}
        </Button>
      </SettingRow>
    </>
  );
}

export function PortableCard() {
  const t = useT();
  const q = usePortable();
  if (!q.data) return null;
  return (
    <SettingsCard id="set-portable" title={t("portable.title")} right={<Term id="portable" className="text-[12px] text-dim">{t("portable.term")}</Term>}>
      {q.data.active ? <ActiveRows p={q.data} /> : <CreateCopyRow />}
    </SettingsCard>
  );
}
