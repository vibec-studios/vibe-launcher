// OWNER: Content-Agent. „Sets“-Menü in der Werkzeugleiste der Inhalte:
//  1. Mod-Sets (instanzübergreifende Wunschlisten, src/features/modsets): auf diese Instanz anwenden, diese Instanz
//     als Set speichern, verwalten. Neue Projekte in bereits angewendeten Sets stehen als „2 neu“ daneben.
//  2. Profile dieser Instanz (früher „Mod-Sets“): benannte Ein/Aus-Zustände der vorhandenen Dateien. Sie bleiben, weil
//     sie etwas anderes leisten (schnell zwischen „PvP“ und „Alles an“ umschalten, ohne etwas herunterzuladen); ein
//     Profil lässt sich als Mod-Set übernehmen.
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Check, FolderInput, Layers, Pencil, Plus, Save, Settings2, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button, Dialog, cn, DropdownItem, DropdownLabel, DropdownMenu, DropdownSeparator, Field, Input, confirm, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/queries";
import type { ModSets } from "@/lib/types";
import { invalidateSets, setsApi, useSetNews, useSets } from "@/features/modsets/api";
import { openApplySets, openSetFromInstance } from "@/features/modsets/shared";

const key = (id: string) => ["content", id, "modsets"] as const;

export function useModSets(instanceId: string) {
  return useQuery({ queryKey: key(instanceId), queryFn: () => api.modsetsList(instanceId), staleTime: 30_000 });
}

function setData(id: string, d: ModSets) {
  queryClient.setQueryData(key(id), d);
  queryClient.invalidateQueries({ queryKey: ["content", id] });
}

