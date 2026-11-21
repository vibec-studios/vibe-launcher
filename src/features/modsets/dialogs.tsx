// OWNER: Content-Agent. Mod-Sets erstellen/füllen: Liste einfügen, Importieren (Code/Datei), Neues Set, Aus Instanz.
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Check, CircleHelp, FileUp, Wand2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ProjectIcon } from "@/components/content/ProjectIcon";
import { InstanceBadge } from "@/components/content/InstanceBadge";
import { Button, Checkbox, Dialog, ErrorState, Field, Input, Select, Skeleton, Textarea, cn, toast } from "@/components/ui";
import { useT } from "@/i18n";
import { formatLoader } from "@/lib/format";
import { useInstances } from "@/lib/queries";
import { entryKey, invalidateSets, setsApi, useSets, type ParsedLine, type SetEntry } from "./api";
import { ApplyDialog } from "./ApplyDialog";
import { useSetDialogs } from "./shared";

const noop = () => {};

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

function initialSelection(lines: ParsedLine[], existing?: Set<string>) {
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

// ------------------------------------------------------------------ Neues Set

function CreateSetDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const s = await setsApi.create(name, [], desc);
      await invalidateSets();
      toast.success(t("sets.created", { name: s.name }));
      onClose();
      nav({ to: "/modsets", search: { set: s.id } });
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("sets.create_title")}
      size="md"
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" disabled={!name.trim()} loading={busy} onClick={() => void submit()}>
            {t("sets.create")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t("sets.name")}>
          <Input autoFocus value={name} maxLength={60} placeholder={t("sets.name_placeholder")} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void submit()} />
        </Field>
        <Field label={t("sets.description")}>
          <Input value={desc} maxLength={400} placeholder={t("sets.description_placeholder")} onChange={(e) => setDesc(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void submit()} />
        </Field>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ Importieren (Code / Datei / Liste)

function ImportSetDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const nav = useNavigate();
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ name: string; lines: ParsedLine[]; description: string | null } | null>(null);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  const show = (r: Awaited<ReturnType<typeof setsApi.importText>>) => {
    setResult({ name: r.name ?? t("import.default_name"), lines: r.lines, description: r.description });
    setSel(initialSelection(r.lines));
  };
  const read = async () => {
    setBusy(true);
    try {
      show(await setsApi.importText(text));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const pickFile = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const path = await open({ multiple: false, filters: [{ name: t("import.file_filter"), extensions: ["json", "vibeset", "txt"] }] });
      if (typeof path !== "string") return;
      setBusy(true);
      show(await setsApi.importFile(path));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (!result) return;
    setBusy(true);
    try {
      const entries = result.lines.filter((_, i) => sel.has(i)).map((l) => l.entry!);
      const s = await setsApi.create(result.name.trim() || t("import.default_name"), entries, result.description);
      await invalidateSets();
      toast.success(t("import.saved", { name: s.name }));
      onClose();
      nav({ to: "/modsets", search: { set: s.id } });
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("import.title")}
      description={result ? undefined : t("import.text")}
      size="lg"
      className="[&_.vl-dialog-foot]:flex-wrap"
      footer={
        result ? (
          <>
            <Button variant="subtle" className="mr-auto" onClick={() => setResult(null)}>
              {t("paste.again")}
            </Button>
            <Button variant="subtle" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" disabled={!sel.size || !result.name.trim()} loading={busy} onClick={() => void save()}>
              {t("import.save")}
            </Button>
          </>
        ) : (
          <>
            <Button variant="subtle" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" disabled={!text.trim()} loading={busy} onClick={() => void read()}>
              {t("import.read")}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="flex flex-col gap-3">
          <Field label={t("sets.name")}>
            <Input value={result.name} maxLength={60} onChange={(e) => setResult({ ...result, name: e.target.value })} />
          </Field>
          <div className="-mx-2">
            <ParsedList lines={result.lines} selected={sel} onToggle={(i) => setSel((s) => (s.has(i) ? (s.delete(i), new Set(s)) : new Set(s).add(i)))} />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <button
            type="button"
            disabled={busy}
            onClick={() => void pickFile()}
            className="flex items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 text-left text-[15px] font-semibold text-text hover:bg-surface2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
          >
            <FileUp size={20} className="shrink-0 text-accent" /> {t("import.file")}
          </button>
          <Field label={t("import.paste_label")}>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={`${t("import.placeholder")}\n\n${t("paste.placeholder")}`}
              rows={6}
              spellCheck={false}
              className="text-[14px]"
            />
          </Field>
        </div>
      )}
    </Dialog>
  );
}

// ------------------------------------------------------------------ Aus einer Instanz

