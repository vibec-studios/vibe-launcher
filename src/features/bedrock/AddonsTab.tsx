// Add-ons einer Bedrock-Instanz: installierte Packs mit Icon, Typ und Version; je Welt aktivieren, exportieren,
// entfernen. Dateien (.mcpack/.mcaddon/.mcworld/.mctemplate) per Drag & Drop oder Dateiauswahl, Suche auf CurseForge.
import { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, FileArchive, FolderOpen, Globe2, MoreHorizontal, Package, Search, Trash2, Upload } from "lucide-react";
import type { Instance } from "@/lib/types";
import { formatBytes, formatRelative } from "@/lib/format";
import {
  Button,
  DropdownItem,
  DropdownLabel,
  DropdownMenu,
  DropdownSeparator,
  DropdownSub,
  EmptyState,
  ErrorState,
  IconButton,
  SearchInput,
  Segmented,
  Skeleton,
  confirm,
  toast,
} from "@/components/ui";
import { registerDropTarget, useDragState } from "@/components/content/dragdrop";
import { fileExt } from "@/components/content/util";
import { useT, t as tt } from "@/i18n";
import { BEDROCK_EXTENSIONS, bedrockApi, bqk, type BedrockPack, type BedrockPackKind, type BedrockWorld } from "./api";
import { DataIcon, PackKindTag } from "./parts";
import { openAddonSearch } from "./AddonSearch";

type Filter = "all" | BedrockPackKind;

/** Dateien importieren und Ergebnis melden. */
export async function importBedrockFiles(instance: Instance, paths: string[]) {
  const files = paths.filter((p) => BEDROCK_EXTENSIONS.includes(fileExt(p)));
  if (!files.length) {
    toast.info(tt("bedrock.drop.unsupported"), tt("bedrock.drop.unsupported_text"));
    return;
  }
  try {
    const r = await bedrockApi.importFiles(instance.id, files);
    const parts = [
      r.packs.length ? tt(r.packs.length === 1 ? "bedrock.import.packs_1" : "bedrock.import.packs_n", { n: r.packs.length }) : null,
      r.worlds.length ? tt(r.worlds.length === 1 ? "bedrock.import.worlds_1" : "bedrock.import.worlds_n", { n: r.worlds.length }) : null,
    ].filter(Boolean);
    toast.success(tt("bedrock.import.done"), parts.join(" · ") || undefined);
  } catch (e) {
    toast.error(e, tt("bedrock.import.failed"));
  }
}

export async function pickBedrockFiles(instance: Instance) {
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const r = await open({ multiple: true, directory: false, title: tt("bedrock.import.pick"), filters: [{ name: "Minecraft Bedrock", extensions: BEDROCK_EXTENSIONS }] });
    const list = Array.isArray(r) ? r : typeof r === "string" ? [r] : [];
    if (list.length) await importBedrockFiles(instance, list);
  } catch (e) {
    toast.error(e);
  }
}

async function exportPack(instance: Instance, pack: BedrockPack) {
  try {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const ext = pack.kind === "world_template" ? "mctemplate" : "mcpack";
    const dest = await save({ title: tt("bedrock.export.title"), defaultPath: `${pack.name}.${ext}`, filters: [{ name: "Minecraft Bedrock", extensions: [ext] }] });
    if (!dest) return;
    await bedrockApi.packExport(instance.id, pack.id, dest);
    toast.success(tt("bedrock.export.done"), dest);
  } catch (e) {
    toast.error(e, tt("bedrock.export.failed"));
  }
}

/** „In Welten aktivieren“: je Welt ein Haken. */
function WorldToggles({ instance, pack, worlds }: { instance: Instance; pack: BedrockPack; worlds: BedrockWorld[] }) {
  const t = useT();
  const qc = useQueryClient();
  if (!worlds.length) return <DropdownItem disabled>{t("bedrock.addons.no_worlds")}</DropdownItem>;
  return (
    <>
      <DropdownLabel>{t("bedrock.addons.in_worlds")}</DropdownLabel>
      {worlds.map((w) => {
        const list = pack.kind === "behavior" ? w.behavior_packs : w.resource_packs;
        const on = list.includes(pack.uuid);
        return (
          <DropdownItem
            key={w.folder}
            icon={on ? <Check size={14} className="text-accent" /> : <span className="w-3.5" />}
            onSelect={async () => {
              try {
                await bedrockApi.worldPackSet(instance.id, w.folder, pack.id, !on);
                await qc.invalidateQueries({ queryKey: bqk.worlds(instance.id) });
              } catch (e) {
                toast.error(e, t("bedrock.addons.toggle_failed"));
              }
            }}
          >
            {w.name}
          </DropdownItem>
        );
      })}
    </>
  );
}

