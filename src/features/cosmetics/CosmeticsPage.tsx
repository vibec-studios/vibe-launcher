// Cosmetics-Seite: Garderobe wie im Vibey Client – Kategorien je Slot + Emotes, Suche, Karten mit Vorschaubildern,
// große drehbare 3D-Vorschau mit dem eigenen Skin, Anprobieren per Hover/Klick, Anlegen/Ablegen, Emote-Rad und
// Speichern ins Loadout am Backend. Gesperrte (nicht freigeschaltete) Items sind markiert und nicht anlegbar.
// Ohne Vibe-Login (Gastansicht) gibt es Katalog, Suche und Anprobieren trotzdem – mit Hinweis-Banner oben, aber
// ohne Anlegen, Emote-Rad und Speichern. Kostenlose Items (`availability: "default"`) gelten dann als frei.
// Neue Items kommen ohne Update (catalog.updated → Katalog neu, Assets per SHA-256 nach).
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Check, CircleDot, ListFilter, Lock, PackagePlus, PenTool, Save, Undo2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, DropdownCheckItem, DropdownLabel, DropdownMenu, EmptyState, ErrorState, IconButton, PageToolbar, SearchInput, Spinner, Tooltip, cn, toast } from "@/components/ui";
import { installInstance } from "@/components/instance/actions";
import { useLang, useT } from "@/i18n";
import { queryClient, waitForTask } from "@/lib/queries";
import { VibeError } from "@/lib/vibe-sdk";
import { capi, vapi } from "./api";
import { categoryOf, cqk, freeItems, isGuest, itemDesc, itemName, prefetchAssets, useAccess, useCatalog, useMe, type Access } from "./data";
import { AccessBanner, AccessState, ItemThumb, RarityLabel, useBundle, useBundles } from "./parts";
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

  // Seitenaktionen (rechts in der Werkzeugleiste): Instanz anlegen (selten -> Symbol mit Tooltip), Creator
  const actions = (
    <>
      <Tooltip
        content={
          <>
            <div className="font-semibold">{t("cos.create")}</div>
            <div className="text-muted">{t("cos.create.hint")}</div>
          </>
        }
      >
        <span className="inline-flex">
          <IconButton label={t("cos.create")} variant="ghost" disabled={creating || access === "off" || access === "loading"} onClick={() => void createInstance()}>
            {creating ? <Spinner size={14} /> : <PackagePlus size={16} />}
          </IconButton>
        </span>
      </Tooltip>
      <Button variant="ghost" icon={<PenTool size={15} />} onClick={() => nav({ to: "/cosmetics/creator" })}>
        {t("cos.creator")}
      </Button>
    </>
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      {access === "loading" ? (
        <>
          <Toolbar actions={actions} />
          <AccessState access={access} />
        </>
      ) : (
        <Wardrobe access={access} actions={actions} />
      )}
    </div>
  );
}

/** Kompakte Werkzeugleiste: links Kategorien/Suche/Filter, rechts Aktionen. */
function Toolbar({ children, actions }: { children?: ReactNode; actions: ReactNode }) {
  return (
    <div className="shrink-0 px-6 pb-4 pt-4">
      <PageToolbar actions={actions}>
        {children}
      </PageToolbar>
    </div>
  );
}

type Filter = Category | "all";

