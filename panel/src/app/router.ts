import { useSyncExternalStore } from "react";

function current(): string {
  const h = location.hash.replace(/^#/, "");
  return h.startsWith("/") ? h : `/${h}`;
}

function subscribe(cb: () => void) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}

export function useHashPath(): string {
  return useSyncExternalStore(subscribe, current);
}

export function navigate(path: string, replace = false) {
  const target = `#${path}`;
  if (replace) history.replaceState(null, "", target);
  else location.hash = path;
  if (replace) window.dispatchEvent(new HashChangeEvent("hashchange"));
}

export function segments(path: string): string[] {
  return path.split("?")[0].split("/").filter(Boolean).map(decodeURIComponent);
}
