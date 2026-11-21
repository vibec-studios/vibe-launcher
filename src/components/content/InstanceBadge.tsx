import { memo } from "react";
import { InstanceIcon } from "@/components/instance/InstanceIcon";
import { instanceAccent } from "@/lib/format";
import type { Instance } from "@/lib/types";

/** Kleines Instanz-Symbol (gleiches Icon wie in Leiste/Bibliothek). */
export const InstanceBadge = memo(function InstanceBadge({ instance, size = 32 }: { instance: Pick<Instance, "id" | "name" | "icon" | "accent">; size?: number }) {
  return <InstanceIcon icon={instance.icon} seed={instance.id} accent={instanceAccent(instance.id, instance.accent)} size={size} />;
});
