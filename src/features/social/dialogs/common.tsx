import { Checkbox, Dialog } from "@/components/ui";
import type { Friend } from "@/lib/vibe-sdk";
import { Avatar } from "../FriendsList";
import { GateState } from "../Gate";
import { useSocial } from "../service";

export function NeedLogin({ title, onClose }: { title: string; onClose: () => void }) {
  const conn = useSocial((s) => s.conn);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={title} size="sm">
      <GateState conn={conn} compact />
    </Dialog>
  );
}

export function useReady() {
  return useSocial((s) => s.conn === "ready" || ((s.conn === "reconnecting" || s.conn === "offline") && !!s.me));
}

export function FriendChecklist({ friends, picked, onPick, className, emptyText }: { friends: Friend[]; picked: Set<string>; onPick: (next: Set<string>) => void; className: string; emptyText: string }) {
  return (
    <div className={className}>
      {friends.length === 0 && <p className="p-3 text-[12px] text-dim">{emptyText}</p>}
      {friends.map((f) => (
        <label key={f.user.id} className="flex h-9 cursor-pointer items-center gap-2.5 px-3 transition-colors duration-100 hover:bg-white/[.04]">
          <Checkbox
            checked={picked.has(f.user.id)}
            onChange={(on) => {
              const n = new Set(picked);
              if (on) n.add(f.user.id);
              else n.delete(f.user.id);
              onPick(n);
            }}
          />
          <Avatar user={f.user} size={22} presence={f.presence} />
          <span className="text-[13px] text-text">{f.user.name}</span>
        </label>
      ))}
    </div>
  );
}
