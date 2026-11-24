// „Zuletzt gespielt“ (Instanzen als kompakte Kacheln) und „Welten und Server“ (direkt startbar per Quick Play).
import type { ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight, Play } from "lucide-react";
import type { Instance } from "@/lib/types";
import { formatRelative, instanceAccent } from "@/lib/format";
import { ContextMenu, IconButton, Skeleton, Tooltip, cn } from "@/components/ui";
import { InstanceStatus, loaderLine } from "@/components/instance/InstanceCard";
import { CustomLoaderLine } from "@/features/customloaders/LoaderBadge";
import { InstanceIcon } from "@/components/instance/InstanceIcon";
import { InstanceContextMenuContent } from "@/components/instance/InstanceMenu";
import { accentVars } from "@/components/instance/accent";
import { useInstanceActions } from "@/components/instance/actions";
import { useRunPhase } from "@/components/instance/status";
import { usePing } from "@/components/instance/motd";
import { useT } from "@/i18n";
import { SpotThumb, spotName } from "./Continue";
import { useFitColumns, type Spot } from "./data";

export function SectionHead({ title, count, link }: { title: ReactNode; count?: ReactNode; link?: ReactNode }) {
  return (
    <div className="mb-2.5 flex h-6 items-center gap-2">
      <h2 className="min-w-0 truncate text-section text-text">{title}</h2>
      {count != null && <span className="text-meta tabular-nums text-dim">{count}</span>}
      <div className="flex-1" />
      {link}
    </div>
  );
}

export function MoreLink({ to, children, search }: { to: string; children: ReactNode; search?: Record<string, unknown> }) {
  return (
    <Link
      to={to}
      search={search as never}
      className="group flex shrink-0 items-center gap-0.5 text-meta font-medium text-muted transition-colors duration-100 hover:text-text"
    >
      {children}
      <ChevronRight size={14} className="transition-transform duration-150 group-hover:translate-x-0.5" />
    </Link>
  );
}

/** Kompakte Kachel: Icon (Hover: Spielen-Fläche darüber), Name, Loader/Version und wann zuletzt gespielt. */
function RecentTile({ instance: i }: { instance: Instance }) {
  const t = useT();
  const nav = useNavigate();
  const { launch } = useInstanceActions();
  const { phase } = useRunPhase(i.id);
  const accent = instanceAccent(i.id, i.accent);
  const open = () => nav({ to: "/instances/$id", params: { id: i.id }, search: { tab: "content" } });
  const status = phase !== "idle" || i.install_state === "failed" || i.install_state === "installing";
  return (
    <ContextMenu content={<InstanceContextMenuContent instance={i} />}>
      <div
        role="button"
        tabIndex={0}
        aria-label={i.name}
        onClick={open}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
          e.preventDefault();
          if (!e.repeat) open();
        }}
        style={accentVars(accent)}
        className="group flex min-w-0 items-center gap-3 rounded-panel bg-surface p-2 pr-3 transition-colors duration-100 hover:bg-surface2 data-[state=open]:bg-surface2"
      >
        <span className="relative shrink-0">
          <InstanceIcon icon={i.icon} seed={i.id} accent={accent} size={44} />
          <Tooltip content={phase === "running" ? t("inst.status.running") : t("common.play")}>
            <button
              aria-label={t("common.play")}
              disabled={phase !== "idle"}
              onClick={(e) => {
                e.stopPropagation();
                launch(i);
              }}
              onKeyDown={(e) => e.stopPropagation()}
              className="absolute inset-0 grid place-items-center bg-accent text-[var(--on-accent)] opacity-0 transition-opacity duration-100 focus-visible:opacity-100 group-hover:opacity-100 disabled:hidden"
            >
              <Play size={18} fill="currentColor" />
            </button>
          </Tooltip>
          {phase === "running" && <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-dot border-2 border-[var(--tone-s1)] bg-ok" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-semibold text-text" title={i.name}>
            {i.name}
          </span>
          <span className="block truncate text-[12px] text-muted">{i.custom_loader ? <CustomLoaderLine instance={i} suffix={i.mc_version} /> : loaderLine(i)}</span>
          <span className="block truncate text-[12px] text-dim">
            {status ? <InstanceStatus instance={i} compact /> : i.last_played ? formatRelative(i.last_played) : t("home.never")}
          </span>
        </span>
      </div>
    </ContextMenu>
  );
}

