// „Neue Instanz“: drei Wege oben als Tabs – Eigene (Loader + Version wählen), Modpack (fertige Pakete), Importieren.
// Eigene: links Identität (Icon mit Farbe, Name, Gruppe) und Loader als Karten, rechts die durchsuchbare
// Minecraft-Versionsliste mit Filter und markierter neuester Version. Unten fasst eine Zeile zusammen, was angelegt
// wird, daneben die eine Hauptaktion. Passt ohne Scrollen in 1024×700.
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import * as Popover from "@radix-ui/react-popover";
import { Term } from "@/features/help/glossary/Term";
import { Check, ChevronDown, ChevronRight, Download, FolderInput, HardDriveDownload, ImageIcon, PackageOpen } from "lucide-react";
import { api } from "@/lib/api";
import { useGameVersions, useInstances, useSystemInfo } from "@/lib/queries";
import type { LoaderKind, McVersion, ProjectHit } from "@/lib/types";
import { accentPalette, formatCount, loaderNames } from "@/lib/format";
import { Button, DropdownItem, DropdownMenu, ErrorState, Input, SearchInput, Segmented, Select, Skeleton, cn, toast } from "@/components/ui";
import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { InstanceIcon } from "@/components/instance/InstanceIcon";
import { IconGallery } from "@/components/instance/blocks/IconGallery";
import { isBlockIcon, randomBlockIcon } from "@/components/instance/blocks/catalog";
import { LoaderIcon } from "@/components/instance/LoaderIcon";
import { LOADERS, pickLoaderVersion, useLoaderGameVersions, useLoaderVersions, type VersionValue } from "@/components/instance/VersionPicker";
import { installInstance, pickImage } from "@/components/instance/actions";
import { startModpackInstall } from "@/components/content/install";
import { openImport } from "@/features/import/importStore";
import { PackIcon } from "@/features/home/Discover";
import { usePopularModpacks } from "@/features/home/data";
import { useT } from "@/i18n";
import { ClientPackPicker, installPackAfterCreate } from "./settings/ClientPacks";
import { SetPicker, installSetsAfterCreate, useSetCheck } from "@/features/modsets/SetPicker";
import { useSets } from "@/features/modsets/api";
import { NewBedrockTab } from "@/features/bedrock/NewBedrockTab";

export function suggestName(v: VersionValue): string {
  if (!v.mc) return "";
  return v.loader === "vanilla" ? `Minecraft ${v.mc}` : `${loaderNames[v.loader]} ${v.mc}`;
}

export function AccentPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup">
      {accentPalette.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={c === value}
          aria-label={c}
          onClick={() => onChange(c)}
          className={cn(
            "grid h-7 w-7 place-items-center rounded-ctl transition-opacity duration-100",
            c === value ? "opacity-100" : "opacity-70 hover:opacity-100",
          )}
          style={{ background: c }}
        >
          {c === value && <Check size={14} strokeWidth={3} color="#000" />}
        </button>
      ))}
    </div>
  );
}

