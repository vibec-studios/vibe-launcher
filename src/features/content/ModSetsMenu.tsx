// OWNER: Content-Agent. Mod-Sets: Menü in der Werkzeugleiste der Inhalte (zeigt auch das aktive Set).
import { useQuery } from "@tanstack/react-query";
import { Check, Layers, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button, Dialog, cn, DropdownItem, DropdownLabel, DropdownMenu, DropdownSeparator, Field, Input, confirm, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/queries";
import type { ModSets } from "@/lib/types";

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
  const { data } = useModSets(instanceId);
  const [dialog, setDialog] = useState<{ mode: "create" | "rename"; setId?: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const active = data?.sets.find((s) => s.id === data.active);

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

  return (
    <>
      <DropdownMenu
        trigger={
          <Button
            size="sm"
            variant="subtle"
            icon={<Layers size={14} />}
            loading={busy}
            title={active ? `${t("modsets.button")}: ${active.name}${data?.active_modified ? " *" : ""}` : t("modsets.button")}
            className="data-[state=open]:bg-white/[.07] data-[state=open]:text-text"
          >
            <span className={cn("max-w-[140px] truncate", labelClassName)}>
              {active ? `${active.name}${data?.active_modified ? " *" : ""}` : t("modsets.button")}
            </span>
          </Button>
        }
      >
        {data && data.sets.length > 0 ? (
          <>
            <DropdownLabel>{t("modsets.button")}</DropdownLabel>
            {data.sets.map((s) => (
              <DropdownItem
                key={s.id}
                icon={s.id === data.active ? <Check size={14} /> : <span className="w-[14px]" />}
                onSelect={() => void act(() => api.modsetApply(instanceId, s.id), () => toast.success(t("modsets.applied", { name: s.name })))}
                shortcut={t("modsets.count", { on: s.enabled_count, total: s.total_count })}
              >
                {s.name}
              </DropdownItem>
            ))}
            <DropdownSeparator />
          </>
        ) : (
          <div className="max-w-[260px] px-3 py-2 text-[12.5px] text-muted">{t("modsets.none")}</div>
        )}
        <DropdownItem icon={<Plus size={14} />} onSelect={() => setDialog({ mode: "create", name: "" })}>
          {t("modsets.create")}
        </DropdownItem>
        {active && (
          <>
            <DropdownItem icon={<Save size={14} />} onSelect={() => void act(() => api.modsetSave(instanceId, active.id))}>
              {t("modsets.save", { name: active.name })}
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
