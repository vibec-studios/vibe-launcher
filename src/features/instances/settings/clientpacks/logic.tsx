import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Users, Zap } from "lucide-react";
import { api } from "@/lib/api";
import { useEvent } from "@/lib/events";
import { waitForTask } from "@/lib/queries";
import type { ClientPackOffer, Instance, LoaderKind } from "@/lib/types";
import { confirm, toast } from "@/components/ui";
import type { useT } from "@/i18n";

export const cpk = {
  instance: (id: string) => ["client-packs", "instance", id] as const,
  plan: (mc: string, loader: LoaderKind) => ["client-packs", "plan", mc, loader] as const,
};

/** Neutrale Icons (kein Branding fremder Clients). */
export const ICONS: Record<string, ReactNode> = {
  norisk: <Zap size={18} />,
  "norisk-mini": <Zap size={15} />,
  essential: <Users size={18} />,
};

/** Bereich der unterstützten Versionen, z. B. „1.8.9 – 26.3“. */
export function versionRange(list: string[]) {
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

export const DISCONTINUED = new Set(["vibey"]);

export const offeredPack = (p: ClientPackOffer) => !DISCONTINUED.has(p.id);

/** Packs, die beim Installieren von `offer` weichen müssen (gleiche Gruppe, installiert). */
export function rivals(offer: ClientPackOffer, all: ClientPackOffer[]) {
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
