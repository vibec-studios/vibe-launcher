// OWNER: Frontend-Agent A. Launcher-Einstellungen: Abschnittsnavigation links, Inhalt scrollt rechts.
// Alles speichert automatisch; `settings://changed` hält den Cache aktuell.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Coffee,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FolderOpen,
  Gamepad2,
  GitBranch,
  Globe,
  Info,
  Languages,
  PackageCheck,
  Plug,
  RefreshCw,
  Store,
  Sparkles,
} from "lucide-react";
import { api } from "@/lib/api";
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
import { StoresCard } from "./StoresCard";
import { useLang, useT } from "@/i18n";

type SectionId = "general" | "game" | "content" | "java" | "downloads" | "integrations" | "stores" | "appearance" | "launcher";
const SECTIONS: { id: SectionId; icon: ReactNode }[] = [
  { id: "general", icon: <Languages size={15} /> },
  { id: "game", icon: <Gamepad2 size={15} /> },
  { id: "content", icon: <PackageCheck size={15} /> },
  { id: "java", icon: <Coffee size={15} /> },
  { id: "downloads", icon: <Download size={15} /> },
  { id: "integrations", icon: <Plug size={15} /> },
  { id: "stores", icon: <Store size={15} /> },
  { id: "appearance", icon: <Sparkles size={15} /> },
  { id: "launcher", icon: <Info size={15} /> },
];
const JAVA_MAJORS = [8, 17, 21, 25];
const WEBSITE = "https://vibec-studios.github.io/";
const GITHUB = "https://github.com/vibec-studios/vibe-launcher";

const merge = (base: Settings, p: Partial<Settings>): Settings => ({ ...base, ...p });

function SecretInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const t = useT();
  const [show, setShow] = useState(false);
  return (
    <Input
      type={show ? "text" : "password"}
      className="w-[360px] font-mono text-[12px]"
      value={value}
      placeholder={placeholder}
      autoComplete="off"
      onChange={(e) => onChange(e.target.value)}
      trailing={
        <Tooltip content={show ? t("settings.hide") : t("settings.show")}>
          <button
            type="button"
            aria-label={show ? t("settings.hide") : t("settings.show")}
            className="grid h-6 w-6 place-items-center text-dim hover:text-white"
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
      variant="outline"
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
    <div className="flex items-center gap-4 px-4 py-3 [&+&]:border-t [&+&]:border-line">
      <div className="w-[44px] shrink-0 text-[18px] font-bold leading-none text-white">{j.major}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[13px] text-white">
          {j.version}
          {j.vendor && <span className="text-muted">· {j.vendor}</span>}
        </div>
        <div className="selectable truncate font-mono text-[11px] text-dim" title={j.path}>
          {j.path}
        </div>
      </div>
      <Tag>{j.arch}</Tag>
      {j.managed && <Tag color="#3fe0c5">{t("form.java.managed")}</Tag>}
    </div>
  );
}

