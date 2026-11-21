import { useMemo } from "react";
import { Field, Select } from "@/components/ui";
import { useT } from "@/i18n";
import { activeAgents } from "./active";
import { useRemote } from "./store";

export function useHasAgents() {
  return useRemote((s) => s.agents.length > 0);
}

export function TargetField({ value, onChange, localOnly }: { value: string; onChange: (v: string) => void; localOnly?: boolean }) {
  const t = useT();
  const all = useRemote((s) => s.agents);
  const agents = useMemo(() => activeAgents(all), [all]);
  const conn = useRemote((s) => s.conn);
  if (!agents.length) return null;
  return (
    <Field label={t("rmt.new.target")} hint={localOnly ? t("rmt.new.remote_hint") : undefined}>
      <Select
        value={localOnly ? "local" : value}
        onChange={onChange}
        disabled={localOnly}
        options={[
          { value: "local", label: t("rmt.new.local") },
          ...agents.map((a) => ({
            value: a.key,
            label: a.name,
            hint: conn[a.key]?.state === "online" ? t("rmt.conn.online") : t("rmt.conn.offline"),
          })),
        ]}
      />
    </Field>
  );
}
