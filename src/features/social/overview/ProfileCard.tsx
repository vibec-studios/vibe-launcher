import { Pencil } from "lucide-react";
import { useState } from "react";
import { Select, cn, toast } from "@/components/ui";
import { useT } from "@/i18n";
import type { PresenceStatusSetting } from "@/lib/vibe-sdk";
import { Avatar, skinUrlOf } from "../FriendsList";
import { renderBody, useRender } from "../skinRender";
import { errText, requireClient, useSocial } from "../service";

// ------------------------------------------------------------------ Seitenspalte: Du + Hosting

export function ProfileCard() {
  const t = useT();
  const me = useSocial((s) => s.me);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const skin = skinUrlOf(me);
  const slim = me?.skin.model === "slim";
  const body = useRender(skin ? `${skin}|${slim}` : null, () => renderBody(skin!, slim)).url;
  if (!me) return null;
  const setStatus = async (s: PresenceStatusSetting) => {
    useSocial.setState({ me: { ...me, presenceStatus: s } });
    try {
      await requireClient().presence.set({ status: s });
    } catch (e) {
      toast.error(errText(e));
    }
  };
  const saveText = async () => {
    const v = text.trim() || null;
    setEditing(false);
    if (v === me.statusText) return;
    useSocial.setState({ me: { ...me, statusText: v } });
    try {
      await requireClient().me.update({ statusText: v });
    } catch (e) {
      toast.error(errText(e));
    }
  };
  const dot = { online: "bg-ok", away: "bg-warn", busy: "bg-danger", invisible: "bg-[#4a4a52]" }[me.presenceStatus] ?? "bg-ok";
  return (
    <section className="overflow-hidden rounded-card bg-surface">
      <div className="flex items-end gap-4 px-4 pt-4">
        <div className="grid h-[120px] w-[60px] shrink-0 place-items-end">
          {body ? <img src={body} alt="" draggable={false} className="h-[120px] w-[60px] animate-fade-in [image-rendering:pixelated]" /> : <Avatar user={me} size={48} />}
        </div>
        <div className="min-w-0 flex-1 pb-1">
          <div className="text-[11.5px] font-semibold text-dim">{t("social.profile.you")}</div>
          <div className="truncate text-[17px] font-bold leading-tight tracking-[-0.01em] text-text">{me.name}</div>
          <div className="mt-1 flex items-center gap-1.5 text-[12px] text-muted">
            <span className={cn("h-2 w-2 rounded-dot", dot)} />
            {t(`social.status.${me.presenceStatus}`)}
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-2 p-4">
        {editing ? (
          <input
            autoFocus
            value={text}
            maxLength={80}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => void saveText()}
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveText();
              if (e.key === "Escape") setEditing(false);
            }}
            placeholder={t("social.profile.status_ph")}
            className="h-8 w-full rounded-ctl bg-field px-2.5 text-[13px] text-text outline-none placeholder:text-dim focus:shadow-[inset_0_0_0_1px_var(--line-2)]"
          />
        ) : (
          <button
            onClick={() => {
              setText(me.statusText ?? "");
              setEditing(true);
            }}
            className="group flex min-h-8 w-full items-center gap-2 rounded-ctl bg-white/[.03] px-2.5 py-1.5 text-left text-[12.5px] transition-colors hover:bg-white/[.06]"
          >
            <span className={cn("min-w-0 flex-1 truncate", me.statusText ? "text-text" : "text-dim")}>{me.statusText ? `„${me.statusText}“` : t("social.profile.status_ph")}</span>
            <Pencil size={12} className="shrink-0 text-dim opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        )}
        <Select<PresenceStatusSetting>
          size="sm"
          className="w-full"
          value={me.presenceStatus}
          onChange={setStatus}
          options={(["online", "away", "busy", "invisible"] as const).map((k) => ({ value: k, label: t(`social.status.${k}`) }))}
        />
      </div>
    </section>
  );
}
