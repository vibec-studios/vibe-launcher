// Launcher-Einstellungen als großes Popup: Tabs links, Inhalt rechts (auf schmalen Fenstern nur Icons).
// Öffnen überall per `openSettings(tab)` (store.ts); die alte Route `/settings?tab=…` leitet hierher um.
// Alles speichert automatisch; `settings://changed` hält den Cache aktuell.
import { DataDirRow } from "./DataDirMove";
import * as D from "@radix-ui/react-dialog";
import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Check,
  CircleHelp,
  Cloud,
  Coffee,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Gamepad2,
  GitBranch,
  Globe,
  Info,
  MessageSquareWarning,
  Palette,
  RefreshCw,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import { WEBSITE, WEBSITE_LABEL } from "@/lib/domains";
import { qk, useSettings, useSystemInfo, useTask, waitForTask } from "@/lib/queries";
import type { JavaInstall, LaunchBehavior, Settings } from "@/lib/types";
import {
  Button,
  IconButton,
  Input,
  NumberInput,
  Segmented,
  Select,
  SettingRow,
  SettingsCard,
  Skeleton,
  Slider,
  Spinner,
  Switch,
  Tag,
  Tooltip,
  cn,
  toast,
} from "@/components/ui";
import { JavaPathField, MemoryField, SaveIndicator, useAutoSave, useJavaList } from "@/components/instance/forms";
import { Logo3D } from "@/components/Logo3D";
import { checkForUpdate } from "@/app/UpdateNotice";
import { MasterOptSync, SyncOverview } from "@/components/instance/OptSync";
import { FixBackupPicker } from "@/features/backups/FixBackupPicker";
import { useLang, useT } from "@/i18n";
import { StoresCard } from "./StoresCard";
import { SkinImportSettings } from "@/features/skins/SkinImport";
import { VibeTab } from "./VibeCard";
import { openFeedback } from "@/features/feedback/store";
import { AppearanceTab } from "./AppearanceTab";
import { SETTINGS_TABS, closeSettings, setSettingsTab, useSettingsDialog, type SettingsTab } from "./store";
import { setMode, useSimple, type UiMode } from "@/lib/mode";
import { restartOnboarding, startTour } from "@/features/onboarding/store";
import { openHelp } from "@/features/help/store";
import { HelpLink } from "@/features/help/HelpButton";
import { PlayerHead } from "@/components/PlayerHead";
import { useAccounts } from "@/lib/queries";
import { useNavigate } from "@tanstack/react-router";

/** Simple-Modus: nur das Wichtigste; der Rest erscheint mit „Expert-Modus aktivieren“. */
const SIMPLE_SETTINGS_TABS: SettingsTab[] = ["general", "appearance", "vibe", "updates", "about"];

const ICONS: Record<SettingsTab, ReactNode> = {
  general: <SlidersHorizontal size={16} />,
  appearance: <Palette size={16} />,
  java: <Coffee size={16} />,
  game: <Gamepad2 size={16} />,
  downloads: <Download size={16} />,
  vibe: <Cloud size={16} />,
  updates: <RefreshCw size={16} />,
  about: <Info size={16} />,
};
const JAVA_MAJORS = [8, 17, 21, 25];
const GITHUB = "https://github.com/vibec-studios/vibe-launcher";

type Update = (p: Partial<Settings>, delay?: number) => void;
interface TabProps {
  s: Settings;
  update: Update;
}

const merge = (base: Settings, p: Partial<Settings>): Settings => ({ ...base, ...p });

// ------------------------------------------------------------------ Dialog

export function SettingsDialog() {
  const open = useSettingsDialog((s) => s.open);
  return (
    <D.Root open={open} onOpenChange={(o) => !o && closeSettings()}>
      <D.Portal>
        <D.Overlay className="vl-overlay fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-fade-in" />
        <D.Content
          aria-describedby={undefined}
          // Kein Fokusrahmen auf dem ersten Tab beim Öffnen; Tastatur-Navigation startet im Dialog
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement | null)?.focus();
          }}
          tabIndex={-1}
          className={cn(
            "outline-none",
            "fixed left-1/2 top-1/2 z-50 flex -translate-x-1/2 -translate-y-1/2",
            "h-[calc(100%-48px)] max-h-[780px] w-[calc(100%-48px)] max-w-[1100px] overflow-hidden",
            "vl-dialog rounded-panel bg-overlay shadow-e3 data-[state=open]:animate-pop-in",
          )}
        >
          <SettingsBody />
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

