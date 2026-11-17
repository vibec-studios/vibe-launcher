import * as TT from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

/** Tooltip im Minecraft-Stil. `TooltipProvider` sitzt in main.tsx. */
export function Tooltip({
  content,
  children,
  side = "top",
  delay,
}: {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  delay?: number;
}) {
  if (content === null || content === undefined || content === "") return <>{children}</>;
  return (
    <TT.Root delayDuration={delay}>
      <TT.Trigger asChild>{children}</TT.Trigger>
      <TT.Portal>
        <TT.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className="mc-tooltip z-[70] max-w-[340px] px-2.5 py-1.5 text-[13px] leading-snug data-[state=delayed-open]:animate-fade-in"
        >
          {content}
        </TT.Content>
      </TT.Portal>
    </TT.Root>
  );
}

export const TooltipProvider = TT.Provider;
