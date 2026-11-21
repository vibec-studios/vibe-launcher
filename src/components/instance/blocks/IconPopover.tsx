import type { ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import { IconGallery } from "./IconGallery";

export function IconPopover({
  value,
  seed,
  accent,
  onChange,
  onImage,
  onReset,
  align = "start",
  children,
}: {
  value: string | null;
  seed?: string;
  accent: string;
  onChange: (icon: string) => void;
  onImage?: () => void;
  onReset?: () => void;
  align?: "start" | "end";
  children: ReactNode;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align={align}
          sideOffset={8}
          collisionPadding={12}
          className="z-[60] w-[316px] rounded-card bg-overlay p-3 shadow-e2 outline-none data-[state=open]:animate-[pop-in_.12s_var(--ease-snap)]"
        >
          <IconGallery value={value} seed={seed} accent={accent} onChange={onChange} onImage={onImage} onReset={onReset} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
