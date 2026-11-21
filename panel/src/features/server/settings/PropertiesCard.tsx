import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import type { ServerView } from "@/api/types";
import { useAgent } from "@/app/agent";
import { useT, type Key } from "@/i18n";
import { Button, Card, Input, Notice, Row, Segmented, Select, Spinner, Switch, Textarea, toast } from "@/components/ui";
import { GROUPS, PROPS, type PropMeta } from "./props";

function Control({ meta, value, onChange, disabled, label }: { meta: PropMeta; value: string; onChange: (v: string) => void; disabled: boolean; label: string }) {
  const t = useT();
  const ty = meta.type;
  if (ty.kind === "bool") return <Switch checked={value === "true"} onChange={(v) => onChange(String(v))} disabled={disabled} label={label} />;
  if (ty.kind === "enum")
    return (
      <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="w-full sm:w-52">
        {ty.options.map((o) => (
          <option key={o} value={o}>
            {t(`prop.${meta.key}.${o}` as Key)}
          </option>
        ))}
      </Select>
    );
  if (ty.kind === "number")
    return <Input aria-label={label} type="number" min={ty.min} max={ty.max} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="w-full sm:w-28" />;
  return <Input aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} placeholder={meta.key === "level-seed" ? t("prop.level-seed.ph") : undefined} className="w-full sm:w-64" />;
}

function RawEditor({ server, onSaved }: { server: ServerView; onSaved: () => void }) {
  const t = useT();
  const { api, key, can } = useAgent();
  const raw = useQuery({ queryKey: [key, server.id, "props-raw"], queryFn: () => api.propertiesRaw(server.id) });
  const [text, setText] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api.setPropertiesRaw(server.id, text ?? ""),
    onSuccess: () => {
      toast.ok(t("props.saved"));
      setText(null);
      onSaved();
    },
    onError: (e) => toast.error(e),
  });
  if (raw.isLoading) return <Spinner />;
  const value = text ?? raw.data ?? "";
  return (
    <div className="flex flex-col gap-3">
      <Textarea value={value} onChange={(e) => setText(e.target.value)} spellCheck={false} rows={18} className="font-mono text-[12.5px]" disabled={!can("servers.manage")} />
      <div className="flex justify-end gap-2">
        <Button variant="subtle" disabled={text == null} onClick={() => setText(null)}>
          {t("common.discard")}
        </Button>
        <Button variant="primary" icon={<Save size={15} />} disabled={text == null} loading={save.isPending} onClick={() => save.mutate()}>
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}

export function PropertiesCard({ server }: { server: ServerView }) {
  const t = useT();
  const { api, key, can } = useAgent();
  const qc = useQueryClient();
  const qkey = [key, server.id, "props"];
  const props = useQuery({ queryKey: qkey, queryFn: () => api.properties(server.id) });
  const base = useMemo(() => Object.fromEntries(props.data ?? []) as Record<string, string>, [props.data]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<"form" | "raw">("form");
  useEffect(() => setDraft({}), [props.data]);
  const changed = Object.keys(draft).filter((k) => draft[k] !== base[k]);
  const manage = can("servers.manage");
  const save = useMutation({
    mutationFn: () => api.setProperties(server.id, Object.fromEntries(changed.map((k) => [k, draft[k]]))),
    onSuccess: (d) => {
      qc.setQueryData(qkey, d);
      toast.ok(t("props.saved"));
    },
    onError: (e) => toast.error(e),
  });
  const running = server.status?.state === "running";
  return (
    <Card
      title={t("props.title")}
      desc={t("props.desc")}
      actions={
        <Segmented
          value={mode}
          onChange={setMode}
          items={[
            { key: "form", label: t("props.form") },
            { key: "raw", label: t("props.raw") },
          ]}
        />
      }
    >
      {running && <div className="mb-3"><Notice tone="info">{t("props.next_start")}</Notice></div>}
      {mode === "raw" ? (
        <RawEditor server={server} onSaved={() => qc.invalidateQueries({ queryKey: qkey })} />
      ) : props.isLoading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : props.error ? (
        <Notice tone="danger">{(props.error as Error).message}</Notice>
      ) : (
        <>
          {GROUPS.map((g) => (
            <div key={g} className="mb-4">
              <h3 className="label mt-2 mb-1">{t(`props.group.${g}`)}</h3>
              {PROPS.filter((p) => p.group === g && p.key in base).map((p) => {
                const value = draft[p.key] ?? base[p.key] ?? "";
                return (
                  <Row key={p.key} title={t(`prop.${p.key}` as Key)} desc={t(`prop.${p.key}.desc` as Key)} warn={p.warn?.(value) ? t(`prop.${p.key}.warn` as Key) : undefined}>
                    <Control meta={p} label={t(`prop.${p.key}` as Key)} value={value} disabled={!manage} onChange={(v) => setDraft((d) => ({ ...d, [p.key]: v }))} />
                  </Row>
                );
              })}
            </div>
          ))}
          {manage && (
            <div className="sticky bottom-0 -mx-5 -mb-5 flex items-center justify-end gap-2 rounded-b-card border-t border-line bg-surface px-5 py-3">
              {changed.length > 0 && <span className="mr-auto text-meta text-muted">{t("props.changed", { n: changed.length })}</span>}
              <Button variant="subtle" disabled={!changed.length} onClick={() => setDraft({})}>
                {t("common.discard")}
              </Button>
              <Button variant="primary" icon={<Save size={15} />} disabled={!changed.length} loading={save.isPending} onClick={() => save.mutate()}>
                {t("common.save")}
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