export function SettingsPage() {
  const t = useT();
  const qc = useQueryClient();
  const settings = useSettings();
  const sys = useSystemInfo();
  const java = useJavaList();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<SectionId>("general");
  const [checking, setChecking] = useState(false);

  const save = async (p: Partial<Settings>) => {
    const base = qc.getQueryData<Settings>(qk.settings);
    if (!base) return;
    const next = await api.settingsSet({ ...base, ...p });
    qc.setQueryData(qk.settings, next);
  };
  const placeholder = settings.data;
  const { draft: s, update, state } = useAutoSave<Settings | undefined, Partial<Settings>>(placeholder, (b, p) => (b ? merge(b, p) : b), save);

  // Aktiven Abschnitt beim Scrollen mitführen
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    let cur: SectionId = "general";
    for (const sec of SECTIONS) {
      const node = el.querySelector<HTMLElement>(`#set-${sec.id}`);
      if (node && node.offsetTop - el.offsetTop - 120 <= el.scrollTop) cur = sec.id;
    }
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 4) cur = SECTIONS[SECTIONS.length - 1].id;
    setActive(cur);
  };
  useEffect(onScroll, [s]); // eslint-disable-line react-hooks/exhaustive-deps

  const jump = (id: SectionId) => {
    const el = scrollRef.current;
    const node = el?.querySelector<HTMLElement>(`#set-${id}`);
    if (el && node) el.scrollTop = node.offsetTop - el.offsetTop - 24;
    setActive(id);
  };

  const checkUpdates = async () => {
    setChecking(true);
    try {
      await checkForUpdate(true);
    } finally {
      setChecking(false);
    }
  };

  const total = sys.data?.total_memory_mb ?? 8192;

  return (
    <div className="flex h-full">
      <aside className="flex w-[220px] shrink-0 flex-col border-r border-line">
        <div className="px-5 pb-3 pt-5">
          <h1 className="display text-[22px]">{t("nav.settings")}</h1>
        </div>
        <nav className="flex flex-col gap-0.5 px-2.5">
          {SECTIONS.map((sec) => (
            <button
              key={sec.id}
              onClick={() => jump(sec.id)}
              className={cn(
                "flex h-9 items-center gap-3 px-3 text-left text-[14px] font-medium transition-colors duration-100",
                active === sec.id ? "bg-surface3 text-white" : "text-muted hover:bg-surface2 hover:text-white",
              )}
            >
              <span className={active === sec.id ? "text-white" : "text-dim"}>{sec.icon}</span>
              {t(`settings.section.${sec.id}`)}
            </button>
          ))}
        </nav>
        <div className="flex-1" />
        <div className="flex h-10 items-center px-6">
          <SaveIndicator state={state} />
        </div>
      </aside>

      <div ref={scrollRef} onScroll={onScroll} className="scroll min-w-0 flex-1">
        {!s ? (
          <div className="flex max-w-[900px] flex-col gap-4 px-6 py-5">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="border border-line bg-surface">
                <div className="border-b border-line px-4 py-4">
                  <Skeleton className="h-3 w-24" />
                </div>
                {Array.from({ length: 3 }, (_, j) => (
                  <div key={j} className="flex items-center gap-6 px-4 py-4">
                    <div className="flex flex-1 flex-col gap-2">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-3 w-72" />
                    </div>
                    <Skeleton className="h-8 w-32" />
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex max-w-[900px] flex-col gap-4 px-6 pb-12 pt-5">
            <SettingsCard id="set-general" title={t("settings.section.general")}>
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
            </SettingsCard>

            <SettingsCard id="set-game" title={t("settings.section.game")}>
              <SettingRow title={t("settings.ram")} description={t("settings.ram.desc", { total: Math.round(total / 1024) })} stacked>
                <MemoryField
                  min={s.min_memory_mb}
                  max={s.max_memory_mb}
                  total={total}
                  onChange={(v, d) => update({ min_memory_mb: v.min, max_memory_mb: v.max }, d)}
                />
              </SettingRow>
              <SettingRow title={t("isettings.jvm")} description={t("settings.jvm.desc")} stacked>
                <Input
                  className="font-mono text-[12px]"
                  value={s.jvm_args}
                  placeholder="-XX:+UseG1GC -XX:MaxGCPauseMillis=50"
                  onChange={(e) => update({ jvm_args: e.target.value }, 700)}
                />
              </SettingRow>
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

            <SettingsCard id="set-content" title={t("settings.section.content")}>
              <SettingRow title={t("settings.auto_update")} description={t("settings.auto_update.desc")}>
                <Switch checked={s.auto_update_content} onChange={(v) => update({ auto_update_content: v })} label={t("settings.auto_update")} />
              </SettingRow>
            </SettingsCard>

            <SettingsCard
              id="set-java"
              title={t("settings.section.java")}
              right={
                <Tooltip content={t("settings.java.rescan")}>
                  <IconButton label={t("settings.java.rescan")} size="sm" className="border-transparent hover:border-line2" onClick={() => java.refetch()}>
                    <RefreshCw size={14} className={cn(java.isFetching && "animate-spin")} />
                  </IconButton>
                </Tooltip>
              }
            >
              <SettingRow title={t("settings.auto_java")} description={t("settings.auto_java.desc")}>
                <Switch checked={s.auto_java} onChange={(auto_java) => update({ auto_java })} label={t("settings.auto_java")} />
              </SettingRow>
              <div className="border-t border-line">
                <div className="px-4 pb-2 pt-4">
                  <div className="text-[14px] font-medium text-white">{t("settings.java.found")}</div>
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
                  <div className="mx-4 mb-4 border border-line bg-black/40">
                    {java.data
                      .slice()
                      .sort((a, b) => b.major - a.major)
                      .map((j) => (
                        <JavaRow key={j.path} j={j} />
                      ))}
                  </div>
                )}
              </div>
              <SettingRow title={t("settings.java.download")} description={t("settings.java.download.desc")}>
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
                      <span className="mt-2.5 font-mono text-[12px] text-muted">Java {m}</span>
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

            <SettingsCard id="set-downloads" title={t("settings.section.downloads")}>
              <SettingRow title={t("settings.concurrent")} description={t("settings.concurrent.desc")}>
                <div className="flex w-[300px] items-center gap-4">
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
            </SettingsCard>

            <SettingsCard id="set-integrations" title={t("settings.section.integrations")}>
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
                <SecretInput
                  value={s.curseforge_api_key ?? ""}
                  placeholder={t("settings.cf.placeholder")}
                  onChange={(v) => update({ curseforge_api_key: v.trim() || null }, 700)}
                />
              </SettingRow>
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

            <StoresCard id="set-stores" />

            <SettingsCard id="set-appearance" title={t("settings.section.appearance")}>
              <SettingRow title={t("settings.reduce_motion")} description={t("settings.reduce_motion.desc")}>
                <Switch
                  checked={s.reduce_motion}
                  onChange={(reduce_motion) => {
                    document.documentElement.dataset.reduceMotion = String(reduce_motion);
                    update({ reduce_motion });
                  }}
                  label={t("settings.reduce_motion")}
                />
              </SettingRow>
            </SettingsCard>

            <SettingsCard id="set-launcher" title={t("settings.section.launcher")}>
              <div className="flex items-center gap-6 px-4 py-5">
                <Logo3D size={56} speed={0} hoverSpin float={false} interactive={false} />
                <div className="min-w-0 flex-1">
                  <div className="brand text-[18px] text-white">Vibe Launcher</div>
                  <div className="mt-1 font-mono text-[12px] text-muted">
                    {sys.data ? `v${sys.data.version} · ${sys.data.os} ${sys.data.arch}` : <Spinner size={12} />}
                  </div>
                  <div className="mt-1 text-[12.5px] text-dim">{t("settings.about")}</div>
                </div>
                <div className="flex flex-col gap-2">
                  <a href={WEBSITE} className="flex items-center gap-2 text-[13px] font-medium text-muted hover:text-white">
                    <Globe size={13} />
                    {t("settings.website")}
                    <ExternalLink size={11} className="text-dim" />
                  </a>
                  <a href={GITHUB} className="flex items-center gap-2 text-[13px] font-medium text-muted hover:text-white">
                    <GitBranch size={13} />
                    GitHub
                    <ExternalLink size={11} className="text-dim" />
                  </a>
                </div>
              </div>
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
              <SettingRow title={t("settings.check_updates")} description={t("settings.check_updates.desc")}>
                <div className="flex items-center gap-3">
                  <Button size="sm" icon={<RefreshCw size={13} />} loading={checking} onClick={checkUpdates}>
                    {t("settings.update.check_now")}
                  </Button>
                  <Switch checked={s.check_updates} onChange={(check_updates) => update({ check_updates })} label={t("settings.check_updates")} />
                </div>
              </SettingRow>
              <SettingRow
                title={t("settings.data_dir")}
                description={<span className="selectable break-all font-mono text-[11px]">{sys.data?.data_dir ?? "…"}</span>}
              >
                <Button size="sm" icon={<FolderOpen size={13} />} onClick={() => api.openDataDir().catch((e) => toast.error(e))}>
                  {t("common.open_folder")}
                </Button>
              </SettingRow>
            </SettingsCard>
          </div>
        )}
      </div>
    </div>
  );
}
