import { Info } from "lucide-react";
import { PlatformPicker, type PlatformValue } from "../PlatformPicker";

export function PluginStep({ plat, setPlat }: { plat: PlatformValue; setPlat: (p: PlatformValue) => void }) {
  return (
    <PlatformPicker
      value={plat}
      onChange={setPlat}
      listHeight={292}
      render={({ platform, list, build, hint }) => (
        <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-7 max-[700px]:grid-cols-1">
          {list}
          <div className="flex flex-col gap-5">
            {platform}
            {build}
            <div className="flex items-start gap-2 text-dim">
              <Info size={13} className="mt-0.5 shrink-0" />
              {hint}
            </div>
          </div>
        </div>
      )}
    />
  );
}
