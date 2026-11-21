import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ExternalLink, Package, Puzzle, Trash2, Upload } from "lucide-react";
import type { ServerView } from "@/api/types";
import { useAgent } from "@/app/agent";
import { bytes } from "@/app/format";
import { useT } from "@/i18n";
import { Button, Card, Empty, IconButton, Notice, Segmented, Spinner, Switch, toast, useConfirm } from "@/components/ui";
import { ModpackDialog } from "@/features/servers/ModpackDialog";
import { SOFTWARE_NAMES, softwareOf } from "@/features/servers/meta";
import { AddonSearch } from "./AddonSearch";

export function AddonsTab({ server: s }: { server: ServerView }) {
  const t = useT();
  const { api, key, can } = useAgent();
  const confirm = useConfirm();
  const [view, setView] = useState<"installed" | "discover">("installed");
  const [pack, setPack] = useState(false);
  const vanilla = softwareOf(s) === "vanilla";
  const list = useQuery({ queryKey: [key, s.id, "addons"], queryFn: () => api.addons(s.id), enabled: !vanilla });
  const manage = can("servers.manage");
  const toggle = useMutation({ mutationFn: (p: { file: string; enabled: boolean }) => api.setAddonEnabled(s.id, p.file, p.enabled), onSuccess: () => list.refetch(), onError: (e) => toast.error(e) });
  const remove = useMutation({ mutationFn: (file: string) => api.removeAddon(s.id, file), onSuccess: () => (list.refetch(), toast.ok(t("addons.removed"))), onError: (e) => toast.error(e) });
  const upload = useMutation({ mutationFn: (f: File) => api.uploadAddon(s.id, f), onSuccess: (n) => (list.refetch(), toast.ok(t("files.uploaded", { name: n }))), onError: (e) => toast.error(e) });
  if (vanilla) {
    return (
      <Notice tone="info" title={t("addons.vanilla_title")}>
        {t("addons.vanilla_desc")}
      </Notice>
    );
  }
  if (list.isLoading) return <div className="flex justify-center py-12"><Spinner /></div>;
  if (list.error || !list.data) return <Notice tone="danger">{(list.error as Error | null)?.message}</Notice>;
  const target = list.data.target;
  const plugins = target.plugins;
  const sw = SOFTWARE_NAMES[softwareOf(s)];
  const items = list.data.items;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Segmented
          value={view}
          onChange={setView}
          items={[
            { key: "installed", label: t("addons.installed", { n: items.length }) },
            { key: "discover", label: plugins ? t("addons.discover_plugins") : t("addons.discover_mods") },
          ]}
        />
        <p className="flex-1 text-meta text-muted">{plugins ? t("addons.target_plugins", { sw, mc: s.mc_version }) : t("addons.target_mods", { sw, mc: s.mc_version })}</p>
        {manage && (
          <div className="flex gap-2">
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-ctl bg-surface2 px-4 text-[13.5px] font-semibold hover:bg-surface3">
              <Upload size={15} />
              {t("addons.upload_jar")}
              <input type="file" accept=".jar" hidden onChange={(e) => (e.target.files?.[0] && upload.mutate(e.target.files[0]), (e.target.value = ""))} />
            </label>
            {!plugins && (
              <Button variant="ghost" icon={<Package size={15} />} onClick={() => setPack(true)}>
                {t("addons.pack")}
              </Button>
            )}
          </div>
        )}
      </div>
      {view === "discover" ? (
        <Card>
          <AddonSearch server={s} list={list.data} onChanged={() => list.refetch()} />
        </Card>
      ) : (
        <Card pad={false}>
          {items.length === 0 ? (
            <Empty icon={<Puzzle size={30} />} title={plugins ? t("addons.empty_plugins") : t("addons.empty_mods")} action={<Button variant="primary" onClick={() => setView("discover")}>{plugins ? t("addons.discover_plugins") : t("addons.discover_mods")}</Button>}>
              {t("addons.empty_desc")}
            </Empty>
          ) : (
            <ul>
              {items.map((a) => (
                <li key={a.file_name} className="flex items-center gap-3 border-b border-line px-5 py-3 last:border-b-0">
                  <span className="grid size-10 shrink-0 place-items-center rounded-card bg-surface3 font-display text-[12px] text-muted">{(a.title ?? a.file_name).slice(0, 2)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-semibold">{a.title ?? a.name ?? a.file_name}</span>
                      {a.version && <span className="text-meta text-dim">{a.version}</span>}
                    </div>
                    <div className="truncate text-meta text-dim">
                      {a.file_name} · {bytes(a.size)}
                    </div>
                  </div>
                  {a.page_url && (
                    <a href={a.page_url} target="_blank" rel="noreferrer" className="hidden text-dim hover:text-text sm:block" aria-label={t("addons.page")}>
                      <ExternalLink size={15} />
                    </a>
                  )}
                  <Switch checked={a.enabled} disabled={!manage || toggle.isPending} onChange={(v) => toggle.mutate({ file: a.file_name, enabled: v })} label={t("addons.enabled")} />
                  {manage && (
                    <IconButton label={t("common.remove")} tone="danger" onClick={async () => (await confirm.ask({ title: t("addons.remove_confirm", { name: a.title ?? a.file_name }), confirm: t("common.remove"), danger: true })) && remove.mutate(a.file_name)}>
                      <Trash2 size={16} />
                    </IconButton>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      {s.status?.state === "running" && <p className="text-meta text-dim">{t("addons.restart_hint")}</p>}
      <ModpackDialog open={pack} onClose={() => setPack(false)} serverId={s.id} />
      {confirm.node}
    </div>
  );
}
