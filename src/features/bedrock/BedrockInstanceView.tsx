// Instanzseite für Bedrock: gleicher Kopf wie bei Java (Icon, Name, Spielzeit, Spielen), aber nur Add-ons, Welten
// und Sicherungen – Loader, Java, RAM, Mods und Server-Hosting gibt es hier nicht.
import { useEffect, useState } from "react";
import { getRouteApi } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Archive, Globe2, Package } from "lucide-react";
import { api } from "@/lib/api";
import { qk, useGameState } from "@/lib/queries";
import type { BedrockChannel, BedrockProfile, Instance } from "@/lib/types";
import type { InstanceTab } from "@/app/router";
import { instanceAccent } from "@/lib/format";
import { Button, Dialog, Field, Input, Segmented, Tabs, Textarea, cn, toast } from "@/components/ui";
import { accentVars } from "@/components/instance/accent";
import { useRunPhase } from "@/components/instance/status";
import { useT } from "@/i18n";
import { InstanceHeader } from "@/features/instances/InstanceHeader";
import { bqk, channelStatus, useBedrockStatus } from "./api";
import { AddonsTab } from "./AddonsTab";
import { AddonSearchHost } from "./AddonSearch";
import { BedrockWorldsTab } from "./WorldsTab";
import { BedrockBackupsTab } from "./BackupsTab";
import { BedrockTag, NotInstalledNotice, PendingSwapNotice } from "./parts";

const route = getRouteApi("/instances/$id");
type Area = "addons" | "worlds" | "backups";
const areaOf = (tab: InstanceTab): Area => (tab === "worlds" || tab === "servers" ? "worlds" : tab === "backups" ? "backups" : "addons");
const tabOf: Record<Area, InstanceTab> = { addons: "content", worlds: "worlds", backups: "backups" };

function SettingsDialog({ instance, open, onClose }: { instance: Instance; open: boolean; onClose: () => void }) {
  const t = useT();
  const { phase } = useRunPhase(instance.id);
  const [name, setName] = useState(instance.name);
  const [channel, setChannel] = useState<BedrockChannel>(instance.bedrock?.channel ?? "release");
  const [profile, setProfile] = useState<BedrockProfile>(instance.bedrock?.profile ?? "isolated");
  const [notes, setNotes] = useState(instance.notes ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName(instance.name);
    setChannel(instance.bedrock?.channel ?? "release");
    setProfile(instance.bedrock?.profile ?? "isolated");
    setNotes(instance.notes ?? "");
  }, [open, instance]);
  const locked = phase !== "idle";
  const changedData = channel !== instance.bedrock?.channel || profile !== instance.bedrock?.profile;
  const save = async () => {
    setBusy(true);
    try {
      await api.instanceUpdate(instance.id, { name: name.trim(), notes: notes.trim() || null, bedrock: { channel, profile } });
      onClose();
    } catch (e) {
      toast.error(e, t("bedrock.settings.failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t("bedrock.settings.title")}
      size="md"
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" loading={busy} disabled={!name.trim() || (changedData && locked)} onClick={() => void save()}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t("newinst.name")}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={64} />
        </Field>
        <Field label={t("bedrock.new.channel")}>
          <Segmented
            value={channel}
            onChange={setChannel}
            items={[
              { value: "release", label: t("bedrock.channel.release"), disabled: locked },
              { value: "preview", label: t("bedrock.channel.preview"), disabled: locked },
            ]}
          />
        </Field>
        <Field label={t("bedrock.new.profile")} hint={profile === "isolated" ? t("bedrock.profile.isolated_text") : t("bedrock.profile.shared_text")}>
          <Segmented
            value={profile}
            onChange={setProfile}
            items={[
              { value: "isolated", label: t("bedrock.profile.isolated"), disabled: locked },
              { value: "shared", label: t("bedrock.profile.shared"), disabled: locked },
            ]}
          />
        </Field>
        {changedData && <p className="rounded-card bg-surface2 px-3 py-2.5 text-[12.5px] text-muted">{t("bedrock.settings.data_hint")}</p>}
        <Field label={t("bedrock.settings.notes")}>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </Field>
      </div>
    </Dialog>
  );
}

export function BedrockInstanceView({ inst, tab }: { inst: Instance; tab: InstanceTab }) {
  const t = useT();
  const nav = route.useNavigate();
  const qc = useQueryClient();
  const area = areaOf(tab);
  const accent = instanceAccent(inst.id, inst.accent);
  const status = useBedrockStatus();
  const channel = inst.bedrock?.channel ?? "release";
  const cs = channelStatus(status.data, channel);
  const game = useGameState(inst.id);
  const { phase } = useRunPhase(inst.id);
  const [settings, setSettings] = useState(false);

  // `?tab=settings` (Menüs, alte Links) -> Einstellungen öffnen
  useEffect(() => {
    if (tab !== "settings") return;
    setSettings(true);
    nav({ search: { tab: "content" }, replace: true });
  }, [tab, nav]);

  // Nach dem Spielen (Profil zurückgetauscht) Listen und Status neu laden
  const st = game?.state;
  useEffect(() => {
    qc.invalidateQueries({ queryKey: ["content", inst.id] });
    qc.invalidateQueries({ queryKey: bqk.status });
    qc.invalidateQueries({ queryKey: qk.instance(inst.id) });
  }, [st, qc, inst.id]);

  return (
    <div className="flex h-full flex-col" style={accentVars(accent)}>
      <InstanceHeader
        instance={inst}
        accent={accent}
        settingsActive={settings}
        onSettings={() => setSettings(true)}
        badge={<BedrockTag instance={inst} />}
        tabs={
          <Tabs<Area>
            value={area}
            onChange={(a) => nav({ search: { tab: tabOf[a] }, replace: true })}
            className="-mx-3 h-11! gap-1 border-b-0"
            items={[
              { value: "addons", label: t("bedrock.tab.addons"), icon: <Package size={15} /> },
              { value: "worlds", label: t("ipage.tab.worlds"), icon: <Globe2 size={15} /> },
              { value: "backups", label: t("bedrock.tab.backups"), icon: <Archive size={15} /> },
            ]}
          />
        }
        notices={
          (cs && !cs.installed && !status.data?.blocked) || cs?.active_instance ? (
            <div className={cn("flex flex-col gap-2 px-6 pt-3")}>
              {cs && !cs.installed && <NotInstalledNotice channel={channel} />}
              <PendingSwapNotice status={status.data} channel={channel} running={phase !== "idle"} />
            </div>
          ) : status.data?.blocked ? (
            <div className="px-6 pt-3">
              <div className="rounded-card bg-danger/[.08] px-4 py-3 text-[12.5px] text-muted">{status.data.blocked}</div>
            </div>
          ) : null
        }
      />
      <div className="relative min-h-0 flex-1">
        {area === "addons" ? <AddonsTab instance={inst} /> : area === "worlds" ? <BedrockWorldsTab instance={inst} /> : <BedrockBackupsTab instance={inst} />}
      </div>
      <SettingsDialog instance={inst} open={settings} onClose={() => setSettings(false)} />
      <AddonSearchHost />
    </div>
  );
}
