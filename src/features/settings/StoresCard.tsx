// OWNER: Content-Agent. Einstellungen → Stores: Liste, URL hinzufügen, an/aus, entfernen.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, MoreHorizontal, Plus, Store, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  Button,
  ContextItem,
  ContextMenu,
  DropdownItem,
  DropdownMenu,
  IconButton,
  Input,
  Skeleton,
  Spinner,
  Switch,
  SettingsCard,
  confirm,
  toast,
} from "@/components/ui";
import { openExternal } from "@/components/content/util";
import { useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import type { StoreInfo } from "@/lib/types";

const STORE_DOCS = "https://github.com/vibec-studios/vibe-launcher/blob/master/docs/STORE.md";

export function StoresCard({ id }: { id: string }) {
  const t = useT();
  const qc = useQueryClient();
  const stores = useQuery({ queryKey: ["stores"], queryFn: api.storesList, staleTime: 5 * 60_000 });
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["stores"] });

  const add = async () => {
    if (!url.trim()) return;
    setAdding(true);
    setError(null);
    try {
      const s = await api.storeAdd(url.trim());
      setUrl("");
      toast.success(t("stores.added", { name: s.name }));
      refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setAdding(false);
    }
  };

  const toggle = async (s: StoreInfo, enabled: boolean) => {
    qc.setQueryData<StoreInfo[]>(["stores"], (old) => old?.map((x) => (x.id === s.id ? { ...x, enabled } : x)));
    try {
      await api.storeSetEnabled(s.id, enabled);
    } catch (e) {
      toast.error(e);
    }
    refresh();
  };

  const remove = async (s: StoreInfo) => {
    if (!(await confirm({ title: t("stores.remove_confirm", { name: s.name }), confirmLabel: t("stores.remove"), danger: true }))) return;
    try {
      await api.storeRemove(s.id);
      toast.success(t("stores.removed"));
    } catch (e) {
      toast.error(e);
    }
    refresh();
  };

  return (
    <SettingsCard
      id={id}
      title={t("settings.section.stores")}
      right={
        <button className="rounded-ctl px-1 text-meta text-muted hover:text-text" onClick={() => void openExternal(STORE_DOCS)}>
          {t("stores.format_help")}
        </button>
      }
    >
      <div className="px-4 pt-3 text-meta text-muted">{t("stores.desc")}</div>
      <div className="flex flex-col px-2 py-2">
        {stores.isPending
          ? Array.from({ length: 1 }, (_, i) => <Skeleton key={i} className="my-2 h-[46px]" />)
          : (stores.data ?? []).map((s) => (
              <ContextMenu
                key={s.id}
                disabled={s.builtin}
                content={
                  <ContextItem icon={<Trash2 size={14} />} danger onSelect={() => void remove(s)}>
                    {t("stores.remove")}
                  </ContextItem>
                }
              >
              <div className="flex items-center gap-3 rounded-ctl px-2 py-2 transition-colors duration-100 hover:bg-white/[.03]">
                <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-ctl bg-surface2 text-dim">
                  {s.icon ? <img src={s.icon} alt="" className="h-full w-full object-contain" /> : <Store size={16} />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13.5px] font-semibold text-text">{s.name}</span>
                    {s.builtin && <span className="rounded-xs bg-white/[.06] px-1.5 py-px text-caption text-muted">{t("stores.builtin")}</span>}
                  </div>
                  <div className="flex min-w-0 items-center gap-1.5 text-meta text-dim">
                    {s.error ? (
                      <span className="flex items-center gap-1 text-warn" title={s.error}>
                        <AlertTriangle size={12} /> {t("stores.error")}
                      </span>
                    ) : s.project_count != null ? (
                      <span>{s.project_count === 1 ? t("stores.projects_1") : t("stores.projects", { n: s.project_count })}</span>
                    ) : !s.enabled ? (
                      <span>{t("stores.disabled")}</span>
                    ) : null}
                    <span>·</span>
                    <span className="selectable truncate" title={s.url}>
                      {s.url}
                    </span>
                  </div>
                </div>
                <Switch checked={s.enabled} onChange={(v) => void toggle(s, v)} label={s.name} />
                {s.builtin ? (
                  <span className="w-8 shrink-0" />
                ) : (
                  <DropdownMenu
                    trigger={
                      <IconButton label={t("common.more")} tip variant="ghost" size="sm">
                        <MoreHorizontal size={16} />
                      </IconButton>
                    }
                  >
                    <DropdownItem icon={<Trash2 size={14} />} danger onSelect={() => void remove(s)}>
                      {t("stores.remove")}
                    </DropdownItem>
                  </DropdownMenu>
                )}
              </div>
              </ContextMenu>
            ))}
      </div>
      <div className="flex flex-col gap-2 border-t border-line px-4 py-3">
        <div className="flex gap-2">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t("stores.add_placeholder")}
            onKeyDown={(e) => e.key === "Enter" && !adding && void add()}
            invalid={!!error}
            className="flex-1"
          />
          <Button icon={adding ? <Spinner /> : <Plus size={14} />} disabled={!url.trim() || adding} onClick={() => void add()}>
            {t("stores.add")}
          </Button>
        </div>
        {error && <div className="selectable text-meta text-danger">{error}</div>}
      </div>
    </SettingsCard>
  );
}
