import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryClient, sqk } from "@/lib/queries";
import type { Server } from "@/lib/types";
import { Button, ErrorState, Skeleton, Textarea, toast } from "@/components/ui";
import { useT } from "@/i18n";

export function RawEditor({ server, onSaved }: { server: Server; onSaved: () => void }) {
  const t = useT();
  const raw = useQuery({ queryKey: sqk.propertiesRaw(server.id), queryFn: () => api.serverPropertiesRaw(server.id), staleTime: 0, placeholderData: undefined });
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setText(null), [raw.data]);
  const value = text ?? raw.data ?? "";
  const dirty = text !== null && text !== raw.data;

  const save = async () => {
    setBusy(true);
    try {
      await api.serverPropertiesRawSet(server.id, value);
      await Promise.all([raw.refetch(), queryClient.invalidateQueries({ queryKey: sqk.properties(server.id) })]);
      toast.success(t("srv.prop.raw.saved"));
      onSaved();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  if (raw.isError) return <ErrorState error={raw.error} onRetry={() => raw.refetch()} />;
  if (raw.isLoading) return <Skeleton className="m-4 h-[420px]" />;
  return (
    <div className="flex flex-col gap-3 px-4 py-4">
      <Textarea className="h-[440px] font-mono text-[12px] leading-5" value={value} onChange={(e) => setText(e.target.value)} />
      <div className="flex justify-end gap-2">
        <Button variant="subtle" disabled={!dirty || busy} onClick={() => setText(null)}>
          {t("srv.prop.raw.discard")}
        </Button>
        <Button variant="accent" disabled={!dirty} loading={busy} onClick={save}>
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}
