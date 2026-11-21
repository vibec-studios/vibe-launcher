import { Check, CircleHelp, Wand2, X } from "lucide-react";
import { useState } from "react";
import { ProjectIcon } from "@/components/content/ProjectIcon";
import { Button, Checkbox, Textarea, cn, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { entryKey, invalidateSets, setsApi, type ParsedLine, type SetEntry } from "../api";

export const noop = () => {};

// ------------------------------------------------------------------ Ergebnisliste (Liste einfügen / Import)

/** Erkannte Zeilen mit Auswahl. `existing`: Schlüssel, die schon im Set sind. */
export function ParsedList({ lines, selected, onToggle, existing }: { lines: ParsedLine[]; selected: Set<number>; onToggle: (i: number) => void; existing?: Set<string> }) {
  const t = useT();
  return (
    <div className="flex flex-col">
      {lines.map((l, i) => {
        const inSet = !!l.entry && !!existing?.has(entryKey(l.entry));
        const can = !!l.entry && !inSet;
        const status =
          l.status === "ok" ? null : l.status === "guess" ? (
            <span className="text-warn">{t("paste.status.guess")}</span>
          ) : l.status === "unsupported" ? (
            <span className="text-warn">{l.message === "curseforge" ? t("paste.status.curseforge") : t("paste.status.link")}</span>
          ) : (
            <span className="text-danger">{t("paste.status.not_found")}</span>
          );
        return (
          <div
            key={i}
            onClick={() => can && onToggle(i)}
            className={cn("flex items-center gap-3 rounded-ctl px-2 py-1.5", can ? "cursor-default hover:bg-white/[.03]" : "opacity-70")}
          >
            {can ? <Checkbox checked={selected.has(i)} onChange={noop} label={l.entry!.title} /> : <span className="w-[18px]" />}
            {l.entry ? (
              <ProjectIcon src={l.entry.icon_url} size={30} />
            ) : (
              <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-card bg-danger/10 text-danger">
                <X size={15} />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-[13px] font-semibold text-text">{l.entry?.title ?? l.line}</span>
                {l.entry && <span className="shrink-0 text-[11.5px] text-dim">{t(`sets.type.${l.entry.project_type}`)} · {t(`sets.source.${l.entry.source === "curseforge" ? "curseforge" : "modrinth"}`)}</span>}
              </div>
              <div className="truncate text-[12px] text-dim">
                {inSet ? t("sets.add.in_set") : status ?? <span title={l.line}>{l.line}</span>}
                {status && l.entry && <span className="ml-1">„{l.line}“</span>}
              </div>
            </div>
            {l.status === "ok" && can && <Check size={14} className="shrink-0 text-ok" />}
            {l.status === "guess" && <CircleHelp size={14} className="shrink-0 text-warn" />}
          </div>
        );
      })}
    </div>
  );
}

export function initialSelection(lines: ParsedLine[], existing?: Set<string>) {
  return new Set(lines.map((l, i) => (l.entry && !existing?.has(entryKey(l.entry)) ? i : -1)).filter((i) => i >= 0));
}

/** „Liste einfügen“: Textfeld -> erkennen -> auswählen -> hinzufügen. Inline nutzbar (Editor) oder im Dialog. */
export function PasteList({ existing, onAdd, compact }: { existing?: Set<string>; onAdd: (entries: SetEntry[]) => Promise<void>; compact?: boolean }) {
  const t = useT();
  const [text, setText] = useState("");
  const [lines, setLines] = useState<ParsedLine[] | null>(null);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const n = text.split(/\n/).filter((l) => l.trim()).length;

  const detect = async () => {
    setBusy(true);
    try {
      const r = await setsApi.parseList(text);
      setLines(r);
      setSel(initialSelection(r, existing));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const add = async () => {
    if (!lines) return;
    setBusy(true);
    try {
      await onAdd(lines.filter((_, i) => sel.has(i)).map((l) => l.entry!));
      setLines(null);
      setText("");
    } finally {
      setBusy(false);
    }
  };

  if (!lines)
    return (
      <div className="flex flex-col gap-2">
        <div className="text-[12.5px] text-muted">{t("paste.text")}</div>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("paste.placeholder")}
          rows={compact ? 7 : 9}
          spellCheck={false}
          className="font-mono text-[12.5px]"
        />
        <div className="flex items-center justify-end gap-2">
          {busy && <span className="mr-auto text-[12px] text-dim">{t("paste.working", { n })}</span>}
          <Button size="sm" variant="primary" icon={<Wand2 size={14} />} disabled={!text.trim()} loading={busy} onClick={() => void detect()}>
            {t("paste.detect")}
          </Button>
        </div>
      </div>
    );
  const ok = lines.filter((l) => l.entry).length;
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="text-[12.5px] text-muted">{t("paste.summary", { ok, bad: lines.length - ok })}</div>
      <div className={cn("scroll -mx-2", compact ? "max-h-[360px]" : "max-h-[420px]")}>
        <ParsedList lines={lines} selected={sel} existing={existing} onToggle={(i) => setSel((s) => (s.has(i) ? (s.delete(i), new Set(s)) : new Set(s).add(i)))} />
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button size="sm" variant="subtle" onClick={() => setLines(null)}>
          {t("paste.again")}
        </Button>
        <Button size="sm" variant="primary" disabled={!sel.size} loading={busy} onClick={() => void add()}>
          {t("paste.add_n", { n: sel.size })}
        </Button>
      </div>
    </div>
  );
}

/** Einträge hinzufügen + Rückmeldung (gemeinsam für Suche, Liste, Instanz). */
export async function addToSet(t: ReturnType<typeof useT>, setId: string, entries: SetEntry[], before: number) {
  try {
    const s = await setsApi.addEntries(setId, entries);
    await invalidateSets();
    const added = s.entries.length - before;
    if (added <= 0) toast.info(t("sets.add.none_new"));
    else if (added === 1 && entries.length === 1) toast.success(t("sets.add.added", { name: entries[0].title }));
    else toast.success(t("sets.add.added_n", { n: added }));
  } catch (e) {
    toast.error(e);
  }
}
