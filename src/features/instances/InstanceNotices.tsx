// Hinweiszeile der Instanzseite: bündelt Modpack-Update, Mod-Updates, Abhängigkeitsprobleme und manuelle Downloads
// als gut lesbare Hinweise mit Symbol und Text unter der Tab-Leiste (wie die Hinweise der Modrinth App).
import * as Popover from "@radix-ui/react-popover";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { AlertTriangle, ArrowUpCircle, ArrowUpRight, Download, ExternalLink, RefreshCw } from "lucide-react";
import { forwardRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Tooltip, cn } from "@/components/ui";
import { DepsPanel, useDepIssues } from "@/features/content/DepsPanel";
import { MissingPanel, useMissingDownloads } from "@/features/content/MissingPanel";
import { ModpackUpdateDialog, useModpackUpdate } from "@/features/content/ModpackUpdate";
import { markUpdatesChecked, setContentFilter, useContentView } from "@/features/content/contentView";
import { useT } from "@/i18n";
import { api } from "@/lib/api";
import { qk } from "@/lib/queries";
import type { ContentUpdate, Instance } from "@/lib/types";
import { startManualDownload } from "@/components/content/install";

const route = getRouteApi("/instances/$id");

type Tone = "accent" | "warn" | "danger";
const toneIcon: Record<Tone, string> = { accent: "text-accent", warn: "text-warn", danger: "text-danger" };

/** Gut lesbarer Hinweis: farbiges Symbol + Text auf ruhiger Fläche; Zusatzinfo im Tooltip, Details per Klick. */
const Chip = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { icon: ReactNode; tone: Tone; tip?: ReactNode }>(function Chip(
  { icon, tone, tip, className, children, ...rest },
  ref,
) {
  const btn = (
    <button
      ref={ref}
      className={cn(
        "flex h-8 shrink-0 items-center gap-2 rounded-ctl bg-surface px-3 text-[13px] font-medium text-text transition-colors duration-100",
        "hover:bg-surface2 data-[state=open]:bg-surface2",
        className,
      )}
      {...rest}
    >
      <span className={cn("flex shrink-0", toneIcon[tone])}>{icon}</span>
      <span className="truncate">{children}</span>
    </button>
  );
  return tip ? (
    <Tooltip content={tip} side="bottom">
      {btn}
    </Tooltip>
  ) : (
    btn
  );
});

