import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Box, FileCog, Image, Minus, Package, Plus, RefreshCw, ShieldCheck, Sparkles, TriangleAlert } from "lucide-react";
import type { Instance } from "@/lib/types";
import { Button, Dialog, Skeleton, Tag, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { VibeError, type PackDiff, type PackDiffCategory, type PackDiffEntry } from "@/lib/vibe-sdk";
import { requireClient, errText } from "@/features/social/service";
import { openPackPreview } from "@/features/packupdate/store";
import { psk, vibePackOf } from "./api";

const CAT_ICON: Record<PackDiffCategory, React.ReactNode> = {
  mod: <Box size={13} />,
  resourcepack: <Image size={13} />,
  shader: <Sparkles size={13} />,
  datapack: <Package size={13} />,
  config: <FileCog size={13} />,
  other: <Package size={13} />,
};

const fileName = (p: string) => p.split("/").pop() ?? p;

function Entry({ e, prev }: { e: PackDiffEntry; prev?: string }) {
  const t = useT();
  return (
    <li className="flex min-h-9 items-center gap-2.5 px-3 py-1.5 text-[13px]">
      <span className="shrink-0 text-dim">{CAT_ICON[e.category]}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-text" title={e.path}>
          {fileName(e.path)}
        </span>
        {prev && prev !== fileName(e.path) && <span className="block truncate text-caption text-dim">{t("psync.diff.was", { name: prev })}</span>}
      </span>
      <Tag className="shrink-0">{t(`psync.cat.${e.category}`)}</Tag>
    </li>
  );
}

function Group({ kind, items }: { kind: "added" | "updated" | "removed"; items: { e: PackDiffEntry; prev?: string }[] }) {
  const t = useT();
  if (!items.length) return null;
  const icon = kind === "added" ? <Plus size={14} /> : kind === "removed" ? <Minus size={14} /> : <RefreshCw size={13} />;
  const tone = kind === "added" ? "text-ok" : kind === "removed" ? "text-danger" : "text-brand";
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className={cn("flex items-center gap-1.5 text-[13px] font-semibold", tone)}>
        {icon}
        {t(`psync.diff.${kind}`, { n: items.length })}
      </h3>
      <ul className="divide-y divide-line rounded-card bg-surface">
        {items.map((x) => (
          <Entry key={x.e.key} e={x.e} prev={x.prev} />
        ))}
      </ul>
    </section>
  );
}

function Summary({ d }: { d: PackDiff }) {
  const t = useT();
  const chips: [string, number, string][] = [
    ["added", d.summary.added, "bg-ok/10 text-ok"],
    ["updated", d.summary.updated, "bg-brand/10 text-brand"],
    ["removed", d.summary.removed, "bg-danger/10 text-danger"],
    ["unchanged", d.summary.unchanged, "bg-surface2 text-muted"],
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {chips.map(([k, n, cls]) => (
        <span key={k} className={cn("inline-flex h-7 items-center rounded-pill px-3 text-[12.5px] font-semibold tabular-nums", cls)}>
          {t(`psync.sum.${k}`, { n })}
        </span>
      ))}
    </div>
  );
}

function VersionChanges({ d }: { d: PackDiff }) {
  const t = useT();
  if (!d.mcVersion && !d.loader) return null;
  const loader = (l: { kind: string; version: string | null }) => `${l.kind}${l.version ? ` ${l.version}` : ""}`;
  return (
    <div className="flex items-start gap-2.5 rounded-card bg-warn/10 px-3 py-2.5 text-[13px]">
      <TriangleAlert size={15} className="mt-0.5 shrink-0 text-warn" />
      <div className="flex min-w-0 flex-col gap-1">
        <span className="font-semibold text-text">{t("psync.diff.game_change")}</span>
        {d.mcVersion && (
          <span className="flex items-center gap-1.5 text-muted">
            Minecraft {d.mcVersion.from} <ArrowRight size={12} /> <span className="text-text">{d.mcVersion.to}</span>
          </span>
        )}
        {d.loader && (
          <span className="flex items-center gap-1.5 text-muted">
            {loader(d.loader.from)} <ArrowRight size={12} /> <span className="text-text">{loader(d.loader.to)}</span>
          </span>
        )}
        <span className="text-caption text-dim">{t("psync.diff.game_change_hint")}</span>
      </div>
    </div>
  );
}

export function PackDiffDialog({ instance, code, toVersionId, onClose }: { instance: Instance; code: string; toVersionId: string | null; onClose: () => void }) {
  const t = useT();
  const ref = vibePackOf(instance);
  const from = ref?.versionId ?? null;
  const q = useQuery({
    queryKey: psk.diff(code, from ?? "", toVersionId),
    queryFn: () => requireClient().packs.diff(code, from!, toVersionId ?? undefined),
    enabled: !!from,
    retry: 0,
    staleTime: 60_000,
  });
  const d = q.data;
  const gone = !from || (q.error instanceof VibeError && q.error.status === 404);
  const groups = useMemo(
    () =>
      d
        ? {
            added: d.added.map((e) => ({ e })),
            updated: d.updated.map((e) => ({ e, prev: fileName(e.previous.path) })),
            removed: d.removed.map((e) => ({ e })),
          }
        : null,
    [d],
  );

  const apply = () => {
    onClose();
    openPackPreview(instance, { kind: "vibe", code, version_id: d?.to.id ?? toVersionId, link: null });
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      size="xl"
      title={t("psync.diff.title", { name: ref?.name ?? instance.name })}
      description={d ? t("psync.diff.desc", { from: d.from.version, to: d.to.version }) : t("psync.diff.desc_loading")}
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" disabled={!d && !gone} onClick={apply}>
            {t("psync.diff.apply")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {q.isPending && !gone ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8 w-80" />
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        ) : gone ? (
          <div className="flex items-start gap-2.5 rounded-card bg-surface px-3 py-3 text-[13px]">
            <RefreshCw size={15} className="mt-0.5 shrink-0 text-brand" />
            <div>
              <p className="font-medium text-text">{t("psync.diff.full_title")}</p>
              <p className="mt-1 text-muted">{t("psync.diff.full_text")}</p>
            </div>
          </div>
        ) : q.isError ? (
          <p className="selectable text-[13px] text-danger">{errText(q.error)}</p>
        ) : d && groups ? (
          <>
            <Summary d={d} />
            <VersionChanges d={d} />
            {d.to.changelog && (
              <section className="rounded-card bg-surface px-3 py-2.5">
                <h3 className="label mb-1">{t("psync.diff.changelog")}</h3>
                <p className="selectable whitespace-pre-wrap text-[13px] leading-relaxed text-text">{d.to.changelog}</p>
              </section>
            )}
            <div className="grid grid-cols-1 gap-4 min-[900px]:grid-cols-2">
              <div className="flex flex-col gap-4">
                <Group kind="updated" items={groups.updated} />
              </div>
              <div className="flex flex-col gap-4">
                <Group kind="added" items={groups.added} />
                <Group kind="removed" items={groups.removed} />
              </div>
            </div>
            {d.overridesChanged && (
              <p className="flex items-start gap-2 text-[13px] text-muted">
                <FileCog size={14} className="mt-0.5 shrink-0 text-dim" />
                {t("psync.diff.overrides")}
              </p>
            )}
          </>
        ) : null}
        <div className="flex items-start gap-2.5 rounded-card border border-line px-3 py-2.5 text-[13px] text-muted">
          <ShieldCheck size={15} className="mt-0.5 shrink-0 text-ok" />
          <span>{t("psync.diff.safe")}</span>
        </div>
      </div>
    </Dialog>
  );
}