const PackRow = memo(function PackRow({ instance, pack, worlds }: { instance: Instance; pack: BedrockPack; worlds: BedrockWorld[] }) {
  const t = useT();
  const qc = useQueryClient();
  const active = worlds.filter((w) => (pack.kind === "behavior" ? w.behavior_packs : w.resource_packs).includes(pack.uuid)).length;
  const perWorld = pack.kind === "resource" || pack.kind === "behavior";
  const remove = async () => {
    const ok = await confirm({ title: t("bedrock.addons.remove_title", { name: pack.name }), text: t("bedrock.addons.remove_text"), confirmLabel: t("common.remove"), danger: true });
    if (!ok) return;
    try {
      await bedrockApi.packRemove(instance.id, pack.id);
      toast.success(t("bedrock.addons.removed"), pack.name);
      qc.invalidateQueries({ queryKey: bqk.packs(instance.id) });
    } catch (e) {
      toast.error(e, t("bedrock.addons.remove_failed"));
    }
  };
  const meta = [
    pack.version.length ? `v${pack.version.join(".")}` : null,
    perWorld ? (active ? t(active === 1 ? "bedrock.addons.active_1" : "bedrock.addons.active_n", { n: active }) : t("bedrock.addons.active_none")) : null,
    formatBytes(pack.size),
    pack.modified ? formatRelative(pack.modified) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="group flex h-14 items-center gap-3 px-6 transition-colors duration-100 hover:bg-white/[.03]" title={pack.description || undefined}>
      <DataIcon src={pack.icon} color={pack.kind === "behavior" ? "#ffb547" : "#5aa9ff"} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13.5px] font-semibold text-text">{pack.name}</span>
          <PackKindTag kind={pack.kind} />
          {pack.dev && <span className="text-[11px] text-dim">{t("bedrock.addons.dev")}</span>}
        </div>
        <div className="truncate text-[12px] leading-tight text-dim">{meta}</div>
      </div>
      {perWorld && (
        <DropdownMenu
          align="end"
          trigger={
            <Button size="sm" variant="subtle" icon={<Globe2 size={13} />} className="opacity-70 group-hover:opacity-100 data-[state=open]:opacity-100">
              {t("bedrock.addons.worlds_btn")}
            </Button>
          }
        >
          <WorldToggles instance={instance} pack={pack} worlds={worlds} />
        </DropdownMenu>
      )}
      <DropdownMenu
        trigger={
          <IconButton label={t("common.more")} size="sm" variant="ghost" className="opacity-60 group-hover:opacity-100 data-[state=open]:opacity-100">
            <MoreHorizontal size={15} />
          </IconButton>
        }
      >
        {perWorld && (
          <DropdownSub icon={<Globe2 size={14} />} label={t("bedrock.addons.in_worlds")}>
            <WorldToggles instance={instance} pack={pack} worlds={worlds} />
          </DropdownSub>
        )}
        <DropdownItem icon={<Upload size={14} />} onSelect={() => void exportPack(instance, pack)}>
          {t("bedrock.addons.export")}
        </DropdownItem>
        <DropdownSeparator />
        <DropdownItem icon={<Trash2 size={14} />} danger onSelect={() => void remove()}>
          {t("common.remove")}
        </DropdownItem>
      </DropdownMenu>
    </div>
  );
});