/** Eine Zeile Kacheln – so viele, wie hineinpassen (kein halbes Raster, keine verwaiste Kachel). */
export function RecentInstances({ list, total }: { list: Instance[]; total: number }) {
  const t = useT();
  const [ref, fit] = useFitColumns<HTMLDivElement>(200);
  if (!list.length) return null;
  const cols = Math.min(fit, list.length);
  return (
    <section>
      <SectionHead
        title={t("home.recent")}
        link={
          <MoreLink to="/instances">
            {t("home.library")} · {total}
          </MoreLink>
        }
      />
      <div ref={ref} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {list.slice(0, cols).map((i) => (
          <RecentTile key={i.id} instance={i} />
        ))}
      </div>
    </section>
  );
}

function SpotRow({ spot }: { spot: Spot }) {
  const t = useT();
  const nav = useNavigate();
  const { launch } = useInstanceActions();
  const i = spot.instance;
  const { phase } = useRunPhase(i.id);
  const ping = usePing(spot.kind === "server" ? spot.server.address : null);
  const name = spotName(spot);
  const mode = spot.kind === "world" ? spot.world.game_mode?.toLowerCase() : null;
  const modeText = mode && ["survival", "creative", "adventure", "spectator", "hardcore"].includes(mode) ? t(`worlds.mode.${mode}`) : null;
  const detail =
    spot.kind === "world"
      ? [t("home.jump.world"), modeText].filter(Boolean).join(" · ")
      : [
          t("home.jump.server"),
          ping.data?.online && ping.data.players_online != null
            ? t("home.jump.players", { n: ping.data.players_online.toLocaleString(), max: ping.data.players_max?.toLocaleString() ?? "?" })
            : ping.data && !ping.data.online
              ? t("home.jump.offline")
              : null,
        ]
          .filter(Boolean)
          .join(" · ");
  const play = () => (spot.kind === "world" ? launch(i, spot.world.folder) : launch(i, null, spot.server.address));
  const label = spot.kind === "world" ? t("home.jump.play_world", { name }) : t("home.jump.join", { name });
  return (
    <ContextMenu content={<InstanceContextMenuContent instance={i} />}>
      <div
        className="group flex h-14 min-w-0 items-center gap-3 px-3 transition-colors duration-100 hover:bg-white/[.03] data-[state=open]:bg-white/[.03]"
        style={accentVars(instanceAccent(i.id, i.accent))}
        onDoubleClick={() => phase === "idle" && play()}
      >
        <SpotThumb spot={spot} size={36} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-semibold text-text" title={name}>
            {name}
          </div>
          <div className="truncate text-[12px] text-muted">{detail}</div>
        </div>
        <button
          onClick={() => nav({ to: "/instances/$id", params: { id: i.id }, search: { tab: spot.kind === "world" ? "worlds" : "servers" } })}
          className="hidden min-w-0 max-w-[220px] truncate text-right text-[12px] text-muted transition-colors duration-100 hover:text-text @min-[520px]:block"
          title={i.name}
        >
          {i.name}
        </button>
        <span className="hidden w-[92px] shrink-0 text-right text-[12px] tabular-nums text-dim @min-[420px]:block">{formatRelative(spot.at)}</span>
        <IconButton
          label={label}
          tip
          size="sm"
          variant="ghost"
          disabled={phase !== "idle"}
          onClick={play}
          className="text-muted group-hover:bg-accent group-hover:text-[var(--on-accent)]"
        >
          <Play size={14} fill="currentColor" />
        </IconButton>
      </div>
    </ContextMenu>
  );
}

const spotGrid1 = "grid-cols-1 [&>:nth-child(n+2)]:border-t";
const spotGrid2 = "grid-cols-2 [&>:nth-child(n+3)]:border-t [&>:nth-child(odd)]:border-r [&>:last-child:nth-child(odd)]:col-span-2 [&>:last-child:nth-child(odd)]:border-r-0";

export function JumpBackIn({ spots, loading }: { spots: Spot[]; loading: boolean }) {
  const t = useT();
  const [ref, fit] = useFitColumns<HTMLDivElement>(560, 0);
  const cols = Math.min(fit, 2, Math.max(spots.length, 1));
  const shown = spots.slice(0, cols === 2 ? 8 : 5);
  if (!loading && !spots.length) return null;
  return (
    <section>
      <SectionHead title={t("home.jump")} />
      <div ref={ref} className="@container overflow-hidden rounded-panel bg-surface">
        {loading && !spots.length ? (
          <div className="flex flex-col gap-px p-2">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : (
          <div className={cn("grid [&>*]:border-line", cols === 2 ? spotGrid2 : spotGrid1)}>
            {shown.map((s) => (
              <SpotRow key={s.key} spot={s} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
