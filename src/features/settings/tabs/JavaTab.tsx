import { RefreshCw } from "lucide-react";
import { useSystemInfo } from "@/lib/queries";
import { IconButton, Input, SettingRow, SettingsCard, Skeleton, Switch, cn } from "@/components/ui";
import { JavaPathField, MemoryField, useJavaList } from "@/components/instance/forms";
import { useExpert } from "@/lib/simple-mode";
import { ExpertHint } from "@/features/simple/ExpertHint";
import { HelpLink } from "@/features/help/HelpButton";
import { Term } from "@/features/help/glossary/Term";
import { useT } from "@/i18n";
import { JavaDownload, JavaRow } from "../components/JavaItems";
import type { TabProps } from "../types";

const JAVA_MAJORS = [8, 17, 21, 25];

export function JavaTab({ s, update }: TabProps) {
  const t = useT();
  const sys = useSystemInfo();
  const java = useJavaList();
  const total = sys.data?.total_memory_mb ?? 8192;
  const jvm = useExpert("jvm-args");
  const runtime = useExpert("java-runtime");
  return (
    <>
      <SettingsCard title={t("settings.section.memory")} right={<HelpLink guide="performance" />}>
        <SettingRow title={<Term id="ram">{t("settings.ram")}</Term>} description={t("settings.ram.desc", { total: Math.round(total / 1024) })} stacked>
          <MemoryField min={s.min_memory_mb} max={s.max_memory_mb} total={total} onChange={(v, d) => update({ min_memory_mb: v.min, max_memory_mb: v.max }, d)} />
        </SettingRow>
        {jvm && (
        <SettingRow title={t("isettings.jvm")} description={t("settings.jvm.desc")} stacked>
          <Input
            className="font-mono text-[12px]"
            value={s.jvm_args}
            placeholder="-XX:+UseG1GC -XX:MaxGCPauseMillis=50"
            onChange={(e) => update({ jvm_args: e.target.value }, 700)}
          />
        </SettingRow>
        )}
      </SettingsCard>

      <ExpertHint text={t("usab.expert.java")} />

      {runtime && (
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
        <SettingRow title={t("settings.java_cds")} description={t("settings.java_cds.desc")}>
          <Switch checked={s.java_cds ?? true} onChange={(java_cds) => update({ java_cds })} label={t("settings.java_cds")} />
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
      )}
    </>
  );
}