export function AddonsTab({ instance }: { instance: Instance }) {
  const t = useT();
  const packs = useQuery({ queryKey: bqk.packs(instance.id), queryFn: () => bedrockApi.packs(instance.id) });
  const worlds = useQuery({ queryKey: bqk.worlds(instance.id), queryFn: () => bedrockApi.worlds(instance.id) });
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const dq = useDeferredValue(query.trim().toLowerCase());
  const list = useMemo(
    () => (packs.data ?? []).filter((p) => (filter === "all" || p.kind === filter) && (!dq || p.name.toLowerCase().includes(dq) || p.description.toLowerCase().includes(dq))),
    [packs.data, filter, dq],
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of packs.data ?? []) c[p.kind] = (c[p.kind] ?? 0) + 1;
    return c;
  }, [packs.data]);

  // Ablageziel: Dateien auf die Liste ziehen
  const ref = useRef<HTMLDivElement>(null);
  const over = useDragState((s) => s.over === `bedrock-${instance.id}`);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return registerDropTarget({
      id: `bedrock-${instance.id}`,
      el,
      accepts: (paths) => paths.some((p) => BEDROCK_EXTENSIONS.includes(fileExt(p))),
      onDrop: (paths) => void importBedrockFiles(instance, paths),
    });
  }, [instance]);

  const kinds: { value: Filter; label: string }[] = [
    { value: "all", label: t("bedrock.filter.all") },
    { value: "resource", label: t("bedrock.filter.resource") },
    { value: "behavior", label: t("bedrock.filter.behavior") },
    ...((counts.skin ?? 0) > 0 ? [{ value: "skin" as const, label: t("bedrock.filter.skin") }] : []),
    ...((counts.world_template ?? 0) > 0 ? [{ value: "world_template" as const, label: t("bedrock.filter.world_template") }] : []),
  ];

  return (
    <div ref={ref} className="relative flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 px-6 pt-2">
        <SearchInput value={query} onChange={setQuery} placeholder={t("bedrock.addons.search_installed")} className="w-[220px] min-w-[140px] shrink [&_input]:h-8" />
        <Segmented value={filter} onChange={setFilter} items={kinds} />
        <div className="flex-1" />
        <IconButton label={t("bedrock.addons.open_folder")} tip variant="ghost" onClick={() => bedrockApi.openFolder(instance.id, "packs").catch((e) => toast.error(e))}>
          <FolderOpen size={16} />
        </IconButton>
        <Button size="sm" variant="ghost" icon={<FileArchive size={14} />} onClick={() => void pickBedrockFiles(instance)}>
          {t("bedrock.addons.import")}
        </Button>
        <Button size="sm" variant="primary" icon={<Search size={14} />} onClick={() => openAddonSearch(instance)}>
          {t("bedrock.addons.find")}
        </Button>
      </div>
      <div className="scroll min-h-0 flex-1 pb-6">
        {packs.isError && !packs.data ? (
          <ErrorState error={packs.error} onRetry={() => packs.refetch()} />
        ) : !packs.data ? (
          <div className="flex flex-col">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="flex h-14 items-center gap-3 px-6">
                <Skeleton className="h-9 w-9" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-3.5 w-56" />
                  <Skeleton className="h-3 w-36" />
                </div>
              </div>
            ))}
          </div>
        ) : packs.data.length === 0 ? (
          <EmptyState
            icon={<Package size={34} />}
            title={t("bedrock.addons.empty.title")}
            text={t("bedrock.addons.empty.text")}
            action={
              <div className="flex gap-2">
                <Button size="sm" variant="primary" icon={<Search size={14} />} onClick={() => openAddonSearch(instance)}>
                  {t("bedrock.addons.find")}
                </Button>
                <Button size="sm" variant="ghost" icon={<FileArchive size={14} />} onClick={() => void pickBedrockFiles(instance)}>
                  {t("bedrock.addons.import")}
                </Button>
              </div>
            }
          />
        ) : list.length === 0 ? (
          <EmptyState title={t("instances.no_match")} text={t("bedrock.addons.no_match")} />
        ) : (
          <div className="flex flex-col">
            {list.map((p) => (
              <PackRow key={p.id} instance={instance} pack={p} worlds={worlds.data ?? []} />
            ))}
            <p className="px-6 pt-4 text-[12px] text-dim">{t("bedrock.addons.drop_hint")}</p>
          </div>
        )}
      </div>
      {over && (
        <div className="pointer-events-none absolute inset-2 grid place-items-center rounded-panel border-2 border-dashed border-accent/70 bg-bg/80 animate-fade-in">
          <div className="flex flex-col items-center gap-2 text-center">
            <FileArchive size={30} className="text-accent" />
            <div className="text-title text-text">{t("bedrock.drop.title", { name: instance.name })}</div>
            <div className="text-[13px] text-muted">{t("bedrock.drop.text")}</div>
          </div>
        </div>
      )}
    </div>
  );
}
