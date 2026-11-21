import type { Instance, InstancePatch } from "@/lib/types";

export interface TabProps {
  instance: Instance;
  d: Instance;
  update: (p: InstancePatch, delay?: number) => void;
  local: (p: InstancePatch) => void;
  reset: () => void;
}
