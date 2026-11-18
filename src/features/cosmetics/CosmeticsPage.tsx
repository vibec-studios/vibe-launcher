// Cosmetics-Seite: Garderobe wie im Vibey Client – Kategorien je Slot + Emotes, Suche, Karten mit Vorschaubildern,
// große drehbare 3D-Vorschau mit dem eigenen Skin, Anprobieren per Hover/Klick, Anlegen/Ablegen, Emote-Rad und
// Speichern ins Loadout am Backend. Gesperrte (nicht freigeschaltete) Items sind markiert und nicht anlegbar.
// Neue Items kommen ohne Update (catalog.updated → Katalog neu, Assets per SHA-256 nach).
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Check, CircleDot, Lock, PackagePlus, PenTool, Save, Search, Sparkles, Undo2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, EmptyState, ErrorState, SearchInput, Spinner, Switch, Tooltip, cn, toast } from "@/components/ui";
import { installInstance } from "@/components/instance/actions";
import { useLang, useT } from "@/i18n";
import { queryClient, waitForTask } from "@/lib/queries";
import { VibeError } from "@/lib/vibe-sdk";
import { capi, vapi } from "./api";
import { categoryOf, cqk, itemDesc, itemName, prefetchAssets, useAccess, useCatalog, useMe } from "./data";
import { AccessState, ItemThumb, RarityLabel, useBundle, useBundles } from "./parts";
import { CATEGORIES, COSMETIC_SLOTS, EMOTE_WHEEL_SIZE, type CatalogItem, type Category, type CosmeticsMe, type Loadout } from "./types";
import { Viewer3D, useOwnSkin } from "./Viewer3D";
import { EmoteWheelDialog } from "./EmoteWheel";

const EMPTY: Loadout = { slots: {}, emoteWheel: Array(EMOTE_WHEEL_SIZE).fill(null) };

function normalize(l: Loadout): Loadout {
  const slots: Loadout["slots"] = {};
  for (const s of COSMETIC_SLOTS) slots[s] = l.slots[s] ?? null;
  const wheel = Array.from({ length: EMOTE_WHEEL_SIZE }, (_, i) => l.emoteWheel?.[i] ?? null);
  return { slots, emoteWheel: wheel };
}
const same = (a: Loadout, b: Loadout) => JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));

