import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Download, File, FileText, Folder, FolderPlus, Home, Pencil, Trash2, Upload } from "lucide-react";
import type { FileEntry, ServerView } from "@/api/types";
import { useAgent } from "@/app/agent";
import { ago, bytes } from "@/app/format";
import { useT } from "@/i18n";
import { Button, Card, Dialog, Empty, IconButton, Input, Notice, Progress, Spinner, toast, useConfirm } from "@/components/ui";
import { DropZone } from "@/components/DropZone";
import { downloadBlob } from "@/features/servers/actions";
import { FileEditor } from "./FileEditor";

const TEXT = /\.(txt|properties|ya?ml|json5?|toml|cfg|conf|ini|log|md|mcmeta|snbt|js|sh|bat|cmd|csv|xml|lang|secret)$/i;
const MAX_EDIT = 2 * 1024 * 1024;

function join(dir: string, name: string) {
  return dir ? `${dir}/${name}` : name;
}

function NameDialog({ open, title, initial, onClose, onSubmit, pending }: { open: boolean; title: string; initial: string; onClose: () => void; onSubmit: (v: string) => void; pending: boolean }) {
  const t = useT();
  const [v, setV] = useState(initial);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" loading={pending} disabled={!v.trim() || /[\\/]/.test(v)} onClick={() => onSubmit(v.trim())}>
            {t("common.ok")}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (v.trim()) onSubmit(v.trim());
        }}
      >
        <Input value={v} onChange={(e) => setV(e.target.value)} />
      </form>
    </Dialog>
  );
}