function SettingsBody() {
  const t = useT();
  const qc = useQueryClient();
  const settings = useSettings();
  const stored = useSettingsDialog((s) => s.tab);
  const narrow = useNarrow();
  const simple = useSimple();
  const tabs = simple ? SIMPLE_SETTINGS_TABS : SETTINGS_TABS;
  const tab: SettingsTab = (tabs as readonly SettingsTab[]).includes(stored) ? stored : "general";

  const save = async (p: Partial<Settings>) => {
    const base = qc.getQueryData<Settings>(qk.settings);
    if (!base) return;
    const next = await api.settingsSet({ ...base, ...p });
    qc.setQueryData(qk.settings, next);
  };
  const { draft: s, update, state } = useAutoSave<Settings | undefined, Partial<Settings>>(settings.data, (b, p) => (b ? merge(b, p) : b), save);

  return (
    <>
      <aside className="flex w-[232px] shrink-0 flex-col bg-bg max-[880px]:w-[60px]">
        <div className="flex h-[64px] shrink-0 items-center px-5 max-[880px]:justify-center max-[880px]:px-0">
          <D.Title className="text-title text-text max-[880px]:sr-only">{t("nav.settings")}</D.Title>
          <span className="hidden text-muted max-[880px]:block">
            <SlidersHorizontal size={18} />
          </span>
        </div>
        <nav role="tablist" aria-orientation="vertical" className="scroll flex min-h-0 flex-1 flex-col gap-0.5 px-2.5 max-[880px]:items-center max-[880px]:px-0">
          {tabs.map((id) => {
            const active = id === tab;
            const btn = (
              <button
                key={id}
                role="tab"
                data-tour={`settings-tab-${id}`}
                aria-selected={active}
                aria-label={t(`settings.tab.${id}`)}
                onClick={() => setSettingsTab(id)}
                className={cn(
                  "vl-snav relative flex h-9 shrink-0 items-center gap-3 rounded-ctl px-3 text-left text-[13.5px] font-medium transition-colors duration-100",
                  "max-[880px]:h-10 max-[880px]:w-10 max-[880px]:justify-center max-[880px]:px-0",
                  active ? "bg-white/[.08] text-text" : "text-muted hover:bg-white/[.05] hover:text-text",
                )}
              >
                <span className={active ? "text-brand" : "text-dim"}>{ICONS[id]}</span>
                <span className="truncate max-[880px]:hidden">{t(`settings.tab.${id}`)}</span>
              </button>
            );
            return (
              <Tooltip key={id} content={narrow ? t(`settings.tab.${id}`) : null} side="right">
                {btn}
              </Tooltip>
            );
          })}
        </nav>
        {simple && (
          <div className="px-2.5 pb-1 max-[880px]:hidden">
            <button
              onClick={() => void setMode("expert").catch((e) => toast.error(e))}
              className="flex w-full items-center gap-2 rounded-ctl px-3 py-2 text-left text-[12.5px] font-medium text-muted transition-colors hover:bg-white/[.05] hover:text-text"
            >
              <SlidersHorizontal size={14} className="shrink-0 text-dim" />
              {t("simple.settings.more")}
            </button>
          </div>
        )}
        <div className="flex h-11 shrink-0 items-center px-5 max-[880px]:justify-center max-[880px]:px-0">
          <SaveIndicator state={state} />
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col bg-[var(--tone-canvas)]">
        <header className="flex h-[64px] shrink-0 items-center gap-4 pl-7 pr-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-title text-text">{t(`settings.tab.${tab}`)}</h2>
            <p className="truncate text-[12.5px] text-muted">{t(`settings.tab.${tab}.desc`)}</p>
          </div>
          <D.Close aria-label={t("common.close")} className="grid h-9 w-9 shrink-0 place-items-center rounded-ctl text-dim transition-colors hover:bg-white/[.07] hover:text-text">
            <X size={18} />
          </D.Close>
        </header>
        <div key={tab} className="scroll min-h-0 flex-1">
          <div data-tour="settings-content" className="vl-settings mx-auto flex w-full max-w-[860px] flex-col gap-6 px-7 pb-10 pt-2 animate-fade-in">
            {!s ? <LoadingCards /> : <TabContent tab={tab} s={s} update={update} />}
          </div>
        </div>
      </section>
    </>
  );
}

