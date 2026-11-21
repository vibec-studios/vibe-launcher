// Client-Packs: Karten (Name, Kurzbeschreibung, Badge Offiziell/Community, Herkunft bei Community-Packs) mit
// Installieren/Aktualisieren/Entfernen. Clients schließen sich aus: Beim Wechsel wird nach Bestätigung das alte
// Pack entfernt (Backend `client_pack_install` mit `replace`). Keine fremden Logos/Brandings – neutrale Icons.
// `ClientPackPicker` ist die kompakte Auswahl im Dialog „Neue Instanz“.
import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowUpCircle, Check, Download, ExternalLink, Gem, Trash2, Users, Zap } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useEvent } from "@/lib/events";
import { isRunning, useGameState, waitForTask } from "@/lib/queries";
import { loaderNames } from "@/lib/format";
import type { ClientPackOffer, ClientPacksOverview, Instance, LoaderKind } from "@/lib/types";
import { Button, ErrorState, Select, Skeleton, Tooltip, cn, confirm, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { useExpert } from "@/lib/simple-mode";

export const cpk = {
  instance: (id: string) => ["client-packs", "instance", id] as const,
  plan: (mc: string, loader: LoaderKind) => ["client-packs", "plan", mc, loader] as const,
};

/** Neutrale Icons (kein Branding fremder Clients). */
const ICONS: Record<string, ReactNode> = {
  norisk: <Zap size={18} />,
  "norisk-mini": <Zap size={15} />,
  essential: <Users size={18} />,
};

/** Bereich der unterstützten Versionen, z. B. „1.8.9 – 26.3“. */
function versionRange(list: string[]) {
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

export function packName(t: ReturnType<typeof useT>, id: string) {
  return t(`cp.${id}.name`);
}

const DISCONTINUED = new Set(["vibey"]);

export const offeredPack = (p: ClientPackOffer) => !DISCONTINUED.has(p.id);

/** Packs, die beim Installieren von `offer` weichen müssen (gleiche Gruppe, installiert). */
function rivals(offer: ClientPackOffer, all: ClientPackOffer[]) {
  return all.filter((o) => o.id !== offer.id && !!o.installed && !!offer.group && o.group === offer.group);
}

export function useClientPacks(instance: Instance) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: cpk.instance(instance.id), queryFn: () => api.clientPacksList({ instanceId: instance.id }), staleTime: 60_000 });
  useEvent("content://changed", (p) => {
    if (p.instance_id === instance.id) void qc.invalidateQueries({ queryKey: cpk.instance(instance.id) });
  });
  return q;
}

/** Bestätigung beim Client-Wechsel. `null` = abgebrochen, sonst: andere Packs ersetzen? */
export async function confirmSwitch(t: ReturnType<typeof useT>, offer: ClientPackOffer, all: ClientPackOffer[]): Promise<boolean | null> {
  const others = rivals(offer, all);
  if (!others.length) return false;
  const name = packName(t, offer.id);
  const ok = await confirm({
    title: t("cp.switch.title"),
    text: t("cp.switch.text", { old: others.map((o) => packName(t, o.id)).join(", "), new: name }),
    confirmLabel: t("cp.switch.confirm"),
  });
  return ok ? true : null;
}

/** Installiert/aktualisiert ein Pack (nach `confirmSwitch`). */
export async function installPack(t: ReturnType<typeof useT>, instanceId: string, offer: ClientPackOffer, replace: boolean): Promise<boolean> {
  const name = packName(t, offer.id);
  try {
    const task = await api.clientPackInstall(instanceId, offer.id, replace);
    const r = await waitForTask(task);
    toast.success(t("cp.done", { name }), r.message ?? undefined);
    return true;
  } catch (e) {
    if ((e as { kind?: string })?.kind !== "cancelled") toast.error(e, t("cp.failed", { name }));
    return false;
  }
}

