// OWNER: Auth-Agent. Abschnitt „MinecraftCapes“ der Skins-Seite: Cape/Ohren des Accounts (nur lesen,
// Verwaltung auf minecraftcapes.net) und Schalter für die MinecraftCapes-Mod je Instanz.
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { ExternalLink, Info, RotateCw, Sparkles } from "lucide-react";
import { memo, useState } from "react";
import { Button, IconButton, Skeleton, Spinner, Switch, Tag, Tooltip, cn, toast } from "@/components/ui";
import { InstanceBadge } from "@/components/content/InstanceBadge";
import { useT, t as tt } from "@/i18n";
import { useEvent } from "@/lib/events";
import { loaderNames } from "@/lib/format";
import { isRunning, queryClient, useGameStore, useInstances, waitForTask } from "@/lib/queries";
import type { Instance } from "@/lib/types";
import { MCCAPES_SITE, mcApi, mcq, useCapeFronts, useFrameIndex, type McCapeFrames, type McModStatus, type McProfile } from "./minecraftcapes";

async function openSite() {
  try {
    const m = await import("@tauri-apps/plugin-opener");
    await m.openUrl(MCCAPES_SITE);
  } catch {
    window.open(MCCAPES_SITE, "_blank");
  }
}

/** Vorderseite der Ohren (6×6 aus der 14×7-Textur) – als CSS-Ausschnitt, pixelgenau. */
function EarsThumb({ src, size }: { src: string; size: number }) {
  const px = size / 6;
  return (
    <div
      className="[image-rendering:pixelated]"
      style={{
        width: size,
        height: size,
        backgroundImage: `url(${src})`,
        backgroundSize: `${14 * px}px ${7 * px}px`,
        backgroundPosition: `${-1 * px}px ${-1 * px}px`,
      }}
      aria-hidden
    />
  );
}

/** Animierte 2D-Vorschau der Cape-Vorderseite. */
export function McCapeThumb({ frames, scale, className }: { frames: McCapeFrames | null; scale: number; className?: string }) {
  const fronts = useCapeFronts(frames, scale);
  const i = useFrameIndex(frames);
  const w = 10 * scale;
  const h = 16 * scale;
  if (!fronts.length) return <Skeleton className={className} style={{ width: w, height: h }} />;
  return <img src={fronts[i] ?? fronts[0]} alt="" draggable={false} className={cn("[image-rendering:pixelated]", className)} style={{ width: w, height: h }} />;
}