function TabContent({ tab, s, update }: TabProps & { tab: SettingsTab }) {
  switch (tab) {
    case "general":
      return <GeneralTab s={s} update={update} />;
    case "appearance":
      return <AppearanceTab s={s} update={update} />;
    case "java":
      return <JavaTab s={s} update={update} />;
    case "game":
      return <GameTab s={s} update={update} />;
    case "downloads":
      return <DownloadsTab s={s} update={update} />;
    case "vibe":
      return <VibeTab settings={s} update={update} />;
    case "updates":
      return <UpdatesTab s={s} update={update} />;
    case "about":
      return <AboutTab />;
  }
}

function LoadingCards() {
  return (
    <>
      {Array.from({ length: 2 }, (_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <Skeleton className="mx-1 h-3 w-24" />
          <div className="rounded-card bg-surface">
          {Array.from({ length: 3 }, (_, j) => (
            <div key={j} className="flex items-center gap-6 px-4 py-3">
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-72" />
              </div>
              <Skeleton className="h-8 w-32" />
            </div>
          ))}
          </div>
        </div>
      ))}
    </>
  );
}

// ------------------------------------------------------------------ Tabs

/** Bedienung: Simple/Expert, Einrichtung bzw. Einführung erneut starten (in beiden Modi). */
function ModeCard({ language }: { language: ReactNode }) {
  const t = useT();
  const simple = useSimple();
  return (
    <SettingsCard title={t("settings.section.general")}>
      {language}
      <SettingRow title={t("mode.title")} description={simple ? t("mode.simple.desc") : t("mode.expert.desc")}>
        <Segmented<UiMode>
          value={simple ? "simple" : "expert"}
          onChange={(m) => void setMode(m).catch((e) => toast.error(e))}
          items={[
            { value: "simple", label: t("mode.simple") },
            { value: "expert", label: t("mode.expert") },
          ]}
        />
      </SettingRow>
      {simple && (
        <SettingRow title={t("mode.tour.title")} description={t("mode.tour.desc")}>
          <Button
            size="sm"
            onClick={() => {
              closeSettings();
              startTour();
            }}
          >
            {t("mode.tour")}
          </Button>
        </SettingRow>
      )}
      <SettingRow title={t("mode.onboarding")} description={t("mode.onboarding.desc")}>
        <Button
          size="sm"
          onClick={() => {
            closeSettings();
            restartOnboarding();
          }}
        >
          {t("mode.onboarding.start")}
        </Button>
      </SettingRow>
    </SettingsCard>
  );
}

/** Simple-Modus: angemeldetes Konto mit Verwalten. */
function AccountCard() {
  const t = useT();
  const nav = useNavigate();
  const { data: accounts = [] } = useAccounts();
  const active = accounts.find((a) => a.active) ?? accounts[0];
  return (
    <SettingsCard title={t("simple.settings.account")}>
      <SettingRow
        icon={active ? <PlayerHead uuid={active.uuid} name={active.username} size={32} /> : undefined}
        title={active ? active.username : t("rail.no_account")}
        description={active ? t("acct.microsoft") : t("acct.sign_in_hint")}
      >
        <Button
          size="sm"
          onClick={() => {
            closeSettings();
            nav({ to: "/accounts" });
          }}
        >
          {accounts.length ? t("rail.manage_accounts") : t("acct.sign_in")}
        </Button>
      </SettingRow>
    </SettingsCard>
  );
}