function PopoverChip({ chip, children, width = 460 }: { chip: ReactNode; children: (close: () => void) => ReactNode; width?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>{chip}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          collisionPadding={12}
          style={{ width }}
          className="z-[60] overflow-hidden rounded-card bg-overlay shadow-e2 outline-none data-[state=open]:animate-[pop-in_.12s_var(--ease-snap)]"
        >
          {children(() => setOpen(false))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Manuelle Updates: je Eintrag aktuelle → neue Version und Link zur Dateiseite (öffnet sie und erwartet die Datei). */
function ManualUpdatesPanel({ instanceId, updates }: { instanceId: string; updates: ContentUpdate[] }) {
  const t = useT();
  return (
    <div>
      <div className="border-b border-line px-4 py-3">
        <div className="text-[13.5px] font-semibold text-text">{t("manual.notice_title")}</div>
        <div className="mt-0.5 text-meta text-muted">{t("manual.notice_text")}</div>
      </div>
      <div className="scroll max-h-[260px] px-4 py-1">
        {updates.map((u) => (
          <div key={`${u.kind}/${u.file_name}`} className="flex h-10 items-center gap-3 text-[12.5px]">
            <span className="min-w-0 flex-1" title={u.file_name}>
              <span className="block truncate font-medium text-text">{u.file_name}</span>
              <span className="block truncate text-[11.5px] leading-tight text-dim">
                {u.current_version ?? "?"} → <span className="text-text">{u.new_version.version_number}</span>
              </span>
            </span>
            <button
              onClick={() => startManualDownload(instanceId, { source: u.source, id: u.project_id, title: u.file_name }, u.new_version.id).catch(() => {})}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-ctl text-[13px] font-semibold text-brand hover:underline"
            >
              {t("manual.update")}
              <ExternalLink size={11} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function InstanceNotices({ instance, tab }: { instance: Instance; tab: string }) {
  const t = useT();
  const nav = route.useNavigate();
  const id = instance.id;
  const vanilla = instance.loader.kind === "vanilla";
  const [packOpen, setPackOpen] = useState(false);

  const pack = useModpackUpdate(instance).data;
  const deps = useDepIssues(id, !vanilla).data ?? [];
  const missing = useMissingDownloads(id).data ?? [];

  // Mod-Updates: nach einer Prüfung die genaue Liste, sonst die Hintergrundzählung des Backends
  const checked = useContentView((s) => !!s.checked[id]);
  const updatesQ = useQuery({ queryKey: qk.contentUpdates(id), queryFn: () => api.contentCheckUpdates(id), enabled: checked, staleTime: 10 * 60_000 });
  const counts = useQuery({ queryKey: ["update-counts"], queryFn: api.contentUpdateCounts, staleTime: 60_000, refetchInterval: 120_000 });
  // In den Inhalten zeigt die Werkzeugleiste mit geladenen Update-Daten selbst „Alle aktualisieren“ -> hier nicht doppelt
  const inContent = tab === "content" || tab === "resourcepacks" || tab === "shaders";
  const updates = inContent && updatesQ.data ? 0 : updatesQ.data ? updatesQ.data.length : (counts.data?.[id] ?? 0);

  // Gesperrte CurseForge-Downloads: eigener Hinweis mit Version und Link zur Dateiseite
  const manualUpdates = (updatesQ.data ?? []).filter((u) => u.manual);
  const depErrors = deps.filter((d) => d.severity === "error").length;
  const showUpdates = () => {
    markUpdatesChecked(id);
    setContentFilter(id, "updates");
    nav({ search: { tab: "content" }, replace: true });
  };

  if (!pack && !updates && !deps.length && !missing.length && !manualUpdates.length) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 px-6 pt-4" role="group" aria-label={t("ipage.notices")}>
      {pack && (
        <>
          <Chip tone="accent" icon={<ArrowUpCircle size={15} />} tip={t("ipage.notice.modpack_hint")} onClick={() => setPackOpen(true)}>
            {t("ipage.notice.modpack", { version: pack.latest.version_number })}
          </Chip>
          {packOpen && <ModpackUpdateDialog instance={instance} versionId={pack.latest.id} onClose={() => setPackOpen(false)} />}
        </>
      )}
      {deps.length > 0 && (
        <PopoverChip
          width={500}
          chip={
            <Chip tone={depErrors ? "danger" : "warn"} icon={<AlertTriangle size={15} />}>
              {depErrors
                ? deps.length === 1
                  ? t("ipage.notice.deps_1")
                  : t("ipage.notice.deps", { n: deps.length })
                : deps.length === 1
                  ? t("ipage.notice.deps_warn_1")
                  : t("ipage.notice.deps_warn", { n: deps.length })}
            </Chip>
          }
        >
          {() => <DepsPanel instanceId={id} />}
        </PopoverChip>
      )}
      {missing.length > 0 && (
        <PopoverChip
          chip={
            <Chip tone="warn" icon={<Download size={15} />}>
              {missing.length === 1 ? t("ipage.notice.missing_1") : t("ipage.notice.missing", { n: missing.length })}
            </Chip>
          }
        >
          {(close) => <MissingPanel instanceId={id} onDismissed={close} />}
        </PopoverChip>
      )}
      {updates > 0 && (
        <Chip tone="accent" icon={<RefreshCw size={14} />} tip={t("ipage.notice.updates_hint")} onClick={showUpdates}>
          {updates === 1 ? t("ipage.notice.updates_1") : t("ipage.notice.updates", { n: updates })}
        </Chip>
      )}
      {manualUpdates.length > 0 && (
        <PopoverChip
          width={420}
          chip={
            <Chip tone="accent" icon={<ArrowUpRight size={15} />}>
              {manualUpdates.length === 1 ? t("manual.notice_1") : t("manual.notice", { n: manualUpdates.length })}
            </Chip>
          }
        >
          {() => <ManualUpdatesPanel instanceId={id} updates={manualUpdates} />}
        </PopoverChip>
      )}
    </div>
  );
}