export function McCapesPanel({
  profileQ,
  frames,
  shown,
  onShownChange,
}: {
  profileQ: UseQueryResult<McProfile>;
  frames: McCapeFrames | null;
  shown: boolean;
  onShownChange: (v: boolean) => void;
}) {
  const t = useT();
  const p = profileQ.data;
  const has = !!p && (!!p.cape || !!p.ears);
  const reload = async () => {
    const r = await profileQ.refetch();
    if (r.isSuccess) toast.success(tt("mccapes.reloaded"));
  };

  return (
    <div className="scroll min-h-0 flex-1">
      <div className="flex flex-col gap-4 px-0.5 pb-1 pt-2">
        <p className="px-1 text-meta text-muted">{t("mccapes.lead")}</p>

        {/* ------------------------------------------------------------ Cape des Accounts */}
        <div className="overflow-hidden rounded-card bg-surface">
          {profileQ.isPending ? (
            <div className="flex gap-4 p-4">
              <Skeleton className="h-[96px] w-[60px]" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-48" />
              </div>
            </div>
          ) : profileQ.isError ? (
            <div className="flex items-center gap-3 p-4">
              <span className="min-w-0 flex-1 text-[13px] text-muted">{t("mccapes.error")}</span>
              <Button size="sm" icon={<RotateCw size={14} />} onClick={() => void profileQ.refetch()} loading={profileQ.isFetching}>
                {t("mccapes.reload")}
              </Button>
            </div>
          ) : has ? (
            <div className="flex gap-4 p-4">
              <div className="flex shrink-0 items-start gap-2">
                <div className="grid h-[112px] w-[76px] place-items-center rounded-ctl bg-surface2">
                  {p.cape ? <McCapeThumb frames={frames} scale={6} /> : <EarsThumb src={p.ears!.data_url} size={48} />}
                </div>
                {p.cape && p.ears && (
                  <Tooltip content={t("mccapes.ears")}>
                    <div className="grid h-[40px] w-[40px] place-items-center rounded-ctl bg-surface2">
                      <EarsThumb src={p.ears.data_url} size={30} />
                    </div>
                  </Tooltip>
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="text-[14px] font-semibold text-text">{p.cape ? t("mccapes.cape") : t("mccapes.ears_only")}</div>
                <div className="flex flex-wrap gap-1">
                  {p.cape && <Tag>{p.cape.layout.frames > 1 ? t("mccapes.feature.animated", { n: p.cape.layout.frames }) : t("mccapes.feature.static")}</Tag>}
                  {p.cape && p.glint && (
                    <Tag color="#b58cff">
                      <Sparkles size={10} />
                      {t("mccapes.feature.glint")}
                    </Tag>
                  )}
                  {p.upside_down && <Tag>{t("mccapes.feature.upside_down")}</Tag>}
                  {p.ears && <Tag>{t("mccapes.feature.ears")}</Tag>}
                </div>
                {p.texture_error && <div className="text-[12px] text-warn">{t("mccapes.texture_error")}</div>}
                <label className="mt-auto flex cursor-pointer items-center gap-2.5 text-[13px] text-text">
                  <Switch checked={shown} onChange={onShownChange} label={t("mccapes.show_in_preview")} />
                  {t("mccapes.show_in_preview")}
                </label>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 px-6 py-6 text-center">
              <Sparkles size={20} className="text-dim" />
              <div className="text-[14px] font-semibold text-text">{t("mccapes.empty_title")}</div>
              <p className="max-w-[380px] text-[12.5px] text-muted">{t("mccapes.empty_text")}</p>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1.5 px-4 pb-3">
            <Button size="sm" variant="ghost" icon={<ExternalLink size={14} />} onClick={() => void openSite()}>
              {has ? t("mccapes.manage") : t("mccapes.open_site")}
            </Button>
            <IconButton label={t("mccapes.reload")} tip variant="ghost" size="sm" disabled={profileQ.isFetching} onClick={() => void reload()}>
              {profileQ.isFetching && !profileQ.isPending ? <Spinner size={13} /> : <RotateCw size={14} />}
            </IconButton>
          </div>
        </div>

        <div className="flex gap-2.5 px-1 text-meta text-muted">
          <Info size={15} className="mt-px shrink-0 text-dim" />
          <div className="flex flex-col gap-1">
            <span className="text-text">{t("mccapes.only_mod")}</span>
            <span>{t("mccapes.manage_hint")}</span>
            <span className="text-dim">{t("mccapes.privacy")}</span>
          </div>
        </div>

        {/* ------------------------------------------------------------ Mod je Instanz */}
        <ModList />
      </div>
    </div>
  );
}

function ModList() {
  const t = useT();
  const instancesQ = useInstances();
  const statusQ = useQuery({ queryKey: mcq.mods, queryFn: mcApi.modStatus, staleTime: 60_000 });
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const instances = instancesQ.data ?? [];
  const byId = new Map((statusQ.data ?? []).map((s) => [s.instance_id, s]));

  useEvent("content://changed", () => void queryClient.invalidateQueries({ queryKey: mcq.mods }));

  const toggle = async (inst: Instance, on: boolean) => {
    setPending((p) => ({ ...p, [inst.id]: true }));
    try {
      const task = await mcApi.modSet(inst.id, on);
      if (task) await waitForTask(task);
      toast.success(on ? tt("mccapes.done_install", { name: inst.name }) : tt("mccapes.done_remove", { name: inst.name }));
    } catch (e) {
      toast.error(e, on ? tt("mccapes.error.install") : tt("mccapes.error.remove"));
    } finally {
      setPending((p) => ({ ...p, [inst.id]: false }));
      void queryClient.invalidateQueries({ queryKey: mcq.mods });
      void queryClient.invalidateQueries({ queryKey: ["content", inst.id] });
    }
  };

  return (
    <div className="flex flex-col">
      <div className="mb-1 px-1 text-section text-text">{t("mccapes.mod")}</div>
      <p className="mb-2 px-1 text-meta text-muted">{t("mccapes.mod_lead")}</p>
      {instancesQ.isPending || statusQ.isPending ? (
        <div className="flex flex-col gap-1.5">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[50px]" />
          ))}
        </div>
      ) : instances.length === 0 ? (
        <div className="rounded-card bg-surface px-3 py-3 text-meta text-dim">{t("mccapes.no_instances")}</div>
      ) : (
        <div className="flex flex-col overflow-hidden rounded-card bg-surface">
          {instances.map((inst) => (
            <ModRow key={inst.id} inst={inst} status={byId.get(inst.id)} pending={!!pending[inst.id]} onToggle={(on) => void toggle(inst, on)} />
          ))}
        </div>
      )}
    </div>
  );
}

const ModRow = memo(function ModRow({
  inst,
  status,
  pending,
  onToggle,
}: {
  inst: Instance;
  status: McModStatus | undefined;
  pending: boolean;
  onToggle: (on: boolean) => void;
}) {
  const t = useT();
  const running = useGameStore((s) => isRunning(s.states[inst.id]));
  const loader = loaderNames[inst.loader.kind];
  const installed = !!status?.installed;
  const reason =
    status?.unsupported === "vanilla"
      ? t("mccapes.unsupported.vanilla")
      : status?.unsupported === "no_version"
        ? t("mccapes.unsupported.no_version", { loader, mc: inst.mc_version })
        : status?.unsupported === "offline"
          ? t("mccapes.unsupported.offline")
          : null;
  // Installierte Mod lässt sich immer entfernen, auch wenn es keine passende neue Version gibt
  const unavailable = !!reason && !installed;
  const disabled = pending || running || unavailable || !status;
  const sub = pending
    ? t("mccapes.installing")
    : running
      ? t("mccapes.running")
      : unavailable
        ? reason
        : installed
          ? t("mccapes.installed_version")
          : status?.version_number
            ? t("mccapes.will_install", { v: status.version_number })
            : null;
  return (
    <div className={cn("flex items-center gap-3 border-b border-line px-3 py-2 transition-colors last:border-b-0 hover:bg-white/[.03]", unavailable && "opacity-55")}>
      <InstanceBadge instance={inst} size={32} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold text-text" title={inst.name}>
          {inst.name}
        </div>
        <div className="truncate text-[11.5px] text-dim">
          {loader} {inst.mc_version}
          {sub ? ` · ${sub}` : ""}
        </div>
      </div>
      {pending ? <Spinner size={14} /> : null}
      <Switch checked={installed} onChange={onToggle} disabled={disabled} label={`${t("mccapes.mod")}: ${inst.name}`} />
    </div>
  );
});
