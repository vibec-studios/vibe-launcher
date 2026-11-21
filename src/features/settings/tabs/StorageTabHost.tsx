import { useSystemInfo } from "@/lib/queries";
import { StorageTab } from "@/features/storage/StorageTab";

export function StorageTabHost() {
  const sys = useSystemInfo();
  return <StorageTab dataDir={sys.data?.data_dir} />;
}
