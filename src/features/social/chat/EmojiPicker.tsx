import * as Popover from "@radix-ui/react-popover";
import { Smile } from "lucide-react";
import { useState } from "react";
import { Tooltip, cn } from "@/components/ui";
import { useT } from "@/i18n";

const EMOJIS = ["😀", "😄", "😂", "🙂", "😉", "😍", "🤩", "😎", "🤔", "😅", "😴", "😭", "😡", "🥳", "🙌", "👍", "👎", "👋", "🙏", "💪", "❤️", "🔥", "✨", "🎉", "💎", "⛏️", "🗡️", "🏹", "🛡️", "🧱", "🌲", "🏝️", "🏰", "🐷", "🐑", "🐺", "🧟", "💀", "🍕", "🍪", "☕", "🎮", "🏆", "⭐", "✅", "❌", "👀", "💤"];

export function EmojiPicker({ onPick }: { onPick: (e: string) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Tooltip content={t("social.chat.emoji")} side="top">
        <Popover.Trigger asChild>
          <button
            aria-label={t("social.chat.emoji")}
            className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-ctl text-dim transition-colors hover:bg-white/[.06] hover:text-text", open && "bg-white/[.06] text-text")}
          >
            <Smile size={17} />
          </button>
        </Popover.Trigger>
      </Tooltip>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="end"
          sideOffset={8}
          collisionPadding={12}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="z-[60] w-[292px] rounded-card bg-overlay p-2 shadow-e2 outline-none data-[state=open]:animate-pop-in"
        >
          <div className="grid grid-cols-8 gap-0.5">
            {EMOJIS.map((e) => (
              <button
                key={e}
                onClick={() => onPick(e)}
                className="grid h-8 w-8 place-items-center rounded-ctl text-[19px] transition-[background-color,transform] duration-100 hover:scale-110 hover:bg-white/[.07]"
              >
                {e}
              </button>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
