import { useState } from "react";
import { Check, Cloud, ExternalLink, MoreHorizontal, Network, Pencil, RefreshCw, Unplug, X } from "lucide-react";
import { Button, DropdownItem, DropdownMenu, DropdownSeparator, IconButton, Input, Tag, confirm, toast } from "@/components/ui";
import { queryClient, sqk } from "@/lib/queries";
import { useT } from "@/i18n";
import { remoteApi } from "./api";
import { ConnDot, useAgentConn } from "./ConnDot";
import { openAgentPanel } from "./panel";
import { dropAgent, upsertAgent } from "./store";
import type { RemoteAgent } from "./types";

export function AgentRow({ agent: a }: { agent: RemoteAgent }) {
  const t = useT();
  const conn = useAgentConn(a.key);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(a.name);
  const [busy, setBusy] = useState(false);

  const rename = async () => {
    if (!name.trim() || name.trim() === a.name) return setEditing(false);
    setBusy(true);
    try {
      upsertAgent(await remoteApi.rename(a.key, name));
      void queryClient.invalidateQueries({ queryKey: sqk.servers });
      setEditing(false);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: t("rmt.agents.remove.title", { name: a.name }),
      text: t("rmt.agents.remove.text"),
      confirmLabel: t("rmt.agents.remove"),
      danger: true,
    });
    if (!ok) return;
    try {
      await remoteApi.remove(a.key);
      dropAgent(a.key);
      void queryClient.invalidateQueries({ queryKey: sqk.servers });
      toast.success(t("rmt.agents.removed"), a.name);
    } catch (e) {
      toast.error(e);
    }
  };

  const refresh = async () => {
    try {
      const info = await remoteApi.info(a.key);
      upsertAgent({ ...a, version: info.version ?? a.version, os: info.os ?? a.os, arch: info.arch ?? a.arch });
    } catch (e) {
      toast.error(e);
    }
  };

  const reconnect = async () => {
    await remoteApi.wsDisconnect(a.key).catch(() => {});
    await remoteApi.wsConnect(a.key).catch((e) => toast.error(e));
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") void rename();
    if (e.key === "Escape") setEditing(false);
  };

  const meta = [
    a.via === "direct" ? a.address : null,
    a.version ? t("rmt.agents.version", { v: a.version }) : null,
    [a.os, a.arch].filter(Boolean).join(" ") || null,
    a.role ? t("rmt.agents.role", { role: a.role }) : null,
  ].filter(Boolean);

  return (
    <div className="flex items-center gap-3 rounded-card bg-surface px-3.5 py-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-ctl bg-surface2 text-accent">{a.via === "vibe" ? <Cloud size={17} /> : <Network size={17} />}</span>
      <div className="min-w-0 flex-1">
        {editing ? (
          <div className="flex items-center gap-1.5">
            <Input autoFocus value={name} maxLength={60} aria-label={t("rmt.agents.rename.label")} className="h-8" onChange={(e) => setName(e.target.value)} onKeyDown={onKey} />
            <IconButton label={t("common.save")} variant="ghost" size="sm" disabled={busy} onClick={() => void rename()}>
              <Check size={15} />
            </IconButton>
            <IconButton
              label={t("common.cancel")}
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditing(false);
                setName(a.name);
              }}
            >
              <X size={15} />
            </IconButton>
          </div>
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[14px] font-semibold text-text">{a.name}</span>
            <Tag>{a.via === "vibe" ? t("rmt.agents.via.vibe") : t("rmt.agents.via.direct")}</Tag>
            <ConnDot agent={a.key} withLabel />
          </div>
        )}
        <div className="mt-0.5 truncate text-meta text-muted">{meta.join(" · ")}</div>
        {conn?.error && conn.state !== "online" && <div className="mt-0.5 truncate text-[12px] text-danger">{conn.error}</div>}
      </div>
      <Button size="sm" variant="ghost" icon={<ExternalLink size={14} />} onClick={() => void openAgentPanel(a)}>
        {t("rmt.panel")}
      </Button>
      <DropdownMenu
        trigger={
          <IconButton label={t("common.more")} tip variant="ghost" size="sm">
            <MoreHorizontal size={16} />
          </IconButton>
        }
      >
        <DropdownItem icon={<Pencil size={14} />} onSelect={() => setEditing(true)}>
          {t("rmt.agents.rename")}
        </DropdownItem>
        <DropdownItem icon={<RefreshCw size={14} />} onSelect={() => void refresh()}>
          {t("rmt.agents.refresh")}
        </DropdownItem>
        <DropdownItem icon={<RefreshCw size={14} />} onSelect={() => void reconnect()}>
          {t("rmt.agents.reconnect")}
        </DropdownItem>
        <DropdownSeparator />
        <DropdownItem icon={<Unplug size={14} />} danger onSelect={() => void remove()}>
          {t("rmt.agents.remove")}
        </DropdownItem>
      </DropdownMenu>
    </div>
  );
}