function GeneralTab({ s, update }: TabProps) {
  const simple = useSimple();
  const t = useT();
  const sys = useSystemInfo();
  return (
    <>
      <ModeCard
        language={
          <SettingRow title={t("settings.language")} description={t("settings.language.desc")}>
            <Segmented
              value={s.language}
              onChange={(language) => {
                useLang.getState().setLang(language);
                update({ language });
              }}
              items={[
                { value: "de", label: "Deutsch" },
                { value: "en", label: "English" },
              ]}
            />
          </SettingRow>
        }
      />

      {simple ? (
        <AccountCard />
      ) : (
      <>
      <SettingsCard title={t("settings.section.content")}>
        <SettingRow title={t("settings.auto_update")} description={t("settings.auto_update.desc")}>
          <Switch checked={s.auto_update_content} onChange={(v) => update({ auto_update_content: v })} label={t("settings.auto_update")} />
        </SettingRow>
      </SettingsCard>

      <SettingsCard title={t("settings.section.integrations")}>
        <SettingRow
          title="Microsoft Client-ID"
          description={
            <>
              {t("settings.msa.desc")}{" "}
              <span className={sys.data?.msa_available ? "text-ok" : "text-warn"}>
                {sys.data?.msa_available ? t("settings.status.active") : t("settings.status.inactive")}
              </span>
            </>
          }
          stacked
        >
          <SecretInput
            value={s.msa_client_id ?? ""}
            placeholder="00000000-0000-0000-0000-000000000000"
            onChange={(v) => update({ msa_client_id: v.trim() || null }, 700)}
          />
        </SettingRow>
      </SettingsCard>

      <SkinImportSettings />
      </>
      )}
    </>
  );
}

