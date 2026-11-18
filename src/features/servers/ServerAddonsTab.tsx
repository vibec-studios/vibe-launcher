// Plugins (Paper/Purpur/Folia: plugins/) bzw. Mods (Fabric & Co.: mods/) eines Servers: links die installierten
// Dateien (aktivieren/deaktivieren, entfernen, Updates), rechts Suche + Installation über Modrinth und Hangar.
import { useDeferredValue, useState } from "react";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { ArrowUpCircle, Download, ExternalLink, FolderOpen, MoreHorizontal, Package, RefreshCw, Trash2 } from "lucide-react";
import { queryClient, useServerStatus } from "@/lib/queries";
import type { Server } from "@/lib/types";
import { formatBytes, formatCount, formatRelative } from "@/lib/format";
import {
  Button,
  ContextItem,
  ContextMenu,
  ContextSeparator,
  DropdownItem,
  DropdownMenu,
  DropdownSeparator,
  EmptyState,
  ErrorState,
  IconButton,
  SearchInput,
  Segmented,
  Select,
  SettingsCard,
  Skeleton,
  Switch,
  Tag,
  Tooltip,
  cn,
  confirm,
  toast,
  type MenuItemProps,
} from "@/components/ui";
import { openExternal } from "@/components/content/util";
import { useT, t as tt } from "@/i18n";
import { openServerFolder } from "./actions";
import { addonApi, aqk, type Addon, type AddonHit, type AddonList, type AddonSource, type AddonUpdate } from "./addonsApi";

function refresh(id: string) {
  queryClient.invalidateQueries({ queryKey: aqk.addons(id) });
  queryClient.invalidateQueries({ queryKey: aqk.updates(id) });
}

const rowCls =
  "group flex min-h-[52px] items-center gap-3 border-line px-4 py-1.5 transition-colors duration-100 hover:bg-white/[.03] data-[state=open]:bg-white/[.04] [&+&]:border-t";

function AddonIcon({ src, size = 32 }: { src: string | null | undefined; size?: number }) {
  const [broken, setBroken] = useState(false);
  return (
    <div className="grid shrink-0 place-items-center overflow-hidden rounded-ctl bg-surface3 text-dim" style={{ width: size, height: size }}>
      {src && !broken ? (
        <img src={src} alt="" className="h-full w-full object-cover [image-rendering:pixelated]" onError={() => setBroken(true)} />
      ) : (
        <Package size={size * 0.5} />
      )}
    </div>
  );
}

interface Kit {
  Item: (p: MenuItemProps) => React.ReactNode;
  Sep: () => React.ReactNode;
}
const contextKit: Kit = { Item: ContextItem, Sep: ContextSeparator };
const dropdownKit: Kit = { Item: DropdownItem, Sep: DropdownSeparator };

async function removeAddon(server: Server, a: Addon) {
  const ok = await confirm({
    title: tt("srv.addons.remove.title", {
      name: a.title ?? a.name ?? a.file_name,
    }),
    text: tt("srv.addons.remove.text"),
    confirmLabel: tt("common.delete"),
    danger: true,
  });
  if (!ok) return;
  try {
    await addonApi.remove(server.id, a.file_name);
    refresh(server.id);
  } catch (e) {
    toast.error(e);
  }
}

async function toggleAddon(server: Server, a: Addon, on: boolean) {
  try {
    await addonApi.setEnabled(server.id, a.file_name, on);
    queryClient.setQueryData<AddonList>(
      aqk.addons(server.id),
      (l) =>
        l && {
          ...l,
          items: l.items.map((x) =>
            x.file_name === a.file_name
              ? {
                  ...x,
                  enabled: on,
                  file_name: on ? x.file_name.replace(/\.disabled$/, "") : `${x.file_name}.disabled`,
                }
              : x,
          ),
        },
    );
    refresh(server.id);
  } catch (e) {
    toast.error(e);
  }
}

