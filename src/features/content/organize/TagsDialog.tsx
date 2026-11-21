import { Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Button, Dialog, Field, Input, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { organizeApi, orgItemKey, setOrganize, useOrganize, type Target } from "./api";

export function TagsDialog({ instanceId, targets, names, onClose }: { instanceId: string; targets: Target[]; names: string[]; onClose: () => void }) {
  const t = useT();
  const { data } = useOrganize(instanceId);
  const initial = useMemo(() => {
    const map = new Map((data?.items ?? []).map((i) => [orgItemKey(i.kind, i.file), i.tags]));
    const lists = targets.map((x) => map.get(orgItemKey(x.kind, x.file_name)) ?? []);
    const all = new Map<string, number>();
    for (const l of lists) for (const tag of l) all.set(tag, (all.get(tag) ?? 0) + 1);
    return all;
  }, [data, targets]);
  const [tags, setTags] = useState<Map<string, number>>(initial);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const suggestions = (data?.tags ?? []).filter((s) => ![...tags.keys()].some((k) => k.toLowerCase() === s.toLowerCase()));

  const add = (raw: string) => {
    const v = raw.trim().replace(/^#/, "").slice(0, 24);
    if (!v || [...tags.keys()].some((k) => k.toLowerCase() === v.toLowerCase())) return;
    setTags(new Map(tags).set(v, targets.length));
    setRemoved((r) => new Set([...r].filter((x) => x.toLowerCase() !== v.toLowerCase())));
    setText("");
  };
  const drop = (tag: string) => {
    const next = new Map(tags);
    next.delete(tag);
    setTags(next);
    setRemoved((r) => new Set(r).add(tag));
  };

  const save = async () => {
    setBusy(true);
    try {
      const pending = text.trim() ? [text.trim()] : [];
      const addList = [...[...tags.entries()].filter(([, n]) => n === targets.length).map(([k]) => k), ...pending];
      const d = await organizeApi.editTags(instanceId, targets, addList, [...removed]);
      setOrganize(instanceId, d);
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const title = names.length === 1 ? t("org.tags.title_one", { name: names[0] }) : t("org.tags.title_n", { n: names.length });

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={title}
      description={t("org.tags.text")}
      size="md"
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="accent" loading={busy} onClick={() => void save()}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pb-1">
        <div className="flex min-h-9 flex-wrap items-center gap-1.5">
          {tags.size === 0 && <span className="text-[13px] text-dim">{t("org.tags.none")}</span>}
          {[...tags.entries()].map(([tag, n]) => (
            <span key={tag} className="inline-flex h-7 items-center gap-1 rounded-pill bg-surface3 pl-2.5 pr-1 text-[12.5px] font-medium text-text">
              #{tag}
              {n < targets.length && <span className="text-[11px] text-dim">{t("org.tags.partial", { n, total: targets.length })}</span>}
              <button type="button" aria-label={t("org.tags.remove", { tag })} onClick={() => drop(tag)} className="grid h-5 w-5 place-items-center rounded-full text-dim hover:bg-white/10 hover:text-text">
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add(text);
          }}
        >
          <Field label={t("org.tags.add")} className="flex-1">
            <Input autoFocus value={text} maxLength={24} onChange={(e) => setText(e.target.value)} placeholder={t("org.tags.placeholder")} />
          </Field>
          <Button type="submit" variant="subtle" icon={<Plus size={15} />} disabled={!text.trim()}>
            {t("org.tags.add_btn")}
          </Button>
        </form>
        <p className="-mt-2 text-[12px] text-dim">{t("org.tags.hint")}</p>
        {suggestions.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[12px] text-dim">{t("org.tags.used")}</span>
            {suggestions.slice(0, 16).map((s) => (
              <button key={s} type="button" onClick={() => add(s)} className="h-7 rounded-pill bg-surface px-2.5 text-[12.5px] text-muted hover:bg-surface2 hover:text-text">
                #{s}
              </button>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}