export function InstanceCandidatesList({ instanceId, existing, onSubmit, submitLabel, busy }: { instanceId: string; existing?: Set<string>; onSubmit: (entries: SetEntry[]) => void; submitLabel: (n: number) => string; busy?: boolean }) {
  const t = useT();
  const q = useQuery({ queryKey: ["mod-sets", "candidates", instanceId], queryFn: () => setsApi.instanceCandidates(instanceId), staleTime: 10_000 });
  const [sel, setSel] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (q.data) setSel(new Set(q.data.items.filter((c) => c.enabled && !existing?.has(entryKey(c.entry))).map((c) => entryKey(c.entry))));
  }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const items = q.data?.items ?? [];
  const selectable = items.filter((c) => !existing?.has(entryKey(c.entry)));
  if (q.isPending)
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-10" />
        ))}
      </div>
    );
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <div className="flex min-h-0 flex-col gap-2">
      {items.length === 0 ? (
        <div className="py-6 text-center text-[13px] text-muted">{t("frominst.empty")}</div>
      ) : (
        <>
          <div className="flex items-center gap-2 text-[12.5px]">
            <button className="font-semibold text-brand hover:underline" onClick={() => setSel(new Set(selectable.map((c) => entryKey(c.entry))))}>
              {t("frominst.all")}
            </button>
            <span className="text-dim">·</span>
            <button className="font-semibold text-muted hover:text-text" onClick={() => setSel(new Set())}>
              {t("frominst.none_sel")}
            </button>
          </div>
          <div className="scroll -mx-2 max-h-[380px]">
            {items.map((c) => {
              const k = entryKey(c.entry);
              const inSet = !!existing?.has(k);
              return (
                <div
                  key={k}
                  onClick={() => !inSet && setSel((s) => (s.has(k) ? (s.delete(k), new Set(s)) : new Set(s).add(k)))}
                  className={cn("flex items-center gap-3 rounded-ctl px-2 py-1.5", inSet ? "opacity-60" : "hover:bg-white/[.03]")}
                >
                  {inSet ? <Check size={16} className="mx-px text-ok" /> : <Checkbox checked={sel.has(k)} onChange={noop} label={c.entry.title} />}
                  <ProjectIcon src={c.entry.icon_url} size={28} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-text">{c.entry.title}</div>
                    <div className="truncate text-[12px] text-dim">
                      {t(`sets.type.${c.entry.project_type}`)}
                      {!c.enabled && ` · ${t("frominst.disabled")}`}
                      {inSet && ` · ${t("sets.add.in_set")}`}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
      {(q.data?.unknown.length ?? 0) > 0 && (
        <div className="flex items-start gap-2 text-[12px] text-dim">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          {t("frominst.unknown", { n: q.data!.unknown.length })}
        </div>
      )}
      <div className="flex justify-end pt-1">
        <Button
          size="sm"
          variant="primary"
          disabled={!sel.size}
          loading={busy}
          onClick={() => onSubmit(items.filter((c) => sel.has(entryKey(c.entry))).map((c) => c.entry))}
        >
          {submitLabel(sel.size)}
        </Button>
      </div>
    </div>
  );
}

export function InstancePicker({ value, onChange, allowVanilla = true }: { value: string | null; onChange: (id: string) => void; allowVanilla?: boolean }) {
  const t = useT();
  const instances = (useInstances().data ?? []).filter((i) => allowVanilla || i.loader.kind !== "vanilla");
  return (
    <Select<string>
      size="sm"
      value={value}
      onChange={onChange}
      placeholder={t("sets.apply_pick")}
      options={instances.map((i) => ({ value: i.id, label: i.name, hint: `${i.mc_version} · ${formatLoader({ kind: i.loader.kind, version: null })}` }))}
    />
  );
}

function FromInstanceDialog({ instanceId: initial, targetSetId, onClose }: { instanceId: string | null; targetSetId?: string; onClose: () => void }) {
  const t = useT();
  const nav = useNavigate();
  const instances = useInstances().data ?? [];
  const target = useSets().data?.find((s) => s.id === targetSetId);
  const [instanceId, setInstanceId] = useState<string | null>(initial);
  const inst = instances.find((i) => i.id === instanceId);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (inst && !name) setName(inst.name);
  }, [inst]); // eslint-disable-line react-hooks/exhaustive-deps
  const existing = useMemo(() => new Set(target?.entries.map(entryKey) ?? []), [target]);

  const submit = async (entries: SetEntry[]) => {
    setBusy(true);
    try {
      if (target) {
        await addToSet(t, target.id, entries, target.entries.length);
        onClose();
        return;
      }
      const s = await setsApi.create(name.trim() || inst?.name || "Set", entries);
      await invalidateSets();
      toast.success(t("sets.created", { name: s.name }));
      onClose();
      nav({ to: "/modsets", search: { set: s.id } });
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={initial ? t("frominst.title") : t("frominst.title_pick")} description={t("frominst.text")} size="lg">
      <div className="flex flex-col gap-3">
        {!initial && (
          <Field label={t("frominst.instance")}>
            <InstancePicker value={instanceId} onChange={setInstanceId} />
          </Field>
        )}
        {initial && inst && (
          <div className="flex items-center gap-2 text-[13px] text-muted">
            <InstanceBadge instance={inst} size={22} />
            {inst.name} · {inst.mc_version} · {formatLoader({ kind: inst.loader.kind, version: null })}
          </div>
        )}
        {!target && (
          <Field label={t("sets.name")}>
            <Input value={name} maxLength={60} placeholder={t("sets.name_placeholder")} onChange={(e) => setName(e.target.value)} />
          </Field>
        )}
        {instanceId && (
          <InstanceCandidatesList
            key={instanceId}
            instanceId={instanceId}
            existing={target ? existing : undefined}
            busy={busy}
            onSubmit={(e) => void submit(e)}
            submitLabel={(n) => (target ? t("frominst.add_n", { n }) : t("frominst.save_n", { n }))}
          />
        )}
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ Host

/** Globale Mod-Set-Dialoge (in der Shell eingehängt). */
export function ModSetsHost() {
  const s = useSetDialogs();
  const close = (k: "apply" | "fromInstance" | "importOpen" | "createOpen") => useSetDialogs.setState({ [k]: k === "apply" || k === "fromInstance" ? null : false });
  return (
    <>
      {s.apply && <ApplyDialog key={`${s.apply.instanceId}:${s.apply.setIds.join(",")}`} {...s.apply} onClose={() => close("apply")} />}
      {s.fromInstance && <FromInstanceDialog {...s.fromInstance} onClose={() => close("fromInstance")} />}
      {s.importOpen && <ImportSetDialog onClose={() => close("importOpen")} />}
      {s.createOpen && <CreateSetDialog onClose={() => close("createOpen")} />}
    </>
  );
}