async function updateAddons(server: Server, files: string[] | null) {
  try {
    const n = await addonApi.update(server.id, files);
    toast.success(tt("srv.addons.updated", { n }), server.name);
  } catch (e) {
    toast.error(e, tt("srv.addons.update_failed"));
  } finally {
    refresh(server.id);
  }
}

function AddonItems({ server, addon, update, kit: { Item, Sep } }: { server: Server; addon: Addon; update?: AddonUpdate; kit: Kit }) {
  const t = useT();
  return (
    <>
      {update && (
        <Item icon={<ArrowUpCircle size={14} />} onSelect={() => updateAddons(server, [addon.file_name])}>
          {t("srv.addons.update_to", { v: update.latest })}
        </Item>
      )}
      {addon.page_url && (
        <Item icon={<ExternalLink size={14} />} onSelect={() => openExternal(addon.page_url!)}>
          {t("srv.addons.open_page")}
        </Item>
      )}
      <Item icon={<FolderOpen size={14} />} onSelect={() => openServerFolder(server, folderOf(server))}>
        {t("common.open_folder")}
      </Item>
      <Sep />
      <Item icon={<Trash2 size={14} />} danger onSelect={() => removeAddon(server, addon)}>
        {t("common.delete")}
      </Item>
    </>
  );
}

const folderOf = (s: Server) => (s.platform ? "plugins" : "mods");

