// Schalter „Vibey Client“ für eine Instanz (Fabric/NeoForge, unterstützte MC-Version laut Manifest).
// Fertige Komponente für den Platzhalter `VibeyClientSlot` der Instanz-Seite:  <VibeyClientSlot instance={inst} />
// An: Jar aus /api/v1/client/latest laden (SHA-256 geprüft), in mods/ legen (vom Launcher verwaltet), Pflicht-
// Abhängigkeiten (z. B. Fabric API) mitinstallieren; vor jedem Spielstart still aktualisieren. Aus: Jar entfernen.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, ArrowUpCircle, Sparkles } from "lucide-react";
import { useState } from "react";
import { Button, Spinner, Switch, Tooltip, cn, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { useEvent } from "@/lib/events";
import { isRunning, useGameState, waitForTask } from "@/lib/queries";
import type { Instance } from "@/lib/types";
import { vapi } from "./api";
import { cqk } from "./data";

const SUPPORTED = new Set(["fabric", "neoforge"]);

/** Bereich der unterstützten Versionen, z. B. „1.21.1 – 26.3“. */
function range(list: string[]) {
  if (!list.length) return "";
  const parse = (s: string) => s.split(/[.-]/).map((x) => Number(x) || 0);
  const sorted = [...list].sort((a, b) => {
    const pa = parse(a),
      pb = parse(b);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
    return 0;
  });
  return sorted.length === 1 ? sorted[0] : `${sorted[0]} – ${sorted[sorted.length - 1]}`;
}

export function VibeyClientSlot({ instance, className }: { instance: Instance; className?: string }) {
  const t = useT();
  const nav = useNavigate();
  const qc = useQueryClient();
  const loaderOk = SUPPORTED.has(instance.loader.kind);
  const game = useGameState(instance.id);
  const running = isRunning(game);
  const q = useQuery({
    queryKey: cqk.status(instance.id),
    queryFn: () => vapi.clientStatus(instance.id),
    enabled: loaderOk,
    staleTime: 60_000,
  });
  const [busy, setBusy] = useState(false);
  useEvent("content://changed", (p) => {
    if (p.instance_id === instance.id) void qc.invalidateQueries({ queryKey: cqk.status(instance.id) });
  });

  const s = q.data;
  // Für Forge/Quilt/Vanilla nichts anzeigen, solange nichts eingeschaltet ist
  if (!loaderOk && !s?.enabled) return null;

  const set = async (on: boolean) => {
    setBusy(true);
    try {
      const task = await vapi.clientSet(instance.id, on);
      if (task) {
        const r = await waitForTask(task);
        toast.success(t("vc.on_done"), r.message ?? undefined);
      } else toast.success(t("vc.off_done"));
    } catch (e) {
      toast.error(e, on ? t("vc.on_failed") : t("vc.off_failed"));
    } finally {
      setBusy(false);
      void qc.invalidateQueries({ queryKey: cqk.status(instance.id) });
      void qc.invalidateQueries({ queryKey: cqk.instances });
    }
  };

  let line: React.ReactNode = t("vc.lead");
  let tone: "muted" | "warn" | "ok" = "muted";
  let disabledReason: string | null = null;
  if (!s) {
    line = q.isError ? String((q.error as { message?: string })?.message ?? q.error) : t("vc.checking");
  } else if (!s.vibe_enabled) {
    disabledReason = t("vc.vibe_off");
    line = disabledReason;
    tone = "warn";
  } else if (s.enabled && s.present) {
    tone = "ok";
    line = s.disabled_by_user
      ? t("vc.disabled_by_user", { v: s.installed_version ?? "" })
      : s.update_available
        ? t("vc.update_next", { v: s.latest_version ?? "" })
        : t("vc.installed", { v: s.installed_version ?? "", ch: s.channel });
  } else if (s.enabled && !s.present) {
    tone = "warn";
    line = s.supported === false ? t("vc.unsupported_installed", { mc: instance.mc_version }) : t("vc.missing");
  } else if (s.supported === false) {
    disabledReason = t("vc.unsupported", { mc: instance.mc_version, range: range(s.mc_versions) || "—" });
    line = disabledReason;
  } else if (s.error) {
    line = t("vc.offline");
    tone = "warn";
  }

  const canToggle = !!s && !busy && !running && (s.enabled || (!disabledReason && s.supported !== false));
  return (
    <div className={cn("flex min-h-11 items-center gap-3 rounded-card bg-surface py-1.5 pl-2 pr-3", className)}>
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-ctl bg-brand/15 text-brand">
        <Sparkles size={16} />
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[13.5px] font-semibold text-text">Vibey Client</span>
          {s?.enabled && s.present && <span className="rounded-pill bg-brand/15 px-1.5 text-[10.5px] font-semibold text-brand">{t("vc.managed")}</span>}
        </div>
        <div className={cn("flex min-w-0 items-center gap-1.5 truncate text-[12.5px]", tone === "warn" ? "text-warn" : tone === "ok" ? "text-muted" : "text-dim")}>
          {tone === "warn" && <AlertTriangle size={12} className="shrink-0" />}
          {s?.update_available && <ArrowUpCircle size={12} className="shrink-0 text-brand" />}
          <span className="truncate">{line}</span>
        </div>
      </div>
      {s?.enabled && (
        <Button size="sm" variant="subtle" onClick={() => nav({ to: "/cosmetics" })}>
          {t("vc.wardrobe")}
        </Button>
      )}
      {busy && <Spinner size={14} className="text-brand" />}
      <Tooltip content={running ? t("vc.running") : (disabledReason ?? (s?.enabled ? t("vc.turn_off") : t("vc.turn_on")))}>
        <span>
          <Switch checked={!!s?.enabled} disabled={!canToggle} onChange={(v) => void set(v)} label="Vibey Client" />
        </span>
      </Tooltip>
    </div>
  );
}
