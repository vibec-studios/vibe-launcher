// Hinweiszeile der Instanzseite: bündelt Modpack-Update, Mod-Updates, Abhängigkeitsprobleme und manuelle Downloads
// als ruhige, kleine Chips rechts in der Bereichsleiste (statt gestapelter Banner). Details öffnen sich per Klick.
import * as Popover from "@radix-ui/react-popover";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { AlertTriangle, ArrowUpCircle, Download, RefreshCw } from "lucide-react";
import { forwardRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Tooltip, cn } from "@/components/ui";
import { DepsPanel, useDepIssues } from "@/features/content/DepsPanel";
import { MissingPanel, useMissingDownloads } from "@/features/content/MissingPanel";
import { ModpackUpdateDialog, useModpackUpdate } from "@/features/content/ModpackUpdate";
import { markUpdatesChecked, setContentFilter, useContentView } from "@/features/content/contentView";
import { useT } from "@/i18n";
import { api } from "@/lib/api";
import { qk } from "@/lib/queries";
import type { Instance } from "@/lib/types";

const route = getRouteApi("/instances/$id");

type Tone = "accent" | "warn" | "danger";
const toneIcon: Record<Tone, string> = { accent: "text-accent", warn: "text-warn", danger: "text-danger" };

/** Ruhiger Hinweis: farbiges Symbol, gedämpfter Text. Unter ~620 px Breite nur Symbol + Zahl (Text im Tooltip). */
const Chip = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { icon: ReactNode; tone: Tone; short: ReactNode }>(function Chip(
  { icon, tone, short, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        "flex h-8 shrink-0 items-center gap-1.5 px-2 text-[12.5px] font-medium transition-colors duration-100",
        "hover:bg-white/[.05] hover:text-white data-[state=open]:bg-white/[.06] data-[state=open]:text-white",
        tone === "danger" ? "text-text" : "text-muted",
        className,
      )}
      {...rest}
    >
      <span className={toneIcon[tone]}>{icon}</span>
      <span className="hidden @min-[620px]:inline">{children}</span>
      <span className="tabular-nums @min-[620px]:hidden">{short}</span>
    </button>
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
          className="z-[60] border border-line2 bg-[#07070a] shadow-[0_16px_40px_rgba(0,0,0,.65)] outline-none data-[state=open]:animate-[pop-in_.12s_var(--ease-snap)]"
        >
          {children(() => setOpen(false))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
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
  // In der Mod-Liste zeigt die Werkzeugleiste mit geladenen Update-Daten selbst „N aktualisieren“ -> hier nicht doppelt
  const updates = tab === "content" && updatesQ.data ? 0 : updatesQ.data ? updatesQ.data.length : (counts.data?.[id] ?? 0);

  const depErrors = deps.filter((d) => d.severity === "error").length;
  const showUpdates = () => {
    markUpdatesChecked(id);
    setContentFilter(id, "updates");
    nav({ search: { tab: vanilla ? "resourcepacks" : "content" }, replace: true });
  };

  if (!pack && !updates && !deps.length && !missing.length) return null;

  return (
    <div className="flex min-w-0 items-center gap-0.5 overflow-hidden" role="group" aria-label={t("ipage.notices")}>
      {pack && (
        <>
          <Tooltip content={t("ipage.notice.modpack_hint")}>
            <Chip tone="accent" icon={<ArrowUpCircle size={14} />} short={pack.latest.version_number} onClick={() => setPackOpen(true)}>
              {t("ipage.notice.modpack", { version: pack.latest.version_number })}
            </Chip>
          </Tooltip>
          {packOpen && <ModpackUpdateDialog instance={instance} versionId={pack.latest.id} onClose={() => setPackOpen(false)} />}
        </>
      )}
      {deps.length > 0 && (
        <PopoverChip
          width={500}
          chip={
            <Chip tone={depErrors ? "danger" : "warn"} icon={<AlertTriangle size={14} />} short={deps.length}>
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
            <Chip tone="warn" icon={<Download size={14} />} short={missing.length}>
              {missing.length === 1 ? t("ipage.notice.missing_1") : t("ipage.notice.missing", { n: missing.length })}
            </Chip>
          }
        >
          {(close) => <MissingPanel instanceId={id} onDismissed={close} />}
        </PopoverChip>
      )}
      {updates > 0 && (
        <Tooltip content={t("ipage.notice.updates_hint")}>
          <Chip tone="accent" icon={<RefreshCw size={13} />} short={updates} onClick={showUpdates}>
            {updates === 1 ? t("ipage.notice.updates_1") : t("ipage.notice.updates", { n: updates })}
          </Chip>
        </Tooltip>
      )}
    </div>
  );
}