function InstalledList({ server, list, updates }: { server: Server; list: AddonList; updates: AddonUpdate[] }) {
  const t = useT();
  const byFile = new Map(updates.map((u) => [u.file_name, u]));
  if (list.items.length === 0) {
    return (
      <EmptyState
        icon={<Package size={22} />}
        title={list.target.plugins ? t("srv.addons.empty.plugins") : t("srv.addons.empty.mods")}
        text={t("srv.addons.empty.text")}
        className="py-10"
      />
    );
  }
  return (
    <>
      {list.items.map((a) => {
        const up = byFile.get(a.file_name);
        const title = a.title ?? a.name ?? a.file_name.replace(/\.jar(\.disabled)?$/, "");
        return (
          <ContextMenu key={a.file_name} content={<AddonItems server={server} addon={a} update={up} kit={contextKit} />}>
            <div className={cn(rowCls, !a.enabled && "opacity-60")}>
              <AddonIcon src={a.icon} />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className={cn("truncate text-[13px] font-semibold", a.enabled ? "text-text" : "text-dim line-through")}>{title}</span>
                  {a.version && <span className="shrink-0 truncate font-mono text-caption text-dim">{a.version}</span>}
                </div>
                <div className="truncate text-caption text-dim" title={a.file_name}>
                  {[
                    a.authors.length ? a.authors.slice(0, 2).join(", ") : null,
                    a.source ? (a.source === "modrinth" ? "Modrinth" : "Hangar") : t("srv.addons.local"),
                    formatBytes(a.size),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              {up && (
                <Tooltip content={t("srv.addons.update_to", { v: up.latest })}>
                  <span>
                    <IconButton
                      label={t("srv.addons.update_to", { v: up.latest })}
                      variant="ghost"
                      size="sm"
                      className="text-accent!"
                      onClick={() => updateAddons(server, [a.file_name])}
                    >
                      <ArrowUpCircle size={15} />
                    </IconButton>
                  </span>
                </Tooltip>
              )}
              <Switch checked={a.enabled} onChange={(v) => toggleAddon(server, a, v)} label={t("srv.addons.enabled")} />
              <DropdownMenu
                trigger={
                  <IconButton
                    label={t("common.more")}
                    tip
                    variant="ghost"
                    size="sm"
                    className="opacity-60 group-hover:opacity-100 data-[state=open]:opacity-100"
                  >
                    <MoreHorizontal size={15} />
                  </IconButton>
                }
              >
                <AddonItems server={server} addon={a} update={up} kit={dropdownKit} />
              </DropdownMenu>
            </div>
          </ContextMenu>
        );
      })}
    </>
  );
}

function SearchPanel({ server, list }: { server: Server; list: AddonList }) {
  const t = useT();
  const hangar = !!list.target.hangar;
  const [source, setSource] = useState<AddonSource>("modrinth");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("relevance");
  const q = useDeferredValue(query.trim());
  const src: AddonSource = hangar ? source : "modrinth";
  const res = useQuery({
    queryKey: aqk.search(server.id, src, q, sort),
    queryFn: () => addonApi.search(server.id, src, q, sort, 0),
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });
  const installed = new Set(list.items.map((a) => a.project_id).filter(Boolean) as string[]);
  // Gleiches Projekt aus der anderen Quelle (Modrinth/Hangar) am Namen erkennen
  const names = new Set(list.items.flatMap((a) => [a.title, a.name]).filter(Boolean).map((n) => n!.toLowerCase()));
  const [busy, setBusy] = useState<string | null>(null);
  const install = useMutation({
    mutationFn: (h: AddonHit) => addonApi.install(server.id, h.source, h.id),
    onMutate: (h) => setBusy(h.id),
    onSuccess: (files, h) => {
      toast.success(
        files.length > 1
          ? tt("srv.addons.installed_deps", {
              name: h.title,
              n: files.length - 1,
            })
          : tt("srv.addons.installed", { name: h.title }),
        tt("srv.addons.restart_hint"),
      );
      refresh(server.id);
    },
    onError: (e) => toast.error(e, tt("srv.addons.install_failed")),
    onSettled: () => setBusy(null),
  });

  return (
    <SettingsCard
      title={list.target.plugins ? t("srv.addons.find.plugins") : t("srv.addons.find.mods")}
      right={
        hangar ? (
          <Segmented<AddonSource>
            value={source}
            onChange={setSource}
            items={[
              { value: "modrinth", label: "Modrinth" },
              { value: "hangar", label: "Hangar" },
            ]}
          />
        ) : undefined
      }
    >
      <div className="flex items-center gap-2 border-b border-line p-3">
        <div className="min-w-0 flex-1">
          <SearchInput value={query} onChange={setQuery} placeholder={list.target.plugins ? t("srv.addons.search.plugins") : t("srv.addons.search.mods")} />
        </div>
        <div className="w-[150px] shrink-0">
          <Select
            value={sort}
            onChange={setSort}
            options={[
              { value: "relevance", label: t("srv.addons.sort.relevance") },
              { value: "downloads", label: t("srv.addons.sort.downloads") },
              { value: "updated", label: t("srv.addons.sort.updated") },
            ]}
          />
        </div>
      </div>
      {res.isError && !res.data ? (
        <ErrorState error={res.error} onRetry={() => res.refetch()} className="py-8" />
      ) : !res.data ? (
        <div className="flex flex-col gap-2 p-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : res.data.hits.length === 0 ? (
        <div className="px-4 py-10 text-center text-[13px] text-dim">{t("srv.addons.no_results")}</div>
      ) : (
        <div className={cn(res.isFetching && "opacity-70")}>
          {res.data.hits.map((h) => {
            const have = installed.has(h.id) || names.has(h.title.toLowerCase());
            return (
              <div key={`${h.source}:${h.id}`} className={rowCls}>
                <AddonIcon src={h.icon_url} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <button
                      type="button"
                      className="truncate text-left text-[13px] font-semibold text-text hover:underline"
                      onClick={() => openExternal(h.page_url)}
                    >
                      {h.title}
                    </button>
                    <span className="shrink-0 truncate text-caption text-dim">{t("srv.addons.by", { author: h.author })}</span>
                  </div>
                  <div className="truncate text-caption text-muted" title={h.description}>
                    {h.description}
                  </div>
                  <div className="text-caption text-dim">
                    {t("srv.addons.downloads", { n: formatCount(h.downloads) })}
                    {h.updated ? ` · ${formatRelative(h.updated)}` : ""}
                  </div>
                </div>
                {have ? (
                  <Tag color="var(--color-ok)">{t("srv.addons.installed_tag")}</Tag>
                ) : (
                  <Button
                    size="sm"
                    variant="subtle"
                    icon={<Download size={14} />}
                    loading={busy === h.id}
                    disabled={!!busy && busy !== h.id}
                    onClick={() => install.mutate(h)}
                  >
                    {t("srv.addons.install")}
                  </Button>
                )}
              </div>
            );
          })}
          {res.data.total > res.data.hits.length && (
            <div className="px-4 py-2.5 text-center text-caption text-dim">
              {t("srv.addons.more", {
                n: formatCount(res.data.total - res.data.hits.length),
              })}
            </div>
          )}
        </div>
      )}
    </SettingsCard>
  );
}

export function ServerAddonsTab({ server }: { server: Server }) {
  const t = useT();
  const st = useServerStatus(server.id);
  const running = st?.state === "running" || st?.state === "starting";
  const list = useQuery({
    queryKey: aqk.addons(server.id),
    queryFn: () => addonApi.list(server.id),
    staleTime: 15_000,
  });
  const updates = useQuery({
    queryKey: aqk.updates(server.id),
    queryFn: () => addonApi.updates(server.id),
    staleTime: 10 * 60_000,
    enabled: !!list.data?.items.length,
  });
  const [updating, setUpdating] = useState(false);
  const plugins = !!server.platform;
  const ups = updates.data ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 px-6">
        <p className="min-w-0 flex-1 truncate text-meta text-dim">
          {running
            ? t("srv.addons.hint_running")
            : plugins
              ? t("srv.addons.hint.plugins", {
                  loaders: list.data?.target.loaders.join(", ") ?? "…",
                })
              : t("srv.addons.hint.mods")}
        </p>
        <IconButton label={t("srv.addons.check_updates")} tip variant="ghost" onClick={() => updates.refetch()} disabled={updates.isFetching}>
          <RefreshCw size={15} className={cn(updates.isFetching && "animate-spin")} />
        </IconButton>
        <IconButton label={t("common.open_folder")} tip variant="ghost" onClick={() => openServerFolder(server, folderOf(server))}>
          <FolderOpen size={16} />
        </IconButton>
        {ups.length > 0 && (
          <Button
            size="sm"
            variant="accent"
            icon={<ArrowUpCircle size={14} />}
            loading={updating}
            onClick={async () => {
              setUpdating(true);
              await updateAddons(server, null);
              setUpdating(false);
            }}
          >
            {t("srv.addons.update_all", { n: ups.length })}
          </Button>
        )}
      </div>
      <div className="scroll min-h-0 flex-1">
        {list.isError && !list.data ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} className="py-10" />
        ) : !list.data ? (
          <div className="grid grid-cols-2 gap-5 px-6 pt-1">
            <Skeleton className="h-64" />
            <Skeleton className="h-64" />
          </div>
        ) : (
          <div className="grid w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-5 px-6 pb-8 pt-1">
            <SettingsCard
              title={
                <>
                  {plugins ? t("srv.addons.installed_plugins") : t("srv.addons.installed_mods")}
                  <span className="ml-1.5 text-[12px] font-medium text-dim">{list.data.items.length}</span>
                </>
              }
              right={
                <Tooltip
                  content={t("srv.addons.folder", {
                    folder: list.data.target.folder,
                  })}
                >
                  <span className="font-mono text-caption text-dim">{list.data.target.folder}/</span>
                </Tooltip>
              }
            >
              <InstalledList server={server} list={list.data} updates={ups} />
            </SettingsCard>
            <SearchPanel server={server} list={list.data} />
          </div>
        )}
      </div>
    </div>
  );
}
