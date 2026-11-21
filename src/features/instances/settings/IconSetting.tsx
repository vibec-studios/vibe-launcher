import { ImageIcon, RotateCcw } from "lucide-react";
import type { Instance, InstancePatch } from "@/lib/types";
import { instanceAccent } from "@/lib/format";
import { Button, IconButton, Tooltip } from "@/components/ui";
import { InstanceIcon } from "@/components/instance/InstanceIcon";
import { IconPopover } from "@/components/instance/blocks/IconPopover";
import { setIcon } from "@/components/instance/actions";
import { useT } from "@/i18n";

export function IconSetting({ instance, d, update }: { instance: Instance; d: Instance; update: (p: InstancePatch) => void }) {
  const t = useT();
  const accent = instanceAccent(d.id, d.accent);
  return (
    <div className="flex items-center gap-3">
      <InstanceIcon icon={d.icon} seed={d.id} accent={accent} size={44} />
      <IconPopover
        value={d.icon}
        seed={d.id}
        accent={accent}
        align="end"
        onChange={(icon) => update({ icon })}
        onImage={() => setIcon(instance)}
        onReset={d.icon ? () => update({ icon: null }) : undefined}
      >
        <Button size="sm" icon={<ImageIcon size={13} />}>
          {t("inst.icon.choose")}
        </Button>
      </IconPopover>
      {d.icon && (
        <Tooltip content={t("inst.icon.reset")}>
          <IconButton label={t("inst.icon.reset")} size="sm" onClick={() => update({ icon: null })}>
            <RotateCcw size={13} />
          </IconButton>
        </Tooltip>
      )}
    </div>
  );
}