export function CosmeticsPage() {
  const t = useT();
  const nav = useNavigate();
  const access = useAccess();
  const [creating, setCreating] = useState(false);

  const createInstance = async () => {
    setCreating(true);
    try {
      const id = await vapi.clientCreateInstance();
      const task = await waitForTask(id);
      toast.success(t("cos.create.done"), task.message ?? undefined);
      // Wie bei jeder neuen Instanz: Minecraft + Loader gleich mitinstallieren
      if (task.instance_id) installInstance(task.instance_id);
      if (task.instance_id) nav({ to: "/instances/$id", params: { id: task.instance_id }, search: { tab: "content" } });
    } catch (e) {
      toast.error(e, t("cos.create.failed"));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-4 border-b border-line bg-panel px-6 py-4">
        <div className="grid h-11 w-11 shrink-0 place-items-center border border-brand/40 bg-brand/15 text-brand">
          <Sparkles size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="display text-[20px] leading-tight">{t("cos.title")}</h1>
          <p className="mt-0.5 truncate text-[13px] text-muted">{t("cos.lead")}</p>
        </div>
        <Tooltip content={t("cos.create.hint")}>
          <Button icon={<PackagePlus size={15} />} loading={creating} disabled={access === "off" || access === "loading"} onClick={() => void createInstance()}>
            {t("cos.create")}
          </Button>
        </Tooltip>
        <Button variant="primary" icon={<PenTool size={15} />} onClick={() => nav({ to: "/cosmetics/creator" })}>
          {t("cos.creator")}
        </Button>
      </header>
      {access === "ready" ? <Wardrobe /> : <AccessState access={access} />}
    </div>
  );
}

type Filter = Category | "all";

function Wardrobe() {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const catQ = useCatalog(true);
  const meQ = useMe(true);
  const skin = useOwnSkin();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [onlyOwned, setOnlyOwned] = useState(false);
  const [draft, setDraft] = useState<Loadout | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [wheel, setWheel] = useState<{ open: boolean; arm: string | null }>({ open: false, arm: null });

  const items = useMemo(() => [...(catQ.data?.items ?? [])].sort((a, b) => a.sort - b.sort || itemName(a, lang).localeCompare(itemName(b, lang))), [catQ.data, lang]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const owned = useMemo(() => new Set(meQ.data?.owned ?? []), [meQ.data]);
  const server = meQ.data?.loadout ?? EMPTY;
  const loadout = draft ?? server;
  const dirty = !!draft && !same(draft, server);

  useEffect(() => {
    if (catQ.data) void prefetchAssets(catQ.data);
  }, [catQ.data]);

  // Ausgewähltes Item verschwindet aus dem Katalog (OTA) -> Auswahl lösen
  useEffect(() => {
    if (selected && catQ.data && !byId.has(selected)) setSelected(null);
  }, [byId, selected, catQ.data]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length };
    for (const i of items) c[categoryOf(i)] = (c[categoryOf(i)] ?? 0) + 1;
    return c;
  }, [items]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((i) => {
      if (filter !== "all" && categoryOf(i) !== filter) return false;
      if (onlyOwned && !owned.has(i.id)) return false;
      if (!needle) return true;
      return [i.name.en, i.name.de ?? "", i.author, i.creator?.name ?? "", ...i.tags].some((s) => s.toLowerCase().includes(needle));
    });
  }, [items, filter, q, onlyOwned, owned]);

  // ---------- Vorschau: Loadout + anprobiertes Item ----------
  const tryOnId = hover ?? selected;
  const tryOn = tryOnId ? byId.get(tryOnId) : undefined;
  const previewSlots = { ...loadout.slots };
  if (tryOn && tryOn.kind === "cosmetic" && tryOn.slot) previewSlots[tryOn.slot] = tryOn.id;
  const hashes = COSMETIC_SLOTS.map((s) => previewSlots[s])
    .map((id) => (id ? byId.get(id)?.asset.hash : undefined))
    .filter((h): h is string => !!h);
  const bundles = useBundles(hashes);
  const emoteBundle = useBundle(tryOn?.kind === "emote" ? tryOn.asset.hash : null);
  const sel = selected ? byId.get(selected) : undefined;
  const focus = sel?.slot && ["cape", "wings", "back"].includes(sel.slot) ? "back" : sel ? "front" : null;

  // ---------- Aktionen ----------
  const edit = (fn: (l: Loadout) => Loadout) => setDraft((d) => normalize(fn(normalize(d ?? server))));
  const equipped = (i: CatalogItem) => (i.kind === "emote" ? loadout.emoteWheel.includes(i.id) : !!i.slot && loadout.slots[i.slot] === i.id);
  const toggle = (i: CatalogItem) => {
    if (!owned.has(i.id)) return;
    if (i.kind === "emote") {
      setWheel({ open: true, arm: i.id });
      return;
    }
    if (!i.slot) return;
    const slot = i.slot;
    edit((l) => ({ ...l, slots: { ...l.slots, [slot]: l.slots[slot] === i.id ? null : i.id } }));
  };

  const save = useMutation({
    mutationFn: () => capi.setLoadout({ slots: normalize(loadout).slots, emoteWheel: normalize(loadout).emoteWheel }),
    onSuccess: (l) => {
      queryClient.setQueryData<CosmeticsMe>(cqk.me, (cur) => (cur ? { ...cur, loadout: l } : cur));
      setDraft(null);
      toast.success(t("cos.saved"), t("cos.saved_text"));
    },
    onError: (e) => {
      const notOwned = e instanceof VibeError ? (e.details as { notOwned?: string[] } | undefined)?.notOwned : undefined;
      toast.error(notOwned?.length ? t("cos.save.not_owned", { items: notOwned.map((id) => (byId.get(id) ? itemName(byId.get(id)!, lang) : id)).join(", ") }) : e, t("cos.save.failed"));
    },
  });

  if (catQ.isError) return <ErrorState error={catQ.error} onRetry={() => void catQ.refetch()} className="flex-1" />;
  if (!catQ.data || meQ.isLoading)
    return (
      <div className="grid flex-1 place-items-center">
        <Spinner size={20} className="text-brand" />
      </div>
    );

  return (
    <div className="flex min-h-0 flex-1">
      {/* Kategorien */}
      <aside className="flex w-52 shrink-0 flex-col border-r border-line bg-black/40">
        <div className="px-4 pb-2 pt-4 font-mono text-[11px] uppercase tracking-[.18em] text-dim">{t("cos.categories")}</div>
        <nav className="scroll flex min-h-0 flex-1 flex-col">
          {(["all", ...CATEGORIES] as Filter[]).map((c) => (
            <button
              key={c}
              onClick={() => setFilter(c)}
              className={cn(
                "flex h-10 items-center justify-between border-l-2 px-4 text-left text-[14px] transition-colors",
                filter === c ? "border-brand bg-white/[.05] text-white" : "border-transparent text-muted hover:bg-white/[.03] hover:text-white",
              )}
            >
              <span>{t(`cos.cat.${c}`)}</span>
              <span className={cn("font-mono text-[12px]", filter === c ? "text-brand" : "text-dim")}>{counts[c] ?? 0}</span>
            </button>
          ))}
        </nav>
        <div className="border-t border-line p-3">
          <Button className="w-full" icon={<CircleDot size={15} />} onClick={() => setWheel({ open: true, arm: null })}>
            {t("cos.wheel")}
          </Button>
        </div>
      </aside>

      {/* Raster */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-3 border-b border-line px-5 py-3">
          <SearchInput value={q} onChange={setQ} placeholder={t("cos.search")} className="max-w-sm flex-1" />
          <label className="flex items-center gap-2 text-[13px] text-muted">
            <Switch checked={onlyOwned} onChange={setOnlyOwned} label={t("cos.only_owned")} />
            {t("cos.only_owned")}
          </label>
          <div className="ml-auto font-mono text-[12px] text-dim">{t("cos.count", { n: shown.length })}</div>
        </div>
        <div className="scroll min-h-0 flex-1 p-5" onMouseLeave={() => setHover(null)}>
          {shown.length === 0 ? (
            <EmptyState icon={<Search size={20} />} title={t("cos.empty")} text={q ? t("cos.empty_search") : t("cos.empty_cat")} />
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
              {shown.map((i) => (
                <ItemCard
                  key={i.id}
                  item={i}
                  lang={lang}
                  owned={owned.has(i.id)}
                  equipped={equipped(i)}
                  selected={selected === i.id}
                  onHover={(h) => setHover(h ? i.id : null)}
                  onClick={() => setSelected(selected === i.id ? null : i.id)}
                  onDouble={() => toggle(i)}
                />
              ))}
            </div>
          )}
        </div>
        {dirty && (
          <div className="flex shrink-0 items-center gap-3 border-t border-brand/40 bg-brand/[.09] px-5 py-2.5 animate-slide-up">
            <span className="h-2 w-2 bg-brand" />
            <span className="whitespace-nowrap text-[13px] font-semibold text-white">{t("cos.unsaved")}</span>
            <span className="hidden min-w-0 truncate text-[12px] text-muted 2xl:block">{t("cos.unsaved_hint")}</span>
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="subtle" icon={<Undo2 size={14} />} onClick={() => setDraft(null)} disabled={save.isPending}>
                {t("cos.discard")}
              </Button>
              <Button size="sm" variant="primary" icon={<Save size={14} />} loading={save.isPending} onClick={() => save.mutate()}>
                {t("cos.save")}
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* Vorschau + Details */}
      <aside className="flex w-[400px] shrink-0 flex-col border-l border-line bg-[radial-gradient(120%_70%_at_50%_30%,rgba(139,108,255,.10),transparent_65%)] xl:w-[440px]">
        <Viewer3D className="min-h-[300px] flex-1" bundles={bundles} emote={emoteBundle} focus={focus} focusKey={selected ?? ""} skin={skin} />
        <Details
          item={sel}
          lang={lang}
          owned={sel ? owned.has(sel.id) : false}
          equipped={sel ? equipped(sel) : false}
          onToggle={() => sel && toggle(sel)}
          onClose={() => setSelected(null)}
          loadout={loadout}
          byId={byId}
          onSelect={setSelected}
        />
      </aside>

      <EmoteWheelDialog
        open={wheel.open}
        arm={wheel.arm}
        onOpenChange={(o) => setWheel((w) => ({ ...w, open: o }))}
        wheel={loadout.emoteWheel}
        emotes={items.filter((i) => i.kind === "emote")}
        owned={owned}
        lang={lang}
        onApply={(w) => edit((l) => ({ ...l, emoteWheel: w }))}
      />
    </div>
  );
}

function ItemCard({
  item,
  lang,
  owned,
  equipped,
  selected,
  onHover,
  onClick,
  onDouble,
}: {
  item: CatalogItem;
  lang: string;
  owned: boolean;
  equipped: boolean;
  selected: boolean;
  onHover: (h: boolean) => void;
  onClick: () => void;
  onDouble: () => void;
}) {
  const t = useT();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return (
    <button
      onMouseEnter={() => {
        timer.current = setTimeout(() => onHover(true), 90);
      }}
      onMouseLeave={() => {
        if (timer.current) clearTimeout(timer.current);
        onHover(false);
      }}
      onClick={onClick}
      onDoubleClick={onDouble}
      className={cn(
        "group relative flex flex-col border bg-surface text-left transition-[border-color,background-color,transform] duration-100",
        selected ? "border-brand bg-brand/[.08] shadow-[0_0_0_1px_var(--color-brand)]" : "border-line hover:border-line2 hover:bg-surface2",
      )}
    >
      <ItemThumb item={item} className={cn("aspect-square w-full bg-black/50", !owned && "opacity-55 grayscale-[.6]")} />
      {equipped && (
        <span className="absolute right-2 top-2 grid h-6 w-6 place-items-center bg-brand text-white" title={t("cos.equipped")}>
          <Check size={14} strokeWidth={3} />
        </span>
      )}
      {!owned && (
        <span className="absolute left-2 top-2 flex h-6 items-center gap-1 border border-line2 bg-black/80 px-1.5 text-[11px] font-semibold text-muted" title={t("cos.locked_hint")}>
          <Lock size={11} /> {t("cos.locked")}
        </span>
      )}
      <div className="border-t border-line px-2.5 py-2">
        <div className="truncate text-[13px] font-semibold text-white">{itemName(item, lang)}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[12px]">
          <RarityLabel rarity={item.rarity} />
          {item.creator && <span className="truncate text-dim">· {item.creator.name}</span>}
        </div>
      </div>
    </button>
  );
}

function Details({
  item,
  lang,
  owned,
  equipped,
  onToggle,
  onClose,
  loadout,
  byId,
  onSelect,
}: {
  item: CatalogItem | undefined;
  lang: string;
  owned: boolean;
  equipped: boolean;
  onToggle: () => void;
  onClose: () => void;
  loadout: Loadout;
  byId: Map<string, CatalogItem>;
  onSelect: (id: string) => void;
}) {
  const t = useT();
  if (!item) {
    // Aktueller Look
    const worn = COSMETIC_SLOTS.map((s) => loadout.slots[s]).filter((id): id is string => !!id);
    return (
      <div className="shrink-0 border-t border-line p-4">
        <div className="mb-2.5 flex items-baseline justify-between">
          <h3 className="display text-[15px] text-white">{t("cos.look")}</h3>
          <span className="font-mono text-[12px] text-dim">{t("cos.look_count", { n: worn.length })}</span>
        </div>
        {worn.length === 0 ? (
          <p className="text-[13px] text-muted">{t("cos.look_empty")}</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {worn.map((id) => {
              const i = byId.get(id);
              return (
                <button key={id} onClick={() => onSelect(id)} className="flex h-8 items-center gap-1.5 border border-line bg-surface2 pl-1 pr-2.5 text-[12px] text-text hover:border-line2">
                  {i && <ItemThumb item={i} className="h-6 w-6" />}
                  {i ? itemName(i, lang) : id}
                </button>
              );
            })}
          </div>
        )}
        <p className="mt-3 text-[12px] leading-relaxed text-dim">{t("cos.look_hint")}</p>
      </div>
    );
  }
  const desc = itemDesc(item, lang);
  const slotLabel = t(`cos.slot.${item.kind === "emote" ? "emote" : item.slot}`);
  return (
    <div className="shrink-0 border-t border-line p-4 animate-fade-in">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="display truncate text-[17px] text-white" title={itemName(item, lang)}>
            {itemName(item, lang)}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[13px]">
            <RarityLabel rarity={item.rarity} />
            <span className="text-dim">·</span>
            <span className="text-muted">{slotLabel}</span>
            {equipped && (
              <>
                <span className="text-dim">·</span>
                <span className="font-semibold text-brand">{item.kind === "emote" ? t("cos.in_wheel") : t("cos.equipped")}</span>
              </>
            )}
          </div>
        </div>
        <button aria-label={t("common.close")} onClick={onClose} className="-mr-1 grid h-7 w-7 place-items-center text-dim hover:text-white">
          <X size={16} />
        </button>
      </div>
      {desc && <p className="mt-2.5 line-clamp-3 text-[13px] leading-relaxed text-muted">{desc}</p>}
      <div className="mt-2 text-[12px] text-dim">
        {item.creator ? t("cos.by_creator", { name: item.creator.name }) : item.author ? t("cos.by", { name: item.author }) : null}
      </div>
      <div className="mt-3.5 flex gap-2">
        {!owned ? (
          <Tooltip content={t("cos.locked_hint")}>
            <span className="flex-1">
              <Button className="w-full" disabled icon={<Lock size={14} />}>
                {t("cos.locked")}
              </Button>
            </span>
          </Tooltip>
        ) : item.kind === "emote" ? (
          <Button className="flex-1" variant={equipped ? "ghost" : "primary"} icon={<CircleDot size={15} />} onClick={onToggle}>
            {equipped ? t("cos.wheel_edit") : t("cos.wheel_add")}
          </Button>
        ) : (
          <Button className="flex-1" variant={equipped ? "ghost" : "primary"} icon={equipped ? <X size={15} /> : <Check size={15} />} onClick={onToggle}>
            {equipped ? t("cos.unequip") : t("cos.equip")}
          </Button>
        )}
      </div>
    </div>
  );
}