export function GroupInput({ value, onChange, groups, autoFocus }: { value: string; onChange: (v: string) => void; groups: string[]; autoFocus?: boolean }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-2">
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={t("inst.group.placeholder")} maxLength={48} autoFocus={autoFocus} />
      {groups.length > 0 && (
        // Mit Beschriftung, sonst wirken die Chips wie zufällige Schlagwörter
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-0.5 text-[12px] text-dim">{t("inst.group.existing")}</span>
          {groups.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => onChange(g === value ? "" : g)}
              className={cn(
                "h-6 rounded-xs px-2 text-[12px] font-medium transition-colors",
                g === value ? "bg-accent text-[var(--on-accent)]" : "bg-white/[.06] text-muted hover:bg-white/[.1] hover:text-text",
              )}
            >
              {g}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type Tab = "custom" | "modpack" | "bedrock" | "import";
type Filter = "release" | "snapshot" | "old";

// ------------------------------------------------------------------ Icon + Farbe (Popover)

export function IconPicker({
  icon,
  accent,
  onIcon,
  onAccent,
}: {
  icon: string | null;
  accent: string;
  onIcon: (p: string | null) => void;
  onAccent: (c: string) => void;
}) {
  const t = useT();
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" aria-label={t("inst.icon.choose")} className="group relative shrink-0 outline-none">
          <InstanceIcon icon={icon} accent={accent} size={64} />
          <span className="absolute inset-0 grid place-items-center bg-black/55 text-text opacity-0 transition-opacity duration-100 group-hover:opacity-100 group-focus-visible:opacity-100 group-data-[state=open]:opacity-100">
            <ImageIcon size={18} />
          </span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className="z-[60] w-[316px] rounded-card bg-overlay p-3 shadow-e2 outline-none data-[state=open]:animate-[pop-in_.12s_var(--ease-snap)]"
        >
          <IconGallery value={icon} accent={accent} onChange={onIcon} onImage={async () => onIcon((await pickImage()) ?? icon)} />
          <div className="label mb-2 mt-3.5">{t("iconart.tint")}</div>
          <div className="grid grid-cols-8 gap-1">
            {accentPalette.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={c === accent}
                aria-label={c}
                onClick={() => onAccent(c)}
                className="grid aspect-square place-items-center rounded-xs transition-transform duration-100 hover:scale-110"
                style={{ background: c }}
              >
                {c === accent && <Check size={12} strokeWidth={3} color="#000" />}
              </button>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ------------------------------------------------------------------ Gruppe (freier Text + vorhandene Gruppen)

export function GroupField({ value, onChange, groups }: { value: string; onChange: (v: string) => void; groups: string[] }) {
  const t = useT();
  return (
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={t("newinst.group.placeholder")}
      maxLength={48}
      aria-label={t("newinst.group")}
      trailing={
        groups.length > 0 && (
          <DropdownMenu
            align="end"
            trigger={
              <button
                type="button"
                aria-label={t("newinst.group")}
                className="grid h-7 w-7 place-items-center rounded-ctl text-dim hover:bg-white/[.07] hover:text-text"
              >
                <ChevronDown size={15} />
              </button>
            }
          >
            <DropdownItem onSelect={() => onChange("")}>{t("newinst.group.none")}</DropdownItem>
            {groups.map((g) => (
              <DropdownItem key={g} onSelect={() => onChange(g)} icon={g === value ? <Check size={14} /> : <span className="w-3.5" />}>
                {g}
              </DropdownItem>
            ))}
          </DropdownMenu>
        )
      }
    />
  );
}

// ------------------------------------------------------------------ Loader-Karten

function LoaderCards({ value, onChange }: { value: LoaderKind; onChange: (l: LoaderKind) => void }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-1" role="radiogroup" aria-label={t("newinst.loader")}>
      {LOADERS.map((l) => {
        const on = l === value;
        return (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(l)}
            className={cn(
              "flex h-[50px] items-center gap-3 rounded-card px-3 text-left transition-colors duration-100",
              on ? "bg-surface3 shadow-[inset_0_0_0_1px_var(--accent)]" : "bg-surface2 hover:bg-surface3",
            )}
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-ctl bg-black/30">
              <LoaderIcon loader={l} size={22} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-semibold leading-tight text-text">{loaderNames[l]}</span>
              <span className="block truncate text-[12px] leading-tight text-muted">{t(`newinst.loader.${l}`)}</span>
            </span>
            {on && <Check size={16} strokeWidth={2.5} className="shrink-0 text-accent" />}
          </button>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ Versionsliste

const kindOf = (v: McVersion): Filter => (v.kind === "release" ? "release" : v.kind === "snapshot" ? "snapshot" : "old");

function VersionList({ loader, value, onChange }: { loader: LoaderKind; value: string | null; onChange: (mc: string) => void }) {
  const t = useT();
  const versions = useGameVersions();
  const supported = useLoaderGameVersions(loader);
  const [filter, setFilter] = useState<Filter>("release");
  const [query, setQuery] = useState("");

  const sup = useMemo(() => (loader !== "vanilla" && supported.data ? new Set(supported.data) : null), [loader, supported.data]);
  const avail = useMemo(() => (versions.data ?? []).filter((v) => !sup || sup.has(v.id)), [versions.data, sup]);
  const latest = useMemo(() => avail.find((v) => v.kind === "release")?.id ?? null, [avail]);
  const counts = useMemo(() => {
    const c = { release: 0, snapshot: 0, old: 0 };
    for (const v of avail) c[kindOf(v)]++;
    return c;
  }, [avail]);
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Bei Suche alle Arten durchsuchen, sonst nur die gewählte
    return avail.filter((v) => (q ? v.id.toLowerCase().includes(q) : kindOf(v) === filter));
  }, [avail, filter, query]);

  const loading = versions.isLoading || (loader !== "vanilla" && supported.isLoading);
  const error = versions.isError ? versions : supported.isError ? supported : null;

  // Auswahl gültig halten: fällt die gewählte Version beim Loader-Wechsel weg -> neueste Release
  useEffect(() => {
    if (loading || !versions.data) return;
    if (!value || !avail.some((v) => v.id === value)) {
      const first = latest ?? avail[0]?.id ?? null;
      if (first && first !== value) onChange(first);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, avail, latest]);

  // Gewählte Version nach Loader-/Filterwechsel sichtbar machen
  const scrollRef = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({ count: list.length, getScrollElement: () => scrollRef.current, estimateSize: () => 36, overscan: 8 });
  const scrolled = useRef<string>("");
  useEffect(() => {
    const key = `${value}|${filter}|${loader}`;
    if (!value || scrolled.current === key) return;
    const idx = list.findIndex((x) => x.id === value);
    if (idx >= 0) {
      scrolled.current = key;
      v.scrollToIndex(idx, { align: "auto" });
    }
  }, [list, value, filter, loader, v]);

  const filters: { value: Filter; label: string }[] = [
    { value: "release", label: t("newinst.filter.release") },
    { value: "snapshot", label: t("newinst.filter.snapshot") },
    { value: "old", label: t("newinst.filter.old") },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2">
        <SearchInput value={query} onChange={setQuery} placeholder={t("newinst.version_search")} className="min-w-0 flex-1" />
        <div className="inline-flex shrink-0 gap-0.5 rounded-ctl bg-field p-0.5" role="radiogroup" aria-label={t("newinst.version")}>
          {filters.map((f) => (
            <button
              key={f.value}
              type="button"
              role="radio"
              aria-checked={!query && filter === f.value}
              disabled={!counts[f.value]}
              onClick={() => {
                setFilter(f.value);
                setQuery("");
              }}
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-[max(0px,calc(var(--r-ctl)-2px))] px-2.5 text-[12.5px] font-semibold transition-colors duration-100 disabled:opacity-35",
                !query && filter === f.value ? "bg-surface3 text-text" : "text-muted hover:text-text",
              )}
            >
              {f.label}
              <span className="text-[11px] font-medium tabular-nums text-dim">{counts[f.value]}</span>
            </button>
          ))}
        </div>
      </div>
      <div ref={scrollRef} className="scroll mt-2 min-h-0 flex-1 rounded-card bg-surface" role="listbox" aria-label={t("newinst.version")}>
        {error ? (
          <ErrorState error={error.error} onRetry={() => error.refetch()} className="py-8" />
        ) : loading ? (
          <div className="flex flex-col gap-px p-1">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-[35px]" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13px] text-dim">{t("newinst.no_versions")}</div>
        ) : (
          <div className="relative w-full" style={{ height: v.getTotalSize() }}>
            {v.getVirtualItems().map((row) => {
              const ver = list[row.index];
              const active = ver.id === value;
              return (
                <button
                  key={ver.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => onChange(ver.id)}
                  className={cn(
                    "absolute left-0 top-0 flex h-9 w-full items-center gap-3 px-3 text-left text-[13.5px] transition-colors duration-100",
                    active ? "bg-accent/15 text-text" : "text-text hover:bg-white/[.04]",
                  )}
                  style={{ transform: `translateY(${row.start}px)` }}
                >
                  <span className="grid w-4 shrink-0 place-items-center text-accent">{active && <Check size={15} strokeWidth={2.5} />}</span>
                  <span className={cn("tabular-nums", active && "font-semibold")}>{ver.id}</span>
                  {ver.id === latest && (
                    <span className="rounded-xs bg-ok/15 px-1.5 text-[11px] font-semibold leading-[18px] text-ok">{t("newinst.latest")}</span>
                  )}
                  {query && ver.kind !== "release" && <span className="text-[11.5px] font-medium text-warn">{t(`newinst.filter.${kindOf(ver)}`)}</span>}
                  <span className="ml-auto text-[12px] tabular-nums text-dim">{new Date(ver.release_time).toLocaleDateString()}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Tab: Eigene

function CustomTab({ onDone, onBusy }: { onDone: () => void; onBusy: (b: boolean) => void }) {
  const t = useT();
  const nav = useNavigate();
  const { data: instances = [] } = useInstances();
  const groups = useMemo(() => [...new Set(instances.map((i) => i.group).filter((g): g is string => !!g))].sort(), [instances]);

  const [ver, setVer] = useState<VersionValue>({ mc: null, loader: "fabric", loaderVersion: null });
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [accent, setAccent] = useState(() => accentPalette[Math.floor(Math.random() * accentPalette.length)]);
  const [group, setGroup] = useState("");
  const [icon, setIcon] = useState<string | null>(randomBlockIcon);
  const [pack, setPack] = useState<string | null>(null);
  // „Mit Mod-Sets starten“: nach dem Anlegen alles Passende aus diesen Sets installieren
  const [setIds, setSetIds] = useState<string[]>([]);
  const setCheck = useSetCheck(setIds, ver.mc, ver.loader);
  const setTotal = (useSets().data ?? []).filter((s) => setIds.includes(s.id)).reduce((n, s) => n + s.entries.length, 0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!nameTouched) setName(suggestName(ver));
  }, [ver.mc, ver.loader, nameTouched]); // eslint-disable-line react-hooks/exhaustive-deps

  // Loader-Version: empfohlene (erste stabile) vorauswählen
  const lv = useLoaderVersions(ver.loader, ver.mc);
  useEffect(() => {
    if (ver.loader === "vanilla") return;
    const list = lv.data;
    if (!list) return;
    if (!ver.loaderVersion || !list.some((x) => x.version === ver.loaderVersion)) {
      const pick = pickLoaderVersion(list);
      if (pick !== ver.loaderVersion) setVer((v) => ({ ...v, loaderVersion: pick }));
    }
  }, [lv.data, ver.loader, ver.mc, ver.loaderVersion]);

  const needsLv = ver.loader !== "vanilla";
  const valid = !!ver.mc && name.trim().length > 0 && (!needsLv || !!ver.loaderVersion);

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    onBusy(true);
    try {
      const inst = await api.instanceCreate({
        name: name.trim(),
        mc_version: ver.mc!,
        loader: { kind: ver.loader, version: needsLv ? ver.loaderVersion : null },
        accent,
        icon: isBlockIcon(icon) ? icon : null,
        group: group.trim() || null,
      });
      if (icon && !isBlockIcon(icon)) await api.instanceSetIcon(inst.id, icon).catch((e) => toast.error(e, t("inst.icon.failed")));
      onDone();
      nav({ to: "/instances/$id", params: { id: inst.id }, search: { tab: "content" } });
      installInstance(inst.id);
      // Client-Pack (falls gewählt) parallel zur Spiel-Installation in mods/ legen
      if (pack && needsLv) void installPackAfterCreate(t, inst.id, pack);
      if (setIds.length) void installSetsAfterCreate(t, inst.id, setIds);
    } catch (e) {
      toast.error(e, t("newinst.failed"));
      setBusy(false);
      onBusy(false);
    }
  };

  const lvOptions = (lv.data ?? []).map((x) => ({ value: x.version, label: x.version, hint: x.stable ? t("newinst.stable") : t("newinst.beta") }));

  return (
    <>
      {/* Kein <form>: Knöpfe ohne type wären sonst Submit-Knöpfe. Enter in Textfeldern erstellt. */}
      <div
        className="flex min-h-0 flex-1 gap-6 px-6 pb-4 pt-5"
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.target instanceof HTMLInputElement && e.target.type !== "search") {
            e.preventDefault();
            submit();
          }
        }}
      >
        {/* Links: Identität + Loader */}
        <div className="flex w-[300px] shrink-0 flex-col gap-4">
          <div className="flex items-start gap-3">
            <IconPicker icon={icon} accent={accent} onIcon={setIcon} onAccent={setAccent} />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameTouched(true);
                }}
                placeholder={t("newinst.name_placeholder")}
                maxLength={64}
                aria-label={t("newinst.name")}
                autoFocus
                className="font-semibold"
              />
              <GroupField value={group} onChange={setGroup} groups={groups} />
            </div>
          </div>
          <div className="flex min-h-0 flex-col gap-1.5">
            <span className="label">
              <Term id="loader">{t("newinst.loader")}</Term>
            </span>
            <LoaderCards value={ver.loader} onChange={(loader) => loader !== ver.loader && setVer({ ...ver, loader, loaderVersion: null })} />
          </div>
          {ver.loader !== "vanilla" && (
            <div className="flex flex-col gap-1.5">
              <span className="label">{t("cp.new.label")}</span>
              <ClientPackPicker mc={ver.mc} loader={ver.loader} value={pack} onChange={setPack} />
            </div>
          )}

        </div>

        {/* Rechts: Minecraft-Version (+ Loader-Version) */}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="label">{t("newinst.version")}</span>
          <VersionList loader={ver.loader} value={ver.mc} onChange={(mc) => mc !== ver.mc && setVer({ ...ver, mc, loaderVersion: null })} />
          {needsLv && (
            <div className="mt-2 flex items-center gap-3">
              <span className="label shrink-0">{t("newinst.loader_version", { loader: loaderNames[ver.loader] })}</span>
              <div className="min-w-0 flex-1">
                {ver.mc && lv.isLoading ? (
                  <Skeleton className="h-8" />
                ) : (
                  <Select
                    size="sm"
                    value={ver.loaderVersion}
                    onChange={(x) => setVer({ ...ver, loaderVersion: x })}
                    options={lvOptions}
                    placeholder={
                      !ver.mc ? t("newinst.pick_version_first") : lvOptions.length ? t("newinst.loader_version_pick") : t("newinst.loader_version_none")
                    }
                    disabled={!lvOptions.length}
                  />
                )}
              </div>
            </div>
          )}
          {/* Mit Mod-Sets starten: nach dem Anlegen alles Passende aus den gewählten Sets installieren */}
          <div className="mt-2 flex items-start gap-3">
            <span className="label shrink-0 pt-2">{t("newinst.sets")}</span>
            <div className="min-w-0 flex-1">
              <SetPicker mc={ver.mc} loader={ver.loader} value={setIds} onChange={setSetIds} />
            </div>
          </div>
        </div>
      </div>

      <footer className="flex items-center gap-3 border-t border-line px-6 py-4">
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-[13px] font-semibold text-text">
            {ver.mc
              ? needsLv
                ? t("newinst.summary_loader", { mc: ver.mc, loader: loaderNames[ver.loader], v: ver.loaderVersion ?? "…" })
                : t("newinst.summary", { mc: ver.mc })
              : "…"}
          </div>
          <div className="truncate text-[12px] text-muted">
            {pack && needsLv
              ? t("cp.new.after", { name: t(`cp.${pack}.name`) })
              : setIds.length
                ? t("newinst.sets_after", { n: setCheck.data?.available ?? setTotal })
                : t("newinst.after")}
          </div>
        </div>
        <Button variant="subtle" onClick={onDone} disabled={busy}>
          {t("common.cancel")}
        </Button>
        <Button variant="primary" onClick={submit} disabled={!valid} loading={busy} className="min-w-[140px]">
          {t("newinst.create")}
        </Button>
      </footer>
    </>
  );
}

// ------------------------------------------------------------------ Tab: Modpack

function PackRow({ hit, onInstall }: { hit: ProjectHit; onInstall: (h: ProjectHit) => void }) {
  const t = useT();
  return (
    <div className="flex min-w-0 items-center gap-3 px-3 py-2.5">
      <PackIcon hit={hit} size={44} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-[13.5px] font-semibold text-text">{hit.title}</span>
          <span className="shrink-0 truncate text-[12px] text-dim">{hit.author}</span>
        </div>
        <div className="truncate text-[12px] text-muted">{hit.description}</div>
        <div className="mt-0.5 flex items-center gap-1 text-[11.5px] tabular-nums text-dim">
          <Download size={11} />
          {formatCount(hit.downloads)}
          {hit.game_versions.length > 0 && <span> · {hit.game_versions[hit.game_versions.length - 1]}</span>}
        </div>
      </div>
      <Button size="sm" icon={<Download size={13} />} onClick={() => onInstall(hit)}>
        {t("newinst.pack.install")}
      </Button>
    </div>
  );
}

function ModpackTab({ onDone }: { onDone: () => void }) {
  const t = useT();
  const nav = useNavigate();
  const cf = !!useSystemInfo().data?.curseforge_available;
  const [source, setSource] = useState<"modrinth" | "curseforge">("modrinth");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const h = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(h);
  }, [query]);
  const popular = usePopularModpacks(20, source);
  const search = useQuery({
    queryKey: ["newinst", "pack-search", source, debounced],
    queryFn: () =>
      api.contentSearch({
        source,
        query: debounced,
        project_type: "modpack",
        game_version: null,
        loader: null,
        categories: [],
        sort: "relevance",
        offset: 0,
        limit: 20,
      }),
    enabled: debounced.length > 0,
    staleTime: 60_000,
  });
  const q = debounced ? search : popular;
  const hits = debounced ? search.data?.hits : popular.data;
  const install = (h: ProjectHit) => {
    startModpackInstall(h, null, () => true).catch((e) => toast.error(e, t("install.failed", { name: h.title })));
    onDone();
  };
  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-3 px-6 pb-4 pt-5">
        <div>
          <div className="text-[14px] font-semibold text-text">{t("newinst.pack.title")}</div>
          <div className="text-[12.5px] text-muted">{t("newinst.pack.text")}</div>
        </div>
        <div className="flex items-center gap-2">
          <SearchInput value={query} onChange={setQuery} placeholder={t("newinst.pack.search")} autoFocus className="min-w-0 flex-1" />
          {cf && (
            <Segmented
              value={source}
              onChange={setSource}
              items={[
                { value: "modrinth", label: "Modrinth" },
                { value: "curseforge", label: "CurseForge" },
              ]}
            />
          )}
        </div>
        <div className="scroll min-h-0 flex-1 rounded-card bg-surface">
          {!debounced && <div className="px-3 pb-1 pt-2.5 text-caption font-semibold uppercase tracking-wide text-dim">{t("newinst.pack.popular")}</div>}
          {q.isError ? (
            <ErrorState error={q.error} onRetry={() => q.refetch()} className="py-8" />
          ) : !hits ? (
            <div className="flex flex-col gap-1 p-2">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-[60px]" />
              ))}
            </div>
          ) : hits.length === 0 ? (
            <div className="px-4 py-10 text-center text-[13px] text-dim">{t("newinst.no_versions")}</div>
          ) : (
            <div className="divide-y divide-line">
              {hits.map((h) => (
                <PackRow key={h.id} hit={h} onInstall={install} />
              ))}
            </div>
          )}
        </div>
      </div>
      <footer className="flex items-center gap-3 border-t border-line px-6 py-4">
        <div className="min-w-0 flex-1" />
        <Button
          variant="subtle"
          onClick={() => {
            onDone();
            nav({ to: "/discover", search: { type: "modpack", q: query.trim() || undefined } });
          }}
        >
          {t("home.discover.more")}
        </Button>
        <Button variant="subtle" onClick={onDone}>
          {t("common.cancel")}
        </Button>
      </footer>
    </>
  );
}

