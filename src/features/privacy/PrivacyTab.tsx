import { BookOpen, Check, Cloud, FolderOpen } from "lucide-react";
import { Button, SettingRow, SettingsCard, Switch, Tag, toast } from "@/components/ui";
import { openHelp } from "@/features/help/store";
import { Term } from "@/features/help/glossary/Term";
import { setSettingsTab } from "@/features/settings/store";
import { useT } from "@/i18n";
import { api } from "@/lib/api";
import { useSystemInfo } from "@/lib/queries";
import type { Settings } from "@/lib/types";
import { FLOW_GROUPS, FLOWS, type Flow } from "./flows";
import { FeedPrivacyRow } from "@/features/feed/FeedPrivacyRow";

type Update = (p: Partial<Settings>, delay?: number) => void;

const PROMISES = ["ads", "telemetry", "optin", "bundle", "tokens"] as const;

function PromiseCard() {
  const t = useT();
  return (
    <SettingsCard
      title={t("privacy.promise.title")}
      right={
        <Button size="sm" variant="subtle" icon={<BookOpen size={13} />} onClick={() => openHelp("privacy")}>
          {t("privacy.promise.more")}
        </Button>
      }
    >
      <ul className="flex flex-col gap-2.5 px-4 py-3.5">
        {PROMISES.map((k) => (
          <li key={k} className="flex gap-2.5 text-[13.5px] leading-relaxed text-text">
            <Check size={16} className="mt-0.5 shrink-0 text-ok" />
            <span>{k === "telemetry" ? <TelemetryText /> : t(`privacy.promise.${k}`)}</span>
          </li>
        ))}
      </ul>
    </SettingsCard>
  );
}

function TelemetryText() {
  const t = useT();
  const text = t("privacy.promise.telemetry");
  const word = t("privacy.telemetry_word");
  const i = text.indexOf(word);
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <Term id="telemetry">{word}</Term>
      {text.slice(i + word.length)}
    </>
  );
}

function Switches({ s, update }: { s: Settings; update: Update }) {
  const t = useT();
  const v = s.vibe;
  return (
    <SettingsCard title={t("privacy.switches.title")}>
      <SettingRow icon={<Cloud size={18} className={v.enabled ? "text-brand" : "text-dim"} />} title={t("privacy.sw.vibe")} description={t(v.enabled ? "privacy.sw.vibe.on" : "privacy.sw.vibe.off")}>
        <Button size="sm" onClick={() => setSettingsTab("vibe")}>
          {t("privacy.sw.vibe.open")}
        </Button>
      </SettingRow>
      {v.enabled && (
        <SettingRow title={t("privacy.sw.presence")} description={t("privacy.sw.presence.desc")}>
          <Switch checked={v.presence} onChange={(presence) => update({ vibe: { ...v, presence } })} label={t("privacy.sw.presence")} />
        </SettingRow>
      )}
      {v.enabled && v.social && <FeedPrivacyRow />}
      <SettingRow title={t("privacy.sw.updates")} description={t("privacy.sw.updates.desc")}>
        <Switch checked={s.check_updates} onChange={(check_updates) => update({ check_updates })} label={t("privacy.sw.updates")} />
      </SettingRow>
      <SettingRow title={t("privacy.sw.discord")} description={t("privacy.sw.discord.desc")}>
        <Switch checked={s.discord_rpc} onChange={(discord_rpc) => update({ discord_rpc })} label={t("privacy.sw.discord")} />
      </SettingRow>
      {s.discord_rpc && (
        <SettingRow title={t("privacy.sw.discord_details")} description={t("privacy.sw.discord_details.desc")}>
          <Switch checked={s.discord_details} onChange={(discord_details) => update({ discord_details })} label={t("privacy.sw.discord_details")} />
        </SettingRow>
      )}
      <SettingRow title={t("privacy.sw.capes")} description={t("privacy.sw.capes.desc")}>
        <Switch checked={s.minecraftcapes} onChange={(minecraftcapes) => update({ minecraftcapes })} label={t("privacy.sw.capes")} />
      </SettingRow>
    </SettingsCard>
  );
}

function FlowRow({ f }: { f: Flow }) {
  const t = useT();
  const k = `privacy.f.${f.id}`;
  return (
    <div className="flex flex-col gap-1.5 border-line px-4 py-3 [&+&]:border-t">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[13.5px] font-medium text-text">{t(k)}</span>
        {f.hosts.map((h) => (
          <Tag key={h} className="font-mono">
            {h}
          </Tag>
        ))}
      </div>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[12.5px] leading-relaxed">
        <dt className="text-dim">{t("privacy.col.what")}</dt>
        <dd className="text-muted">{t(`${k}.what`)}</dd>
        <dt className="text-dim">{t("privacy.col.when")}</dt>
        <dd className="text-muted">{t(`${k}.when`)}</dd>
        {(f.switchKey || f.group === "auto" || f.group === "images") && (
          <>
            <dt className="text-dim">{t("privacy.col.switch")}</dt>
            <dd className="text-muted">{f.switchKey ? t(f.switchKey) : t("privacy.none")}</dd>
          </>
        )}
      </dl>
    </div>
  );
}

function Flows() {
  const t = useT();
  return (
    <>
      <header data-tour="privacy-flows" className="-mb-2 flex flex-col gap-1 px-1 pt-2">
        <h3 className="text-section text-text">{t("privacy.flows.title")}</h3>
        <p className="text-[12.5px] leading-relaxed text-muted">{t("privacy.flows.lead")}</p>
      </header>
      {FLOW_GROUPS.map((g) => (
        <SettingsCard key={g} title={t(`privacy.group.${g}`)}>
          {FLOWS.filter((f) => f.group === g).map((f) => (
            <FlowRow key={f.id} f={f} />
          ))}
        </SettingsCard>
      ))}
    </>
  );
}

function Local() {
  const t = useT();
  const sys = useSystemInfo();
  return (
    <SettingsCard title={t("privacy.local.title")}>
      <SettingRow
        title={t("privacy.local.data")}
        description={
          <>
            {t("privacy.local.data.desc")}
            <span className="selectable mt-0.5 block break-all font-mono text-[11px]">{sys.data?.data_dir ?? "…"}</span>
          </>
        }
      >
        <Button size="sm" icon={<FolderOpen size={13} />} onClick={() => api.openDataDir().catch((e) => toast.error(e))}>
          {t("common.open_folder")}
        </Button>
      </SettingRow>
      <SettingRow title={t("privacy.local.vault")} description={t("privacy.local.vault.desc")} />
      <SettingRow title={t("privacy.local.webview")} description={t("privacy.local.webview.desc")} />
      <SettingRow title={t("privacy.local.registry")} description={t("privacy.local.registry.desc")} />
    </SettingsCard>
  );
}

export function PrivacyTab({ s, update }: { s: Settings; update: Update }) {
  return (
    <>
      <PromiseCard />
      <Switches s={s} update={update} />
      <Flows />
      <Local />
    </>
  );
}
