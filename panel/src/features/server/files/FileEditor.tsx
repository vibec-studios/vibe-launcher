import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { useAgent } from "@/app/agent";
import { useT } from "@/i18n";
import { Button, Dialog, Notice, Spinner, Textarea, toast } from "@/components/ui";

export function FileEditor({ serverId, path, onClose, readOnly }: { serverId: string; path: string | null; onClose: () => void; readOnly: boolean }) {
  const t = useT();
  const { api, key } = useAgent();
  const file = useQuery({ queryKey: [key, serverId, "file", path ?? ""], queryFn: () => api.fileText(serverId, path!), enabled: !!path, gcTime: 0 });
  const [text, setText] = useState<string | null>(null);
  useEffect(() => setText(null), [path]);
  const save = useMutation({
    mutationFn: () => api.writeFile(serverId, path!, new Blob([text ?? ""], { type: "text/plain" })),
    onSuccess: () => {
      toast.ok(t("files.saved"));
      setText(null);
      file.refetch();
    },
    onError: (e) => toast.error(e),
  });
  const dirty = text != null && text !== file.data;
  return (
    <Dialog
      open={!!path}
      onClose={onClose}
      size="lg"
      title={path?.split("/").pop() ?? ""}
      desc={path ?? undefined}
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            {t("common.close")}
          </Button>
          {!readOnly && (
            <Button variant="primary" icon={<Save size={15} />} disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
              {t("common.save")}
            </Button>
          )}
        </>
      }
    >
      {file.isLoading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : file.error ? (
        <Notice tone="danger">{(file.error as Error).message}</Notice>
      ) : (
        <Textarea
          value={text ?? file.data ?? ""}
          readOnly={readOnly}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "s") {
              e.preventDefault();
              if (dirty) save.mutate();
            }
          }}
          spellCheck={false}
          className="h-[58vh] resize-none font-mono text-[12.5px] whitespace-pre"
        />
      )}
    </Dialog>
  );
}
