import { Component, useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/components/ui";
import type { MNode } from "@/lib/themes/markup/sanitize";
import type { SlotName } from "@/lib/themes/rules";
import { buildSlot, type PlaceholderRefs } from "./dom";
import { usePlaceholderValues } from "./placeholders";
import { useThemeRuntime } from "./store";
import { reportThemeError } from "./emergency";

const BOX: Record<SlotName, string> = {
  background: "absolute inset-0",
  "corner-tl": "absolute left-0 top-0 flex h-[200px] w-[200px] items-start justify-start",
  "corner-tr": "absolute right-0 top-0 flex h-[200px] w-[200px] items-start justify-end",
  "corner-bl": "absolute bottom-0 left-0 flex h-[200px] w-[200px] items-end justify-start",
  "corner-br": "absolute bottom-0 right-0 flex h-[200px] w-[200px] items-end justify-end",
  "home-hero": "relative w-full max-h-[360px] shrink-0",
  "home-side": "relative w-full max-h-[320px] shrink-0",
  "sidebar-top": "relative w-full max-h-[160px] shrink-0",
};
const MAIN_LAYER: SlotName[] = ["background", "corner-tl", "corner-tr", "corner-bl", "corner-br"];

class Boundary extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function SlotView({ name, nodes, placeholders, className }: { name: SlotName; nodes: MNode[]; placeholders: readonly string[]; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const refs = useRef<PlaceholderRefs>([]);
  const values = usePlaceholderValues(placeholders);
  useEffect(() => {
    if (ref.current) refs.current = buildSlot(ref.current, nodes);
  }, [nodes]);
  useEffect(() => {
    for (const [text, key] of refs.current) {
      const v = values[key] ?? "";
      if (text.data !== v) text.data = v;
    }
  }, [values, nodes]);
  return (
    <div data-vt-lock="" aria-hidden className={cn("pointer-events-none select-none overflow-hidden [contain:paint]", BOX[name], className)}>
      <div ref={ref} data-part="slot" data-slot={name} className={name === "background" ? "h-full w-full" : "w-full"} />
    </div>
  );
}

export function ThemeSlot({ name, className }: { name: SlotName; className?: string }) {
  const nodes = useThemeRuntime((s) => (s.paused ? undefined : s.compiled?.slots[name]));
  const placeholders = useThemeRuntime((s) => s.compiled?.placeholders);
  if (!nodes || !placeholders) return null;
  return (
    <Boundary onError={() => reportThemeError()}>
      <SlotView name={name} nodes={nodes} placeholders={placeholders} className={className} />
    </Boundary>
  );
}

export function ThemeMainLayer() {
  const names = useThemeRuntime((s) => (s.paused || !s.compiled ? "" : MAIN_LAYER.filter((n) => s.compiled?.slots[n]).join(" ")));
  if (!names) return null;
  return (
    <div data-vt-lock="" aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {(names.split(" ") as SlotName[]).map((n) => (
        <ThemeSlot key={n} name={n} />
      ))}
    </div>
  );
}