function JavaTab({ s, update }: TabProps) {
  const t = useT();
  const sys = useSystemInfo();
  const java = useJavaList();
  const total = sys.data?.total_memory_mb ?? 8192;
  return (
    <>
      <SettingsCard title={t("settings.section.memory")} right={<HelpLink guide="performance" />}>
        <SettingRow title={t("settings.ram")} description={t("settings.ram.desc", { total: Math.round(total / 1024) })} stacked>
          <MemoryField min={s.min_memory_mb} max={s.max_memory_mb} total={total} onChange={(v, d) => update({ min_memory_mb: v.min, max_memory_mb: v.max }, d)} />
        </SettingRow>
        <SettingRow title={t("isettings.jvm")} description={t("settings.jvm.desc")} stacked>
          <Input
            className="font-mono text-[12px]"
            value={s.jvm_args}
            placeholder="-XX:+UseG1GC -XX:MaxGCPauseMillis=50"
            onChange={(e) => update({ jvm_args: e.target.value }, 700)}
          />
        </SettingRow>
      </SettingsCard>

      <SettingsCard
        title={t("settings.section.java")}
        right={
          <IconButton label={t("settings.java.rescan")} tip variant="ghost" size="sm" onClick={() => java.refetch()}>
            <RefreshCw size={14} className={cn(java.isFetching && "animate-spin")} />
          </IconButton>
        }
      >
        <SettingRow title={t("settings.auto_java")} description={t("settings.auto_java.desc")}>
          <Switch checked={s.auto_java} onChange={(auto_java) => update({ auto_java })} label={t("settings.auto_java")} />
        </SettingRow>
        <div className="border-t border-line">
          <div className="px-4 pb-1 pt-3">
            <div className="text-[13.5px] font-medium text-text">{t("settings.java.found")}</div>
          </div>
          {java.isLoading ? (
            <div className="flex flex-col gap-2 px-4 pb-4">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : java.isError ? (
            <p className="px-4 pb-4 text-[13px] text-danger">{String((java.error as { message?: string })?.message ?? java.error)}</p>
          ) : !java.data?.length ? (
            <p className="px-4 pb-4 text-[13px] text-dim">{t("settings.java.none")}</p>
          ) : (
            <div className="flex flex-col px-2 pb-2">
              {java.data
                .slice()
                .sort((a, b) => b.major - a.major)
                .map((j) => (
                  <JavaRow key={j.path} j={j} />
                ))}
            </div>
          )}
        </div>
        <SettingRow title={t("settings.java.download")} description={t("settings.java.download.desc")} stacked>
          <div className="flex flex-wrap gap-2">
            {JAVA_MAJORS.map((m) => (
              <JavaDownload key={m} major={m} installed={!!java.data?.some((j) => j.managed && j.major === m)} />
            ))}
          </div>
        </SettingRow>
        <SettingRow title={t("settings.java.overrides")} description={t("settings.java.overrides.desc")} stacked>
          <div className="flex flex-col gap-3">
            {JAVA_MAJORS.map((m) => (
              <div key={m} className="grid grid-cols-[72px_minmax(0,1fr)] items-start gap-4">
                <span className="mt-2.5 text-meta text-muted">Java {m}</span>
                <JavaPathField
                  value={s.java_overrides[String(m)] ?? null}
                  filterMajor={m}
                  autoLabel={t("settings.java.override_auto")}
                  onChange={(path, d) => {
                    const next = { ...s.java_overrides };
                    if (path) next[String(m)] = path;
                    else delete next[String(m)];
                    update({ java_overrides: next }, d);
                  }}
                />
              </div>
            ))}
          </div>
        </SettingRow>
      </SettingsCard>
    </>
  );
}

function GameTab({ s, update }: TabProps) {
  const t = useT();
  return (
    <>
      <SettingsCard title={t("settings.section.window")}>
        <SettingRow title={t("settings.resolution")} description={t("settings.resolution.desc")}>
          <div className="flex items-center gap-2">
            <NumberInput
              className="w-[110px]"
              value={s.game_width}
              min={320}
              max={7680}
              unit="px"
              onChange={(w) => w !== null && update({ game_width: w })}
              aria-label="width"
            />
            <span className="text-dim">×</span>
            <NumberInput
              className="w-[110px]"
              value={s.game_height}
              min={240}
              max={4320}
              unit="px"
              onChange={(h) => h !== null && update({ game_height: h })}
              aria-label="height"
            />
          </div>
        </SettingRow>
        <SettingRow title={t("settings.fullscreen")} description={t("settings.fullscreen.desc")}>
          <Switch checked={s.fullscreen} onChange={(fullscreen) => update({ fullscreen })} label={t("settings.fullscreen")} />
        </SettingRow>
      </SettingsCard>

      <SettingsCard title={t("settings.section.launch")}>
        <SettingRow title={t("settings.launch_behavior")} description={t("settings.launch_behavior.desc")}>
          <Select<LaunchBehavior>
            value={s.launch_behavior}
            onChange={(launch_behavior) => update({ launch_behavior })}
            className="w-[230px]"
            options={(["keep", "minimize", "hide"] as const).map((v) => ({ value: v, label: t(`settings.launch_behavior.${v}`) }))}
          />
        </SettingRow>
        <SettingRow title={t("settings.open_log")} description={t("settings.open_log.desc")}>
          <Switch checked={s.open_log_on_launch} onChange={(open_log_on_launch) => update({ open_log_on_launch })} label={t("settings.open_log")} />
        </SettingRow>
        <SettingRow title={t("settings.snapshots")} description={t("settings.snapshots.desc")}>
          <Switch checked={s.show_snapshots} onChange={(show_snapshots) => update({ show_snapshots })} label={t("settings.snapshots")} />
        </SettingRow>
        <SettingRow title={t("settings.wrapper")} description={t("settings.wrapper.desc")} stacked>
          <Input
            className="font-mono text-[12px]"
            value={s.wrapper_command ?? ""}
            placeholder="gamemoderun"
            onChange={(e) => update({ wrapper_command: e.target.value.trim() ? e.target.value : null }, 700)}
          />
        </SettingRow>
      </SettingsCard>

      <SettingsCard title={t("settings.section.sync")}>
        <SyncOverview />
      </SettingsCard>

      <SettingsCard title={t("sync.overview.master")}>
        <MasterOptSync />
      </SettingsCard>

      <div data-tour="settings-backups">
      <SettingsCard title={t("settings.section.backups")}>
        <SettingRow title={t("settings.backups.snapshot_keep")} description={t("settings.backups.snapshot_keep.desc")}>
          <NumberInput
            className="w-[110px]"
            value={s.snapshot_keep}
            min={1}
            max={100}
            onChange={(v) => v !== null && update({ snapshot_keep: v })}
            aria-label={t("settings.backups.snapshot_keep")}
          />
        </SettingRow>
        <SettingRow title={t("settings.backups.fix")} description={t("settings.backups.fix.desc")} stacked>
          <FixBackupPicker value={s.fix_backup} onChange={(fix_backup) => update({ fix_backup })} />
        </SettingRow>
        <SettingRow title={t("settings.backups.world_on_launch")} description={t("settings.backups.world_on_launch.desc")}>
          <Switch
            checked={s.world_backup_on_launch}
            onChange={(world_backup_on_launch) => update({ world_backup_on_launch })}
            label={t("settings.backups.world_on_launch")}
          />
        </SettingRow>
        <SettingRow title={t("settings.backups.world_keep")} description={t("settings.backups.world_keep.desc")}>
          <NumberInput
            className="w-[110px]"
            value={s.world_backups_keep}
            min={1}
            max={100}
            onChange={(v) => v !== null && update({ world_backups_keep: v })}
            aria-label={t("settings.backups.world_keep")}
          />
        </SettingRow>
      </SettingsCard>
      </div>
    </>
  );
}

function DownloadsTab({ s, update }: TabProps) {
  const t = useT();
  const sys = useSystemInfo();
  return (
    <>
      <SettingsCard title={t("settings.section.downloads")}>
        <SettingRow title={t("settings.concurrent")} description={t("settings.concurrent.desc")}>
          <div className="flex w-[300px] max-w-full items-center gap-4">
            <Slider value={s.concurrent_downloads} min={1} max={64} onChange={(v) => update({ concurrent_downloads: v }, 400)} />
            <NumberInput
              className="w-[80px] shrink-0"
              value={s.concurrent_downloads}
              min={1}
              max={64}
              onChange={(v) => v !== null && update({ concurrent_downloads: v })}
              aria-label={t("settings.concurrent")}
            />
          </div>
        </SettingRow>
        <SettingRow
          title="CurseForge API-Key"
          description={
            <>
              {t("settings.cf.desc")}{" "}
              <span className={sys.data?.curseforge_available ? "text-ok" : "text-warn"}>
                {sys.data?.curseforge_available ? t("settings.status.active") : t("settings.status.inactive")}
              </span>
            </>
          }
          stacked
        >
          <SecretInput value={s.curseforge_api_key ?? ""} placeholder={t("settings.cf.placeholder")} onChange={(v) => update({ curseforge_api_key: v.trim() || null }, 700)} />
        </SettingRow>
      </SettingsCard>

      <StoresCard id="set-stores" />

      <SettingsCard title={t("settings.section.storage")}>
        <DataDirRow dataDir={sys.data?.data_dir} />
      </SettingsCard>
    </>
  );
}

function UpdatesTab({ s, update }: TabProps) {
  const t = useT();
  const simple = useSimple();
  const sys = useSystemInfo();
  const [checking, setChecking] = useState(false);
  const checkUpdates = async () => {
    setChecking(true);
    try {
      await checkForUpdate(true);
    } finally {
      setChecking(false);
    }
  };
  return (
    <SettingsCard title={t("settings.section.updates")} right={sys.data && <span className="text-caption font-semibold tabular-nums text-dim">v{sys.data.version}</span>}>
      {!simple && (
      <SettingRow title={t("settings.channel")} description={s.update_channel === "dev" ? t("settings.channel.dev.desc") : t("settings.channel.release.desc")}>
        <Segmented
          value={s.update_channel}
          onChange={(update_channel) => update({ update_channel })}
          items={[
            { value: "release", label: t("settings.channel.release") },
            { value: "dev", label: t("settings.channel.dev") },
          ]}
        />
      </SettingRow>
      )}
      <SettingRow title={t("settings.check_updates")} description={t("settings.check_updates.desc")}>
        <Switch checked={s.check_updates} onChange={(check_updates) => update({ check_updates })} label={t("settings.check_updates")} />
      </SettingRow>
      <SettingRow title={t("settings.update.manual")} description={t("settings.update.manual.desc")}>
        <Button size="sm" icon={<RefreshCw size={13} />} loading={checking} onClick={checkUpdates}>
          {t("settings.update.check_now")}
        </Button>
      </SettingRow>
    </SettingsCard>
  );
}

function AboutTab() {
  const t = useT();
  const sys = useSystemInfo();
  return (
    <>
      <section className="flex items-center gap-5 px-1 py-2">
        <Logo3D size={64} speed={0} hoverSpin float={false} interactive={false} />
        <div className="min-w-0 flex-1">
          <div className="text-title text-text">Vibe Launcher</div>
          <div className="mt-0.5 text-meta tabular-nums text-muted">{sys.data ? `v${sys.data.version} · ${sys.data.os} ${sys.data.arch}` : <Spinner size={12} />}</div>
          <div className="mt-1.5 text-meta text-dim">{t("settings.about")}</div>
        </div>
      </section>
      <SettingsCard title={t("settings.section.links")}>
        <LinkRow href={WEBSITE} icon={<Globe size={15} />} title={t("settings.website")} text={WEBSITE_LABEL} />
        <LinkRow href={GITHUB} icon={<GitBranch size={15} />} title="GitHub" text={t("settings.about.opensource")} />
      </SettingsCard>
      <SettingsCard title={t("help.settings.title")}>
        <SettingRow title={t("help.settings.title")} description={t("help.settings.desc")}>
          <Button
            size="sm"
            icon={<CircleHelp size={13} />}
            data-testid="settings-help-open"
            onClick={() => {
              closeSettings();
              openHelp();
            }}
          >
            {t("help.settings.open")}
          </Button>
        </SettingRow>
      </SettingsCard>
      <SettingsCard title={t("fb.button")}>
        <SettingRow title={t("fb.title")} description={t("fb.desc")}>
          <Button
            size="sm"
            icon={<MessageSquareWarning size={13} />}
            onClick={() => {
              closeSettings();
              // erst nach der Schließ-Animation, damit der Fenster-Screenshot den Launcher zeigt
              setTimeout(() => void openFeedback({ source: "settings" }), 220);
            }}
          >
            {t("fb.button")}
          </Button>
        </SettingRow>
      </SettingsCard>
    </>
  );
}

function LinkRow({ href, icon, title, text }: { href: string; icon: ReactNode; title: string; text: string }) {
  return (
    <a
      href={href}
      className="group flex items-center gap-3 px-4 py-3 transition-colors duration-100 first:rounded-t-card last:rounded-b-card hover:bg-white/[.03] [&+&]:border-t [&+&]:border-line"
    >
      <span className="text-dim group-hover:text-text">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-medium text-text">{title}</span>
        <span className="block truncate text-meta text-muted">{text}</span>
      </span>
      <ExternalLink size={13} className="text-dim group-hover:text-text" />
    </a>
  );
}

// ------------------------------------------------------------------ Bausteine

const NARROW = "(max-width: 880px)";
/** Schmales Fenster: Tab-Leiste nur mit Icons (Tooltips zeigen die Namen). */
function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches);
  useEffect(() => {
    const mq = window.matchMedia(NARROW);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}

function SecretInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const t = useT();
  const [show, setShow] = useState(false);
  return (
    <Input
      type={show ? "text" : "password"}
      className="w-full max-w-[420px] font-mono text-[12px]"
      value={value}
      placeholder={placeholder}
      autoComplete="off"
      onChange={(e) => onChange(e.target.value)}
      trailing={
        <Tooltip content={show ? t("settings.hide") : t("settings.show")}>
          <button
            type="button"
            aria-label={show ? t("settings.hide") : t("settings.show")}
            className="grid h-6 w-6 place-items-center rounded-ctl text-dim hover:bg-white/[.07] hover:text-text"
            onClick={() => setShow(!show)}
          >
            {show ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </Tooltip>
      }
    />
  );
}

function JavaDownload({ major, installed }: { major: number; installed: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const [taskId, setTaskId] = useState<string | null>(null);
  const task = useTask(taskId);
  const busy = !!taskId && (!task || task.status === "running");
  return (
    <Button
      size="sm"
      variant="ghost"
      icon={busy ? undefined : installed ? <Check size={13} className="text-ok" /> : <Download size={13} />}
      loading={busy}
      disabled={installed && !busy}
      title={installed ? t("settings.java.already") : undefined}
      onClick={async () => {
        try {
          const id = await api.javaInstall(major);
          setTaskId(id);
          await waitForTask(id);
          toast.success(t("settings.java.installed", { major }));
          qc.invalidateQueries({ queryKey: qk.java });
        } catch (e) {
          if ((e as { kind?: string })?.kind !== "cancelled") toast.error(e, t("settings.java.install_failed", { major }));
        } finally {
          setTaskId(null);
        }
      }}
    >
      Java {major}
      {busy && task?.progress != null && <span className="text-accent">{Math.round(task.progress * 100)}%</span>}
    </Button>
  );
}

function JavaRow({ j }: { j: JavaInstall }) {
  const t = useT();
  return (
    <div className="flex items-center gap-4 rounded-ctl px-2 py-2 transition-colors duration-100 hover:bg-white/[.03]">
      <div className="w-[36px] shrink-0 text-section tabular-nums text-text">{j.major}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[13px] text-text">
          {j.version}
          {j.vendor && <span className="text-muted">· {j.vendor}</span>}
        </div>
        <div className="selectable truncate text-caption text-dim" title={j.path}>
          {j.path}
        </div>
      </div>
      <Tag>{j.arch}</Tag>
      {j.managed && <Tag className="bg-ok/12 text-ok">{t("form.java.managed")}</Tag>}
    </div>
  );
}
