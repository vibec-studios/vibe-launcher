import { invoke } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";

export interface PortableStatus {
  active: boolean;
  root: string;
  exe_dir: string | null;
  marker: string;
  data_dir: string;
  forget_on_exit: boolean;
  releases_url: string;
}

export interface PortableCopyResult {
  exe: string;
  dir: string;
  updated: boolean;
}

export const portableKey = ["portable-status"] as const;

export const portableApi = {
  status: () => invoke<PortableStatus>("portable_status"),
  setForget: (on: boolean) => invoke<PortableStatus>("portable_set_forget", { on }),
  forgetHere: () => invoke<number>("portable_forget_here"),
  createCopy: (target: string) => invoke<PortableCopyResult>("portable_create_copy", { target }),
};

export function usePortable() {
  return useQuery({ queryKey: portableKey, queryFn: portableApi.status, staleTime: Infinity });
}
