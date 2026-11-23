import { useNavigate } from "@tanstack/react-router";
import type { Instance } from "@/lib/types";
import { formatRelative, instanceAccent } from "@/lib/format";
import { ContextMenu, Tooltip } from "@/components/ui";
import { InstanceIcon } from "@/components/instance/InstanceIcon";
import { InstanceContextMenuContent } from "@/components/instance/InstanceMenu";
import { PlayButton } from "@/components/instance/PlayButton";
import { accentVars } from "@/components/instance/accent";
import { useInstanceActions } from "@/components/instance/actions";
import { useRunPhase } from "@/components/instance/status";
import { ShotThumb, openShot, useScreenshots } from "@/features/screenshots/shots";
import { useT } from "@/i18n";
import { Notice, SpotThumb, continueMeta } from "../Continue";
import type { Spot } from "../data";

function Backdrop({ instance: i }: { instance: Instance }) {
  const t = useT();
  const nav = useNavigate();
  const shot = useScreenshots(i.id).data?.[0];
  if (!shot)
    return (
      <div
        aria-hidden
        className="absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(60% 120% at 100% 0%, color-mix(in srgb, var(--accent) 26%, transparent), transparent 70%), radial-gradient(50% 90% at 85% 100%, color-mix(in srgb, var(--accent) 14%, transparent), transparent 70%)",
        }}
      />
    );
  return (
    <button
      onClick={() => {
        openShot(shot.path);
        nav({ to: "/screenshots", search: { instance: i.id } });
      }}
      title={`${t("nav.screenshots")} · ${formatRelative(shot.taken_at)}`}
      className="absolute inset-y-0 right-0 -z-10 hidden w-[62%] overflow-hidden @min-[720px]:block"
    >
      <ShotThumb path={shot.path} className="absolute inset-0" />
      <span aria-hidden className="absolute inset-0 bg-[linear-gradient(90deg,var(--surface-1)_0%,color-mix(in_srgb,var(--surface-1)_70%,transparent)_30%,transparent_75%)]" />
    </button>
  );
}

export function HeroV2({ instance: i, spot }: { instance: Instance; spot: Spot | null }) {
  const t = useT();
  const nav = useNavigate();
  const { launch } = useInstanceActions();
  const { phase } = useRunPhase(i.id);
  const accent = instanceAccent(i.id, i.accent);
  const open = () => nav({ to: "/instances/$id", params: { id: i.id }, search: { tab: "content" } });
  return (
    <section
      data-part="home-hero card"
      aria-label={t("home.continue")}
      className="vl2-hero @container relative isolate min-w-0 overflow-hidden rounded-panel bg-surface shadow-e1"
      style={accentVars(accent)}
    >
      <Backdrop instance={i} />
      <div className="pointer-events-none flex min-h-[248px] max-w-[min(640px,100%)] flex-col justify-center gap-5 p-7 @min-[720px]:max-w-[58%] [&_*]:pointer-events-auto">
        <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-accent">{t("home.continue")}</span>
        <ContextMenu content={<InstanceContextMenuContent instance={i} />}>
          <div className="flex min-w-0 items-center gap-5">
            <button onClick={open} aria-label={i.name} className="shrink-0 rounded-card shadow-[0_8px_24px_-8px_rgb(0_0_0/0.6)] transition-transform duration-200 hover:-translate-y-0.5">
              <InstanceIcon icon={i.icon} seed={i.id} accent={accent} size={80} />
            </button>
            <div className="min-w-0 flex-1">
              <button onClick={open} className="block max-w-full truncate text-left text-[32px] font-bold leading-[1.1] tracking-[-0.03em] text-text hover:underline" title={i.name}>
                {i.name}
              </button>
              <div className="mt-1.5 truncate text-meta text-muted">{continueMeta(i, t).join(" · ")}</div>
              <div className="-ml-2 mt-1 flex min-h-[26px] min-w-0 items-center empty:hidden">
                <Notice instance={i} />
              </div>
            </div>
          </div>
        </ContextMenu>
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <PlayButton instance={i} size="lg" />
          {spot && phase === "idle" && (
            <Tooltip content={spot.kind === "world" ? t("home.continue.world_hint") : t("home.continue.server_hint")}>
              <button
                onClick={() => (spot.kind === "world" ? launch(i, spot.world.folder) : launch(i, null, spot.server.address))}
                className="flex h-11 min-w-0 max-w-[320px] items-center gap-2.5 rounded-ctl bg-surface2/80 pl-1.5 pr-4 text-left shadow-[inset_0_0_0_1px_var(--line-1)] backdrop-blur-sm transition-colors duration-150 hover:bg-surface3"
              >
                <SpotThumb spot={spot} size={32} />
                <span className="min-w-0 leading-tight">
                  <span className="block truncate text-[13.5px] font-semibold text-text">
                    {spot.kind === "world" ? t("home.continue.world", { name: spot.world.name }) : t("home.continue.server", { name: spot.server.address })}
                  </span>
                  <span className="block truncate text-caption text-muted">{formatRelative(spot.at)}</span>
                </span>
              </button>
            </Tooltip>
          )}
        </div>
      </div>
    </section>
  );
}