export function ClientPacks({ instance, only, compact }: { instance: Instance; only?: string[]; compact?: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const q = useClientPacks(instance);
  const running = isRunning(useGameState(instance.id));
  const [busy, setBusy] = useState<string | null>(null);

  if (q.isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 max-[980px]:grid-cols-1">
        {Array.from({ length: only?.length ?? 4 }, (_, i) => (
          <Skeleton key={i} className="h-[168px]" />
        ))}
      </div>
    );
  }
  if (!q.data) return <p className="px-1 text-[13px] text-danger">{errorMessage(q.error)}</p>;
  const data = q.data;
  const visible = data.packs.filter((p) => (!only || only.includes(p.id)) && offeredPack(p));

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: cpk.instance(instance.id) });
  };
  const run = async (id: string, f: () => Promise<unknown>) => {
    setBusy(id);
    try {
      await f();
    } finally {
      setBusy(null);
      refresh();
    }
  };
  const remove = async (o: ClientPackOffer) => {
    const name = packName(t, o.id);
    const ok = await confirm({ title: t("cp.remove.title", { name }), text: t("cp.remove.text"), confirmLabel: t("cp.remove"), danger: true });
    if (!ok) return;
    await run(o.id, async () => {
      try {
        await api.clientPackRemove(instance.id, o.id);
        toast.success(t("cp.removed", { name }));
      } catch (e) {
        toast.error(e, t("cp.remove_failed", { name }));
      }
    });
  };

  const groups: { key: "official" | "community"; items: ClientPackOffer[] }[] = (["official", "community"] as const)
    .map((key) => ({ key, items: visible.filter((p) => p.category === key) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="flex flex-col gap-5">
      {groups.map((g) => (
        <section key={g.key} className="flex flex-col gap-2">
          {!compact && <h3 className="text-[16px] font-semibold text-text">{t(`cp.group.${g.key}`)}</h3>}
          {/* Ein einzelnes Pack nimmt die ganze Breite statt einer halben Kachel */}
          <div className={cn("grid gap-3", compact || g.items.length === 1 ? "grid-cols-1" : "grid-cols-2 max-[980px]:grid-cols-1")}>
            {g.items.map((o) => (
              <PackCard
                key={o.id}
                offer={o}
                data={data}
                busy={busy === o.id}
                locked={running || (busy !== null && busy !== o.id)}
                running={running}
                onInstall={async () => {
                  const replace = await confirmSwitch(t, o, data.packs);
                  if (replace !== null) await run(o.id, () => installPack(t, instance.id, o, replace));
                }}
                onRemove={() => remove(o)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function PackCard({
  offer: o,
  data,
  busy,
  locked,
  running,
  onInstall,
  onRemove,
}: {
  offer: ClientPackOffer;
  data: ClientPacksOverview;
  busy: boolean;
  locked: boolean;
  running: boolean;
  onInstall: () => void;
  onRemove: () => void;
}) {
  const t = useT();
  const tech = useExpert("tech-details");
  const inst = o.installed;
  const official = o.category === "official";
  const range = versionRange(o.mc_versions);

  // Statuszeile
  let status: ReactNode = null;
  let tone: "muted" | "warn" | "ok" | "brand" = "muted";
  if (inst) {
    if (inst.mismatch) {
      status = t("cp.mismatch", { mc: inst.mc_version ?? "?" });
      tone = "warn";
    } else if (inst.missing) {
      status = t("cp.missing");
      tone = "warn";
    } else if (o.update_available && o.latest_version) {
      status = t("cp.update_to", { v: o.latest_version });
      tone = "brand";
    } else {
      status = inst.version ? t("cp.installed_v", { v: inst.version }) : t("cp.installed");
      tone = "ok";
    }
    if (inst.disabled_by_user && !inst.missing) {
      status = (
        <>
          {status} · {t("cp.disabled_by_user")}
        </>
      );
    }
  } else if (o.available === false) {
    status =
      o.reason === "loader"
        ? t("cp.reason.loader", { loader: loaderNames[data.loader] })
        : o.reason === "vibe_off"
          ? t("cp.reason.vibe_off")
          : range
            ? t("cp.reason.version_range", { mc: data.mc_version, range })
            : t("cp.reason.version", { mc: data.mc_version });
  } else if (o.available === null) {
    tone = "warn";
    status = o.source === "norisk" ? t("cp.norisk.unreachable") : t("cp.reason.unreachable");
  }

  const canInstall = !inst && o.available === true;
  const canUpdate = !!inst && (o.update_available || inst.missing) && o.available !== false;
  const reason = running ? t("cp.running") : null;

  return (
    <article className={cn("flex min-w-0 flex-col gap-4 rounded-card border bg-surface p-4", inst ? "border-accent/45" : "border-line")}>
      <div className="flex items-start gap-3">
        <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-ctl bg-surface3", official ? "text-brand" : "text-muted")}>
          {ICONS[o.id] ?? <Gem size={18} />}
        </span>
        <div className="min-w-0 flex-1">
          <h4 className="break-words text-[16px] font-semibold text-text">{packName(t, o.id)}</h4>
          <p className="mt-1 text-[14px] leading-snug text-muted">{t(`cp.${o.id}.desc`)}</p>
        </div>
      </div>

      {/* Herkunft (Anbieter, Website, woher die Datei kommt) gesammelt über den Aktionen – die Knöpfe stehen unten */}
      <div className="flex flex-col gap-1 text-[13px] leading-snug text-muted empty:hidden">
        {!official && o.vendor && (
          <div className="flex flex-wrap items-center gap-x-2">
            <span>{t("cp.attribution", { vendor: o.vendor })}</span>
            {o.homepage && (
              <a href={o.homepage} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted hover:text-text hover:underline">
                {new URL(o.homepage).host.replace(/^www\./, "")}
                <ExternalLink size={11} />
              </a>
            )}
          </div>
        )}
        {/* Woher die Datei kommt: Detail für Experten */}
        {tech && <p>{t(`cp.source.${o.source}`)}</p>}
      </div>

      <div className="mt-auto flex min-h-10 flex-wrap items-center gap-2 border-t border-line pt-3">
        <div
          className={cn(
            "flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px]",
            tone === "warn" ? "text-warn" : tone === "ok" ? "text-ok" : tone === "brand" ? "text-brand" : "text-muted",
          )}
        >
          {tone === "warn" && <AlertTriangle size={12} className="shrink-0" />}
          {tone === "ok" && <Check size={12} className="shrink-0" />}
          {tone === "brand" && <ArrowUpCircle size={12} className="shrink-0" />}
          <span className="min-w-0 break-words">
            {status}
          </span>
          {o.available === null && o.source === "norisk" && o.homepage && (
            <a href={o.homepage} target="_blank" rel="noreferrer" className="shrink-0 font-semibold text-text hover:underline">
              {t("cp.norisk.download_site")}
            </a>
          )}
        </div>
        {inst && (
          <Tooltip content={reason}>
            <span>
              <Button size="sm" variant="subtle" icon={<Trash2 size={13} />} disabled={locked || busy} onClick={onRemove}>
                {t("cp.remove")}
              </Button>
            </span>
          </Tooltip>
        )}
        {(canInstall || canUpdate) && (
          <Tooltip content={reason}>
            <span>
              <Button
                size="sm"
                variant="accent"
                icon={canUpdate ? <ArrowUpCircle size={13} /> : <Download size={13} />}
                loading={busy}
                disabled={locked}
                onClick={onInstall}
              >
                {canUpdate ? t("cp.update") : t("cp.install")}
              </Button>
            </span>
          </Tooltip>
        )}
      </div>
    </article>
  );
}

// ------------------------------------------------------------------ Auswahl beim Erstellen

/** Kompakte Pack-Auswahl für „Neue Instanz“ (nur Packs, die zu Version + Loader passen). */
export function ClientPackPicker({ mc, loader, value, onChange }: { mc: string | null; loader: LoaderKind; value: string | null; onChange: (id: string | null) => void }) {
  const t = useT();
  const q = useQuery({
    queryKey: cpk.plan(mc ?? "", loader),
    queryFn: () => api.clientPacksList({ mcVersion: mc!, loader }),
    enabled: !!mc && loader !== "vanilla",
    staleTime: 5 * 60_000,
  });
  const packs = (q.data?.packs ?? []).filter(offeredPack);
  const selected = packs.find((p) => p.id === value);
  useEffect(() => {
    if (value && q.data && selected?.available !== true) onChange(null);
  }, [value, q.data, selected, onChange]);
  return (
    <div className="flex flex-col gap-2">
      <Select<string>
        value={value ?? "none"}
        disabled={loader === "vanilla" || !mc || q.isPending}
        onChange={(v) => onChange(v === "none" ? null : v)}
        options={[
          { value: "none", label: t("cp.new.none") },
          ...packs.map((p) => ({
            value: p.id,
            label: packName(t, p.id),
            hint: p.available === true ? t(`cp.badge.${p.category}`) : p.available === null ? t("cp.reason.unreachable") : t("cp.new.unavailable"),
            disabled: p.available !== true,
          })),
        ]}
      />
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : selected ? (
        <p className="text-[14px] text-muted">{t(`cp.${selected.id}.desc`)}</p>
      ) : null}
    </div>
  );
}

/** Nach dem Anlegen: gewähltes Pack installieren (Fehler als Toast). */
export async function installPackAfterCreate(t: ReturnType<typeof useT>, instanceId: string, packId: string) {
  const name = packName(t, packId);
  try {
    const task = await api.clientPackInstall(instanceId, packId, false);
    const r = await waitForTask(task);
    toast.success(t("cp.done", { name }), r.message ?? undefined);
  } catch (e) {
    if ((e as { kind?: string })?.kind !== "cancelled") toast.error(e, t("cp.failed", { name }));
  }
}