export function ModSetsMenu({ instanceId, labelClassName }: { instanceId: string; labelClassName?: string }) {
  const t = useT();
  const nav = useNavigate();
  const { data } = useModSets(instanceId);
  const sets = useSets().data ?? [];
  const news = useSetNews(instanceId).data ?? [];
  const [dialog, setDialog] = useState<{ mode: "create" | "rename"; setId?: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const active = data?.sets.find((s) => s.id === data.active);
  const newCount = news.reduce((n, x) => n + x.new_entries.length, 0);

  const act = async (fn: () => Promise<ModSets>, done?: (d: ModSets) => void) => {
    setBusy(true);
    try {
      const d = await fn();
      setData(instanceId, d);
      done?.(d);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!dialog || !dialog.name.trim()) return;
    const d = dialog;
    await act(() => (d.mode === "create" ? api.modsetCreate(instanceId, d.name) : api.modsetRename(instanceId, d.setId!, d.name)));
    setDialog(null);
  };

  const profileToSet = async (profileId: string) => {
    setBusy(true);
    try {
      const [s, skipped] = await setsApi.fromProfile(instanceId, profileId);
      await invalidateSets();
      toast.success(t("imenu.profile_to_set_done", { name: s.name }), skipped ? t("imenu.profile_to_set_skipped", { n: skipped }) : undefined, {
        label: t("sets.edit"),
        onClick: () => nav({ to: "/modsets", search: { set: s.id } }),
      });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DropdownMenu
        trigger={
          <Button
            size="sm"
            variant="subtle"
            icon={<Layers size={14} />}
            loading={busy}
            title={active ? `${t("modsets.active", { name: active.name })}${data?.active_modified ? ` (${t("modsets.modified")})` : ""}` : t("imenu.button")}
            className="relative data-[state=open]:bg-white/[.07] data-[state=open]:text-text"
          >
            {/* „Sets“, bei aktivem Profil zusätzlich dessen Name */}
            <span className={cn("max-w-[180px] truncate", labelClassName)}>
              {t("imenu.button")}
              {active && <span className="font-medium text-dim"> · {active.name}</span>}
            </span>
            {/* Geändert seit dem Speichern: kleiner Punkt statt „ *“ */}
            {active && data?.active_modified && <span className="h-1.5 w-1.5 shrink-0 rounded-dot bg-warn" aria-label={t("modsets.modified")} />}
            {newCount > 0 && <span className="h-1.5 w-1.5 shrink-0 rounded-dot bg-brand" aria-label={t("imenu.new_badge", { n: newCount })} />}
          </Button>
        }
      >
        {/* 1. Mod-Sets */}
        <DropdownLabel>{t("imenu.sets")}</DropdownLabel>
        {sets.length > 0 ? (
          <div className="scroll max-h-[260px]">
            {sets.map((s) => {
              const n = news.find((x) => x.set_id === s.id)?.new_entries.length ?? 0;
              return (
                <DropdownItem
                  key={s.id}
                  icon={n ? <Sparkles size={14} className="text-brand" /> : <Layers size={14} />}
                  disabled={!s.entries.length}
                  shortcut={n ? t("imenu.new_badge", { n }) : String(s.entries.length)}
                  onSelect={() => openApplySets(instanceId, [s.id])}
                >
                  <span className="max-w-[220px] truncate">{s.name}</span>
                </DropdownItem>
              );
            })}
          </div>
        ) : (
          <div className="max-w-[280px] px-3 py-2 text-[12.5px] text-muted">{t("imenu.sets_none")}</div>
        )}
        <DropdownItem icon={<FolderInput size={14} />} onSelect={() => openSetFromInstance(instanceId)}>
          {t("imenu.save_as_set")}
        </DropdownItem>
        <DropdownItem icon={<Settings2 size={14} />} onSelect={() => nav({ to: "/modsets", search: {} })}>
          {t("sets.manage")}
        </DropdownItem>

        {/* 2. Profile dieser Instanz */}
        <DropdownSeparator />
        <DropdownLabel>{t("imenu.profiles")}</DropdownLabel>
        {data && data.sets.length > 0 ? (
          data.sets.map((s) => (
            <DropdownItem
              key={s.id}
              icon={s.id === data.active ? <Check size={14} /> : <span className="w-[14px]" />}
              onSelect={() => void act(() => api.modsetApply(instanceId, s.id), () => toast.success(t("modsets.applied", { name: s.name })))}
              shortcut={t("modsets.count", { on: s.enabled_count, total: s.total_count })}
            >
              {s.name}
            </DropdownItem>
          ))
        ) : (
          <div className="max-w-[280px] px-3 py-2 text-[12.5px] text-muted">{t("modsets.none")}</div>
        )}
        <DropdownItem icon={<Plus size={14} />} onSelect={() => setDialog({ mode: "create", name: "" })}>
          {t("modsets.create")}
        </DropdownItem>
        {active && (
          <>
            <DropdownItem icon={<Save size={14} />} onSelect={() => void act(() => api.modsetSave(instanceId, active.id))}>
              {t("modsets.save", { name: active.name })}
            </DropdownItem>
            <DropdownItem icon={<Layers size={14} />} onSelect={() => void profileToSet(active.id)}>
              {t("imenu.profile_to_set", { name: active.name })}
            </DropdownItem>
            <DropdownItem icon={<Pencil size={14} />} onSelect={() => setDialog({ mode: "rename", setId: active.id, name: active.name })}>
              {t("modsets.rename", { name: active.name })}
            </DropdownItem>
            <DropdownItem
              icon={<Trash2 size={14} />}
              danger
              onSelect={async () => {
                if (await confirm({ title: t("modsets.delete_confirm", { name: active.name }), danger: true, confirmLabel: t("common.remove") }))
                  void act(() => api.modsetDelete(instanceId, active.id));
              }}
            >
              {t("modsets.delete", { name: active.name })}
            </DropdownItem>
          </>
        )}
      </DropdownMenu>
      <Dialog
        open={!!dialog}
        onOpenChange={(o) => !o && setDialog(null)}
        title={dialog?.mode === "rename" ? t("modsets.rename_title") : t("modsets.create_title")}
        size="sm"
        footer={
          <>
            <Button variant="subtle" onClick={() => setDialog(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" disabled={!dialog?.name.trim()} loading={busy} onClick={() => void submit()}>
              {t("common.save")}
            </Button>
          </>
        }
      >
        <Field label={t("modsets.name")}>
          <Input
            autoFocus
            value={dialog?.name ?? ""}
            placeholder={t("modsets.name_placeholder")}
            onChange={(e) => setDialog((d) => (d ? { ...d, name: e.target.value } : d))}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
          />
        </Field>
      </Dialog>
    </>
  );
}
