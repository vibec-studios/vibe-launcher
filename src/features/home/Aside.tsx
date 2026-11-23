import type { Instance } from "@/lib/types";
import { cn } from "@/components/ui";
import { FriendsBlock, UpdatesBlock, VibeNews } from "./Side";
import { fitRows, sideWidth, useHeight, type Tier } from "./layout";
import { ThemeSlot } from "@/features/themes/ThemeSlot";

export function HomeAside({ tier, instances, left }: { tier: Tier; instances: Instance[]; left: number }) {
  const [topRef, top] = useHeight<HTMLDivElement>();
  const col = cn("flex min-w-0 flex-col gap-6 empty:hidden", sideWidth[tier], tier === "s" && "max-[980px]:w-[272px]");
  const wide = tier === "l";
  const limit = fitRows(left, wide ? 0 : top, tier);
  return (
    <aside className={cn("flex items-start gap-6", !wide && "flex-col")}>
      <div ref={topRef} className={col}>
        <ThemeSlot name="home-side" />
        <VibeNews />
        <FriendsBlock />
      </div>
      <div className={col}>
        <UpdatesBlock instances={instances} limit={limit} />
      </div>
    </aside>
  );
}