export function FilesTab({ server: s }: { server: ServerView }) {
  const t = useT();
  const { api, key, can } = useAgent();
  const qc = useQueryClient();
  const [dir, setDir] = useState("");
  const [edit, setEdit] = useState<string | null>(null);
  const [naming, setNaming] = useState<{ kind: "mkdir" } | { kind: "rename"; entry: FileEntry } | null>(null);
  const [uploads, setUploads] = useState<{ name: string; progress: number }[]>([]);
  const confirm = useConfirm();
  const write = can("files.write");
  const qkey = [key, s.id, "files", dir];
  const list = useQuery({ queryKey: qkey, queryFn: () => api.files(s.id, dir) });
  const refresh = () => qc.invalidateQueries({ queryKey: [key, s.id, "files"] });
  const mkdir = useMutation({ mutationFn: (name: string) => api.mkdir(s.id, join(dir, name)), onSuccess: () => (setNaming(null), refresh()), onError: (e) => toast.error(e) });
  const rename = useMutation({ mutationFn: (p: { from: string; to: string }) => api.rename(s.id, p.from, p.to), onSuccess: () => (setNaming(null), refresh()), onError: (e) => toast.error(e) });
  const remove = useMutation({ mutationFn: (p: string) => api.deleteFile(s.id, p), onSuccess: () => (refresh(), toast.ok(t("files.deleted"))), onError: (e) => toast.error(e) });

  const upload = async (files: File[]) => {
    for (const f of files) {
      setUploads((u) => [...u, { name: f.name, progress: 0 }]);
      try {
        await api.writeFile(s.id, join(dir, f.name), f, (p) => setUploads((u) => u.map((x) => (x.name === f.name ? { ...x, progress: p } : x))));
        toast.ok(t("files.uploaded", { name: f.name }));
      } catch (e) {
        toast.error(e);
      } finally {
        setUploads((u) => u.filter((x) => x.name !== f.name));
      }
    }
    refresh();
  };
  const download = async (e: FileEntry) => {
    try {
      downloadBlob(await api.fileBlob(s.id, join(dir, e.name)), e.name);
    } catch (err) {
      toast.error(err);
    }
  };
  const open = (e: FileEntry) => {
    if (e.dir) return setDir(join(dir, e.name));
    if (TEXT.test(e.name) && e.size <= MAX_EDIT) return setEdit(join(dir, e.name));
    download(e);
  };
  const crumbs = dir ? dir.split("/") : [];

  return (
    <div className="flex flex-col gap-4">
      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <nav className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-[13.5px]">
            <button onClick={() => setDir("")} className="flex items-center gap-1.5 rounded-ctl px-2 py-1 font-medium hover:bg-white/[.06]">
              <Home size={14} />
              {t("files.root")}
            </button>
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1">
                <ChevronRight size={14} className="text-dim" />
                <button onClick={() => setDir(crumbs.slice(0, i + 1).join("/"))} className="rounded-ctl px-2 py-1 font-medium hover:bg-white/[.06]">
                  {c}
                </button>
              </span>
            ))}
          </nav>
          {write && (
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" icon={<FolderPlus size={14} />} onClick={() => setNaming({ kind: "mkdir" })}>
                {t("files.new_folder")}
              </Button>
              <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-ctl bg-brand px-3 text-[13px] font-semibold text-[var(--ui-on-accent)] hover:brightness-110">
                <Upload size={14} />
                {t("files.upload")}
                <input type="file" multiple hidden onChange={(e) => (upload([...(e.target.files ?? [])]), (e.target.value = ""))} />
              </label>
            </div>
          )}
        </div>
        {list.isLoading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : list.error ? (
          <div className="p-4"><Notice tone="danger">{(list.error as Error).message}</Notice></div>
        ) : list.data?.entries.length === 0 ? (
          <Empty icon={<Folder size={30} />} title={t("files.empty")} />
        ) : (
          <ul>
            {list.data?.entries.map((e) => (
              <li key={e.name} className="group flex items-center gap-3 border-b border-line px-4 py-2 last:border-b-0 hover:bg-white/[.025]">
                <button onClick={() => open(e)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  {e.dir ? <Folder size={18} className="shrink-0 text-accent" /> : TEXT.test(e.name) ? <FileText size={18} className="shrink-0 text-muted" /> : <File size={18} className="shrink-0 text-dim" />}
                  <span className="truncate text-[13.5px] font-medium">{e.name}</span>
                </button>
                <span className="hidden w-24 text-right text-meta text-dim tabular-nums sm:block">{e.dir ? "" : bytes(e.size)}</span>
                <span className="hidden w-32 text-right text-meta text-dim md:block">{ago(e.modified)}</span>
                <div className="flex w-[100px] justify-end gap-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
                  {!e.dir && (
                    <IconButton size="sm" label={t("files.download")} onClick={() => download(e)}>
                      <Download size={14} />
                    </IconButton>
                  )}
                  {write && (
                    <>
                      <IconButton size="sm" label={t("files.rename")} onClick={() => setNaming({ kind: "rename", entry: e })}>
                        <Pencil size={14} />
                      </IconButton>
                      <IconButton
                        size="sm"
                        tone="danger"
                        label={t("common.delete")}
                        onClick={async () => (await confirm.ask({ title: t("files.delete_confirm", { name: e.name }), body: e.dir ? t("files.delete_dir") : undefined, confirm: t("common.delete"), danger: true })) && remove.mutate(join(dir, e.name))}
                      >
                        <Trash2 size={14} />
                      </IconButton>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {uploads.map((u) => (
        <div key={u.name} className="flex items-center gap-3 rounded-card bg-surface p-3 text-meta">
          <span className="w-48 truncate">{u.name}</span>
          <Progress value={u.progress} className="flex-1" />
        </div>
      ))}
      {write && (
        <DropZone multiple onFiles={upload} compact>
          {t("files.drop", { dir: dir || t("files.root") })}
        </DropZone>
      )}
      <p className="text-meta text-dim">{t("files.hint")}</p>
      <FileEditor serverId={s.id} path={edit} onClose={() => setEdit(null)} readOnly={!write} />
      {naming && (
        <NameDialog
          open
          title={naming.kind === "mkdir" ? t("files.new_folder") : t("files.rename")}
          initial={naming.kind === "rename" ? naming.entry.name : ""}
          pending={mkdir.isPending || rename.isPending}
          onClose={() => setNaming(null)}
          onSubmit={(v) => (naming.kind === "mkdir" ? mkdir.mutate(v) : rename.mutate({ from: join(dir, naming.entry.name), to: join(dir, v) }))}
        />
      )}
      {confirm.node}
    </div>
  );
}