function Wardrobe({ access, actions }: { access: Exclude<Access, "loading">; actions: ReactNode }) {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const guest = isGuest(access);
  const catQ = useCatalog(true);
  const meQ = useMe(!guest);
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
  const owned = useMemo(() => new Set(guest ? freeItems(catQ.data) : (meQ.data?.owned ?? [])), [guest, catQ.data, meQ.data]);
  const server = (!guest && meQ.data?.loadout) || EMPTY;
  const loadout = draft ?? server;
  const dirty = !guest && !!draft && !same(draft, server);

  // Abgemeldet (oder Vibe aus) -> Entwurf verwerfen, er ließe sich nicht mehr speichern
  useEffect(() => {
    if (guest) setDraft(null);
  }, [guest]);

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
      if (onlyOwned && !guest && !owned.has(i.id)) return false;
      if (!needle) return true;
      return [i.name.en, i.name.de ?? "", i.author, i.creator?.name ?? "", ...i.tags].some((s) => s.toLowerCase().includes(needle));
    });
  }, [items, filter, q, onlyOwned, owned, guest]);

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
    if (guest || !owned.has(i.id)) return;
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

  // Vibe aus und noch nie geladen: keine Verbindung, kein Cache -> nur der Hinweis
  if (catQ.isError && access === "off")
    return (
      <>
        <Toolbar actions={actions} />
        <AccessState access="off" />
      </>
    );
  const banner = guest && <AccessBanner access={access} />;
  if (catQ.isError)
    return (
      <>
        <Toolbar actions={actions} />
        {banner}
        <ErrorState error={catQ.error} onRetry={() => void catQ.refetch()} className="flex-1" />
      </>
    );
  if (!catQ.data || (!guest && meQ.isLoading))
    return (
      <>
        <Toolbar actions={actions} />
        {banner}
        <div className="grid flex-1 place-items-center">
          <Spinner size={20} className="text-brand" />
        </div>
      </>
    );

  const wheelButton = guest ? (
    <Tooltip content={t(access === "no_access" ? "cos.guest.wheel_hint_beta" : "cos.guest.wheel_hint")}>
      <span className="inline-flex">
        <IconButton label={t("cos.wheel")} variant="ghost" disabled>
          <CircleDot size={16} />
        </IconButton>
      </span>
    </Tooltip>
  ) : (
    <IconButton label={t("cos.wheel")} tip variant="ghost" onClick={() => setWheel({ open: true, arm: null })}>
      <CircleDot size={16} />
    </IconButton>
  );

  return (
    <>
      <Toolbar
        actions={
          <>
            {wheelButton}
            {actions}
          </>
        }
      >
        <div className="flex min-w-0 shrink flex-wrap gap-0.5 rounded-ctl bg-field p-0.5" role="tablist" aria-label={t("cos.categories")}>
          {(["all", ...CATEGORIES] as Filter[]).map((c) => (
            <button
              key={c}
              role="tab"
              aria-selected={filter === c}
              onClick={() => setFilter(c)}
              className={cn(
                "flex h-8 shrink-0 items-center gap-1.5 rounded-[max(0px,calc(var(--r-ctl)-2px))] px-2.5 text-[13px] font-semibold transition-colors duration-100",
                filter === c ? "bg-surface3 text-text" : "text-muted hover:text-text",
              )}
            >
              {t(`cos.cat.${c}`)}
              <span className="text-[12px] font-medium text-dim">{counts[c] ?? 0}</span>
            </button>
          ))}
        </div>
        <SearchInput value={q} onChange={setQ} placeholder={t("cos.search")} className="w-[220px] min-w-[160px] shrink-0 [[data-design=v2]_&]:w-[190px]" />
        {!guest && (
          <DropdownMenu
            align="start"
            trigger={
              <IconButton label={t("cos.filter")} tip variant="ghost" badge={onlyOwned ? 1 : undefined}>
                <ListFilter size={16} />
              </IconButton>
            }
          >
            <DropdownLabel>{t("cos.filter")}</DropdownLabel>
            <DropdownCheckItem checked={onlyOwned} onCheckedChange={setOnlyOwned}>
              {t("cos.only_owned")}
            </DropdownCheckItem>
          </DropdownMenu>
        )}
        {(q.trim() || onlyOwned) && <span className="shrink-0 whitespace-nowrap text-meta text-dim">{t("cos.count", { n: shown.length })}</span>}
      </Toolbar>
      {banner}
      <div className="flex min-h-0 flex-1 gap-4 px-6 pb-6">
        {/* Raster */}
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="scroll min-h-0 flex-1" onMouseLeave={() => setHover(null)}>
            {shown.length === 0 ? (
              <EmptyState
                icon="search_none"
                title={t("cos.empty")}
                text={q ? t("cos.empty_search") : t("cos.empty_cat")}
                action={
                  <Button
                    size="sm"
                    onClick={() => {
                      setQ("");
                      setOnlyOwned(false);
                      setFilter("all");
                    }}
                  >
                    {q ? t("layout.search.reset") : t("layout.show_all")}
                  </Button>
                }
              />
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 p-0.5">
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
            <div className="mt-3 flex shrink-0 items-center gap-3 rounded-card bg-surface2 px-4 py-2 animate-slide-up">
              <span className="h-2 w-2 shrink-0 rounded-dot bg-brand" />
              <span className="whitespace-nowrap text-[13px] font-semibold text-text">{t("cos.unsaved")}</span>
              <span className="hidden min-w-0 truncate text-meta text-muted 2xl:block">{t("cos.unsaved_hint")}</span>
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
        <aside className="flex w-[380px] shrink-0 flex-col overflow-hidden rounded-card bg-surface xl:w-[420px]">
          <Viewer3D className="min-h-[min(300px,55%)] flex-1" bundles={bundles} emote={emoteBundle} focus={focus} focusKey={selected ?? ""} skin={skin} />
          <Details
            item={sel}
            lang={lang}
            owned={sel ? owned.has(sel.id) : false}
            guest={guest}
            equipped={sel ? equipped(sel) : false}
            primary={!dirty}
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
    </>
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
      aria-pressed={selected}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-card text-left transition-colors duration-100",
        selected ? "bg-surface3 outline outline-2 outline-accent" : "bg-surface hover:bg-surface2",
      )}
    >
      <ItemThumb item={item} className={cn("aspect-square w-full", !owned && "opacity-55 grayscale-[.6]")} />
      {equipped && (
        <span className="absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-pill bg-accent text-[var(--on-accent)]" title={t("cos.equipped")}>
          <Check size={12} strokeWidth={3} />
        </span>
      )}
      {!owned && (
        <span className="absolute left-2 top-2 flex h-5 items-center gap-1 rounded-xs bg-black/80 px-1.5 text-caption font-semibold text-[#fff]/75" title={t("cos.locked_hint")}>
          <Lock size={11} /> {t("cos.locked")}
        </span>
      )}
      <div className="px-2.5 pb-2 pt-1.5">
        <div className="truncate text-[13px] font-semibold text-text">{itemName(item, lang)}</div>
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
  guest,
  equipped,
  primary,
  onToggle,
  onClose,
  loadout,
  byId,
  onSelect,
}: {
  item: CatalogItem | undefined;
  lang: string;
  owned: boolean;
  /** Ohne Vibe-Login: nur ansehen/anprobieren */
  guest: boolean;
  equipped: boolean;
  /** Anlegen-Knopf farbig – nur wenn keine andere Hauptaktion (Speichern) sichtbar ist */
  primary: boolean;
  onToggle: () => void;
  onClose: () => void;
  loadout: Loadout;
  byId: Map<string, CatalogItem>;
  onSelect: (id: string) => void;
}) {
  const t = useT();
  const equipHint = t(useAccess() === "no_access" ? "cos.guest.equip_hint_beta" : "cos.guest.equip_hint");
  if (!item) {
    // Aktueller Look
    const worn = COSMETIC_SLOTS.map((s) => loadout.slots[s]).filter((id): id is string => !!id);
    return (
      <div className="scroll max-h-[45%] shrink-0 px-4 pb-4 pt-3">
        <div className="mb-2.5 flex items-baseline justify-between">
          <h3 className="text-section text-text">{t("cos.look")}</h3>
          <span className="text-meta text-dim">{t("cos.look_count", { n: worn.length })}</span>
        </div>
        {worn.length === 0 ? (
          <p className="text-[13px] text-muted">{guest ? t("cos.guest.look_empty") : t("cos.look_empty")}</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {worn.map((id) => {
              const i = byId.get(id);
              return (
                <button key={id} onClick={() => onSelect(id)} className="flex h-8 items-center gap-1.5 rounded-ctl bg-surface2 pl-1 pr-2.5 text-[12px] text-text hover:bg-surface3">
                  {i && <ItemThumb item={i} className="h-6 w-6" />}
                  {i ? itemName(i, lang) : id}
                </button>
              );
            })}
          </div>
        )}
        <p className="mt-3 text-meta leading-relaxed text-dim">{guest ? equipHint : t("cos.look_hint")}</p>
      </div>
    );
  }
  const desc = itemDesc(item, lang);
  const slotLabel = t(`cos.slot.${item.kind === "emote" ? "emote" : item.slot}`);
  return (
    <div className="scroll max-h-[45%] shrink-0 px-4 pb-4 pt-3 animate-fade-in">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-title text-text" title={itemName(item, lang)}>
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
        <IconButton label={t("common.close")} variant="ghost" size="sm" className="-mr-1.5 -mt-1" onClick={onClose}>
          <X size={16} />
        </IconButton>
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
        ) : guest ? (
          <Tooltip content={equipHint}>
            <span className="flex-1">
              <Button className="w-full" disabled icon={item.kind === "emote" ? <CircleDot size={15} /> : <Check size={15} />}>
                {item.kind === "emote" ? t("cos.wheel_add") : t("cos.equip")}
              </Button>
            </span>
          </Tooltip>
        ) : item.kind === "emote" ? (
          <Button className="flex-1" variant={equipped || !primary ? "ghost" : "primary"} icon={<CircleDot size={15} />} onClick={onToggle}>
            {equipped ? t("cos.wheel_edit") : t("cos.wheel_add")}
          </Button>
        ) : (
          <Button className="flex-1" variant={equipped || !primary ? "ghost" : "primary"} icon={equipped ? <X size={15} /> : <Check size={15} />} onClick={onToggle}>
            {equipped ? t("cos.unequip") : t("cos.equip")}
          </Button>
        )}
      </div>
    </div>
  );
}
