// „Weiterspielen“: die zuletzt gespielte Instanz mit ihrem letzten Einstieg (Welt per Quick Play oder Server).
// Eine Hauptaktion (Spielen), daneben genau ein Direkteinstieg – das, was man zuletzt in dieser Instanz gemacht hat.
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowUpCircle, HardDriveDownload, Server } from "lucide-react";
import type { Instance } from "@/lib/types";
import { formatDuration, formatRelative, imageSrc, instanceAccent, loaderNames } from "@/lib/format";
import { ContextMenu, Tooltip, cn } from "@/components/ui";
import { InstanceIcon, PixelBlock } from "@/components/instance/InstanceIcon";
import { InstanceStatus } from "@/components/instance/InstanceCard";
import { InstanceContextMenuContent } from "@/components/instance/InstanceMenu";
import { PlayButton } from "@/components/instance/PlayButton";
import { accentVars } from "@/components/instance/accent";
import { useInstanceActions } from "@/components/instance/actions";
import { useRunPhase } from "@/components/instance/status";
import { usePing } from "@/components/instance/motd";
import { useModpackUpdate } from "@/features/content/ModpackUpdate";
import { ShotThumb, openShot, useScreenshots } from "@/features/screenshots/shots";
import { useT } from "@/i18n";
import { useUpdateCounts, type Spot } from "./data";

/** Kleines Bild eines Einstiegs: Welt-Icon (level icon.png) bzw. Server-Favicon. */
export function SpotThumb({ spot, size }: { spot: Spot; size: number }) {
  const [failed, setFailed] = useState(false);
  const ping = usePing(spot.kind === "server" ? spot.server.address : null);
  const src = spot.kind === "world" ? imageSrc(spot.world.icon) : ping.data?.favicon;
  return (
    <span className="grid shrink-0 place-items-center overflow-hidden rounded-ctl bg-surface3" style={{ width: size, height: size }}>
      {src && !failed ? (
        <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover [image-rendering:pixelated]" />
      ) : spot.kind === "world" ? (
        <PixelBlock color="#5fbf4a" size={Math.round(size * 0.66)} />
      ) : (
        <Server size={Math.round(size * 0.45)} className="text-dim" />
      )}
    </span>
  );
}

export function spotName(s: Spot) {
  return s.kind === "world" ? s.world.name : s.server.address;
}

/** Hinweis rechts unten: Updates, Modpack-Version, „wird installiert“ – nur, wenn es etwas zu sagen gibt. */
export function Notice({ instance: i }: { instance: Instance }) {
  const t = useT();
  const nav = useNavigate();
  const { phase } = useRunPhase(i.id);
  const counts = useUpdateCounts();
  const pack = useModpackUpdate(i);
  const n = counts.data?.[i.id] ?? 0;
  const go = () => nav({ to: "/instances/$id", params: { id: i.id }, search: { tab: "content" } });
  // Startet/läuft/lädt: Fortschritt und Status zeigt schon der Spielen-Knopf darunter – nicht doppelt
  if (phase === "preparing" || phase === "busy") return null;
  if (phase !== "idle" || i.install_state === "failed" || i.install_state === "installing")
    return (
      <span className="min-w-0 truncate px-2 text-meta">
        <InstanceStatus instance={i} />
      </span>
    );
  if (i.install_state === "not_installed")
    return (
      <span className="flex items-center gap-1.5 px-2 text-meta text-muted">
        <HardDriveDownload size={13} className="shrink-0" />
        {t("home.installs_on_start")}
      </span>
    );
  if (!pack.data && !n) return null;
  return (
    <button
      onClick={go}
      className="flex min-w-0 items-center gap-1.5 rounded-ctl px-2 py-1 text-meta font-medium text-accent transition-colors duration-100 hover:bg-white/[.06]"
    >
      <ArrowUpCircle size={14} className="shrink-0" />
      <span className="truncate">
        {pack.data ? t("home.pack_update", { v: pack.data.latest.version_number }) : n === 1 ? t("home.updates_1") : t("home.updates_n", { n })}
      </span>
    </button>
  );
}

