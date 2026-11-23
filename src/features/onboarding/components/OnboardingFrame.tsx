import * as D from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { ThemeProtect } from "@/components/ui";

export function OnboardingFrame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <D.Root open>
      <D.Content
        data-vt-protected=""
        className="fixed inset-0 z-40 flex flex-col bg-bg focus:outline-none"
        aria-describedby={undefined}
        aria-modal="true"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus();
        }}
      >
        <D.Title className="sr-only">{label}</D.Title>
        <ThemeProtect>{children}</ThemeProtect>
      </D.Content>
    </D.Root>
  );
}
