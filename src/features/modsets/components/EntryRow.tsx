import { useNavigate } from "@tanstack/react-router";
import { Check, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { ProjectIcon } from "@/components/content/ProjectIcon";
import { Button, IconButton, Input, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { loaderNames } from "@/lib/format";
import { invalidateSets, setsApi, type ModSetInfo, type SetCompat, type SetEntry } from "../api";
import { countLabel, typeSummary } from "../shared";

export function compatLine(t: ReturnType<typeof useT>, c: SetCompat["entries"][number] | undefined): string | null {
  if (!c) return null;
  if (c.error) return t("sets.compat.unknown");
  if (!c.mc_max) return t("sets.compat.none");
  const range = c.mc_min && c.mc_min !== c.mc_max ? `${c.mc_min} – ${c.mc_max}` : c.mc_max;
  const loaders = c.loaders.filter((l) => l !== "vanilla").map((l) => loaderNames[l]);
  return loaders.length ? t("sets.compat.entry", { loaders: loaders.join(", "), range }) : range;
}

export function EntryRow({ e, compat, onRemove }: { e: SetEntry; compat: string | null; onRemove: () => void }) {
  const t = useT();
  const nav = useNavigate();
  return (
    <div className="group flex items-center gap-3 rounded-ctl px-3 py-2 transition-colors duration-100 hover:bg-white/[.03]">
      <ProjectIcon src={e.icon_url} size={36} />
      <button className="min-w-0 flex-1 text-left" onClick={() => nav({ to: "/discover", search: { p: `${e.source}:${e.project_id}`, source: e.source === "modrinth" ? undefined : e.source } })}>
        <div className="truncate text-[13.5px] font-semibold text-text group-hover:underline">{e.title}</div>
        <div className="truncate text-meta text-muted">
          {t(`sets.type.${e.project_type}`)} · {t(`sets.source.${e.source === "curseforge" ? "curseforge" : "modrinth"}`)}
          {compat && <span className="text-dim"> · {compat}</span>}
        </div>
      </button>
      <IconButton label={t("sets.remove_entry")} tip size="sm" variant="ghost" className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100" onClick={onRemove}>
        <Trash2 size={14} />
      </IconButton>
    </div>
  );
}

export function NameEditor({ set }: { set: ModSetInfo }) {
  const t = useT();
  const [edit, setEdit] = useState<null | { name: string; description: string }>(null);
  const save = async () => {
    if (!edit || !edit.name.trim()) return;
    try {
      await setsApi.update(set.id, { name: edit.name, description: edit.description });
      await invalidateSets();
      setEdit(null);
    } catch (e) {
      toast.error(e);
    }
  };
  if (edit)
    return (
      <div className="flex min-w-0 flex-1 flex-col gap-1.5" onKeyDown={(e) => (e.key === "Enter" ? void save() : e.key === "Escape" && setEdit(null))}>
        <Input autoFocus value={edit.name} maxLength={60} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className="font-semibold" aria-label={t("sets.name")} />
        <Input value={edit.description} maxLength={400} placeholder={t("sets.description_placeholder")} onChange={(e) => setEdit({ ...edit, description: e.target.value })} aria-label={t("sets.description")} />
        <div className="flex gap-2">
          <Button size="sm" variant="primary" icon={<Check size={14} />} disabled={!edit.name.trim()} onClick={() => void save()}>
            {t("common.save")}
          </Button>
          <Button size="sm" variant="subtle" onClick={() => setEdit(null)}>
            {t("common.cancel")}
          </Button>
        </div>
      </div>
    );
  return (
    <div className="min-w-0 flex-1">
      <button className="group flex max-w-full items-center gap-2 text-left" onClick={() => setEdit({ name: set.name, description: set.description ?? "" })} title={t("sets.rename")}>
        <h1 className="truncate text-title text-text">{set.name}</h1>
        <Pencil size={14} className="shrink-0 text-dim opacity-0 transition-opacity group-hover:opacity-100" />
      </button>
      {set.description && <div className="mt-0.5 truncate text-[13px] text-muted">{set.description}</div>}
      <div className="mt-1 text-meta text-dim">
        {[countLabel(t, set.entries.length), typeSummary(t, set.entries), set.used_by.length ? (set.used_by.length === 1 ? t("sets.used_by_1") : t("sets.used_by", { n: set.used_by.length })) : null]
          .filter(Boolean)
          .join(" · ")}
      </div>
    </div>
  );
}