/** Zeile unter dem Namen: Loader/Version, zuletzt gespielt, Spielzeit. */
export function continueMeta(i: Instance, t: ReturnType<typeof useT>): string[] {
  const loader = i.loader.kind === "vanilla" ? "Vanilla" : `${loaderNames[i.loader.kind]} ${i.loader.version ?? ""}`.trim();
  return [
    i.bedrock ? (i.bedrock.channel === "preview" ? "Minecraft Bedrock Preview" : "Minecraft Bedrock") : `${loader} · Minecraft ${i.mc_version}`,
    i.last_played ? formatRelative(i.last_played) : t("home.never"),
    i.play_time_secs >= 60 ? t("home.played", { time: formatDuration(i.play_time_secs) }) : null,
  ].filter((x): x is string => !!x);
}

export function ContinueCard({ instance: i, spot }: { instance: Instance; spot: Spot | null }) {
  const t = useT();
  const nav = useNavigate();
  const { launch } = useInstanceActions();
  const { phase } = useRunPhase(i.id);
  const accent = instanceAccent(i.id, i.accent);
  const open = () => nav({ to: "/instances/$id", params: { id: i.id }, search: { tab: "content" } });
  const meta = continueMeta(i, t);

  return (
    <section aria-label={t("home.continue")} className="@container flex min-w-0 gap-5 rounded-panel bg-surface p-5" style={accentVars(accent)}>
      <div className="min-w-0 flex-1">
        <h2 className="mb-3 text-section text-muted">{t("home.continue")}</h2>
        <ContextMenu content={<InstanceContextMenuContent instance={i} />}>
          <div className="flex min-w-0 items-center gap-4">
            <button onClick={open} aria-label={i.name} className="shrink-0 transition-opacity duration-100 hover:opacity-85">
              <InstanceIcon icon={i.icon} accent={accent} size={72} />
            </button>
            <div className="min-w-0 flex-1">
              <button onClick={open} className="block max-w-full truncate text-left text-hero text-text hover:underline" title={i.name}>
                {i.name}
              </button>
              <div className="mt-1 truncate text-meta text-muted">{meta.join(" · ")}</div>
              <div className="-ml-2 mt-1 flex min-h-[26px] min-w-0 items-center empty:hidden">
                <Notice instance={i} />
              </div>
            </div>
          </div>
        </ContextMenu>
        <div className="mt-4 flex min-w-0 flex-wrap items-center gap-2">
          <PlayButton instance={i} size="lg" />
          {/* Direkteinstieg nur im Ruhezustand – während des Starts ist er ohnehin gesperrt und würde umbrechen */}
          {spot && phase === "idle" && (
            <Tooltip content={spot.kind === "world" ? t("home.continue.world_hint") : t("home.continue.server_hint")}>
              <button
                disabled={phase !== "idle"}
                onClick={() => (spot.kind === "world" ? launch(i, spot.world.folder) : launch(i, null, spot.server.address))}
                className={cn(
                  "flex h-11 min-w-0 max-w-[340px] items-center gap-2.5 rounded-ctl bg-surface2 pl-1.5 pr-4 text-left transition-colors duration-100 hover:bg-surface3",
                  "disabled:pointer-events-none disabled:opacity-45",
                )}
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
      <LastShot instance={i} />
    </section>
  );
}

/** Der letzte eigene Screenshot dieser Instanz – nur, wenn es einen gibt und Platz ist. Klick öffnet ihn groß. */
function LastShot({ instance: i }: { instance: Instance }) {
  const t = useT();
  const nav = useNavigate();
  const q = useScreenshots(i.id);
  const shot = q.data?.[0];
  if (!shot) return null;
  return (
    <button
      onClick={() => {
        openShot(shot.path);
        nav({ to: "/screenshots", search: { instance: i.id } });
      }}
      title={`${t("nav.screenshots")} · ${formatRelative(shot.taken_at)}`}
      className="relative hidden aspect-video w-[300px] shrink-0 self-center overflow-hidden rounded-card transition-opacity duration-100 hover:opacity-85 @min-[760px]:block @min-[1100px]:w-[400px]"
    >
      <ShotThumb path={shot.path} className="absolute inset-0" />
    </button>
  );
}