// ------------------------------------------------------------------ Tab: Importieren

function ImportTab({ onDone }: { onDone: () => void }) {
  const t = useT();
  // Gleicher Schlüssel wie der Launcher-Import – dort ist die Suche dann schon fertig
  const detect = useQuery({ queryKey: ["launchers"], queryFn: api.launchersDetect, staleTime: 60_000, retry: 0 });
  const found = (detect.data ?? []).filter((l) => l.instances.length > 0);
  const toLauncher = () => {
    onDone();
    openImport(null, "launcher");
  };
  const card = (icon: React.ReactNode, title: string, text: string, onClick: () => void) => (
    <button
      onClick={onClick}
      className="flex min-w-0 items-start gap-4 rounded-card bg-surface2 p-4 text-left transition-colors duration-100 hover:bg-surface3"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-card bg-surface3 text-text">{icon}</span>
      <span className="min-w-0">
        <span className="block text-[14px] font-semibold text-text">{title}</span>
        <span className="mt-0.5 block text-[12.5px] leading-snug text-muted">{text}</span>
      </span>
    </button>
  );
  return (
    <>
      <div className="scroll flex min-h-0 flex-1 flex-col gap-2 px-6 pb-4 pt-5">
        {card(<PackageOpen size={18} />, t("newinst.import.file"), t("newinst.import.file_text"), () => {
          onDone();
          openImport();
        })}
        {card(<HardDriveDownload size={18} />, t("newinst.import.launcher"), t("newinst.import.launcher_text"), toLauncher)}
        {(detect.isLoading || found.length > 0) && (
          <div className="mt-3">
            <div className="label mb-1.5">{t("newinst.import.found")}</div>
            <div className="overflow-hidden rounded-card bg-surface">
              {detect.isLoading ? (
                <div className="flex flex-col gap-px p-1.5">
                  <Skeleton className="h-11" />
                  <Skeleton className="h-11" />
                </div>
              ) : (
                <div className="divide-y divide-line">
                  {found.map((l) => (
                    <button
                      key={l.path}
                      onClick={toLauncher}
                      className="group flex w-full min-w-0 items-center gap-3 px-3 py-2.5 text-left transition-colors duration-100 hover:bg-white/[.03]"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-semibold text-text">{l.name}</span>
                        <span className="block truncate font-mono text-[11.5px] text-dim">{l.path}</span>
                      </span>
                      <span className="shrink-0 text-[12.5px] text-muted">
                        {l.instances.length === 1 ? t("newinst.import.instances_1") : t("newinst.import.instances_n", { n: l.instances.length })}
                      </span>
                      <ChevronRight size={15} className="shrink-0 text-dim group-hover:text-text" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        <p className="mt-2 flex items-center gap-2 text-[12.5px] text-dim">
          <FolderInput size={14} className="shrink-0" />
          {t("newinst.import.drop")}
        </p>
      </div>
      <footer className="flex items-center justify-end gap-3 border-t border-line px-6 py-4">
        <Button variant="subtle" onClick={onDone}>
          {t("common.cancel")}
        </Button>
      </footer>
    </>
  );
}

// ------------------------------------------------------------------ Dialog

export function NewInstanceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const [tab, setTab] = useState<Tab>("custom");
  const [busy, setBusy] = useState(false);
  // Beim Öffnen zurücksetzen (Inhalte werden ohnehin neu gemountet)
  useEffect(() => {
    if (open) {
      setTab("custom");
      setBusy(false);
    }
  }, [open]);
  const close = () => onOpenChange(false);
  const tabs: { value: Tab; label: string }[] = [
    { value: "custom", label: t("newinst.tab.custom") },
    { value: "modpack", label: t("newinst.tab.modpack") },
    { value: "bedrock", label: t("bedrock.newinst.tab") },
    { value: "import", label: t("newinst.tab.import") },
  ];

  return (
    <D.Root open={open} onOpenChange={(o) => (!busy || o) && onOpenChange(o)}>
      <D.Portal>
        <D.Overlay className="vl-overlay fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-fade-in" />
        <D.Content
          onEscapeKeyDown={(e) => busy && e.preventDefault()}
          onPointerDownOutside={(e) => busy && e.preventDefault()}
          onInteractOutside={(e) => busy && e.preventDefault()}
          aria-describedby={undefined}
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden",
            "h-[min(620px,calc(100vh-64px))] w-[880px] max-w-[calc(100vw-48px)]",
            "vl-dialog rounded-panel bg-overlay shadow-e3 data-[state=open]:animate-pop-in",
          )}
          // Auswahl und Hauptaktion in der globalen Akzentfarbe; die Instanzfarbe gehört nur dem Icon
          style={{ "--accent": "var(--ui-accent)", "--on-accent": "var(--ui-on-accent)" } as React.CSSProperties}
        >
          <header className="flex items-center gap-4 border-b border-line pl-6 pr-4">
            <D.Title className="py-4 text-title text-text">{t("newinst.title")}</D.Title>
            <div className="flex h-full items-stretch gap-1 self-stretch" role="tablist">
              {tabs.map((it) => (
                <button
                  key={it.value}
                  role="tab"
                  aria-selected={tab === it.value}
                  disabled={busy}
                  onClick={() => setTab(it.value)}
                  className={cn(
                    "flex items-center px-3 text-[13.5px] font-semibold transition-colors duration-150",
                    tab === it.value ? "text-text shadow-[inset_0_-2px_0_var(--ui-accent)]" : "text-muted hover:text-text",
                  )}
                >
                  {it.label}
                </button>
              ))}
            </div>
            <div className="flex-1" />
            {!busy && (
              <D.Close
                aria-label={t("common.close")}
                className="grid h-8 w-8 place-items-center rounded-ctl text-dim transition-colors hover:bg-white/[.07] hover:text-text"
              >
                <X size={18} />
              </D.Close>
            )}
          </header>
          {tab === "custom" ? (
            <CustomTab onDone={close} onBusy={setBusy} />
          ) : tab === "modpack" ? (
            <ModpackTab onDone={close} />
          ) : tab === "bedrock" ? (
            <NewBedrockTab onDone={close} onBusy={setBusy} />
          ) : (
            <ImportTab onDone={close} />
          )}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
