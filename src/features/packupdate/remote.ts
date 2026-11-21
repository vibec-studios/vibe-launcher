import type { Instance } from "@/lib/types";
import { isHttpUrl, type RemotePackUpdate } from "./api";
import { openPackPreview } from "./store";

export { useRemotePackUpdate } from "./api";

export function openRemotePreview(instance: Instance, remote: RemotePackUpdate) {
  openPackPreview(instance, isHttpUrl(remote.location) ? { kind: "url", url: remote.location } : { kind: "file", path: remote.location });
}
