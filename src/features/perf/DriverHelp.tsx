import { ExternalLink, MonitorCog } from "lucide-react";
import { Button } from "@/components/ui";
import { openExternal } from "@/components/content/util";
import { useT } from "@/i18n";
import { useSystemInfo } from "@/lib/queries";
import { openGpuSettings } from "./PerfControls";

const DRIVERS = [
  { key: "nvidia", url: "https://www.nvidia.com/Download/index.aspx" },
  { key: "amd", url: "https://www.amd.com/support/download/drivers.html" },
  { key: "intel", url: "https://www.intel.com/content/www/us/en/support/detect.html" },
] as const;

export function DriverHelp() {
  const t = useT();
  const { data: sys } = useSystemInfo();
  return (
    <>
      {sys?.os === "windows" && (
        <Button size="sm" variant="accent" icon={<MonitorCog size={13} />} onClick={() => void openGpuSettings()}>
          {t("perf.drivers.gpu_settings")}
        </Button>
      )}
      {DRIVERS.map((d) => (
        <Button key={d.key} size="sm" variant="ghost" icon={<ExternalLink size={13} />} onClick={() => void openExternal(d.url)}>
          {t(`perf.drivers.${d.key}`)}
        </Button>
      ))}
    </>
  );
}
