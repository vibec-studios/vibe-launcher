import { refreshAccess, useVibeAccess } from "./store";

const POLL_MS = 5 * 60_000;

function pollMs() {
  if (import.meta.env.VITE_MOCK === "1") {
    try {
      const v = Number(localStorage.getItem("vl.mock.access.poll"));
      if (v > 0) return v;
    } catch {
      return POLL_MS;
    }
  }
  return POLL_MS;
}

export function startAccessPolling(): () => void {
  const every = pollMs();
  const tick = () => {
    const s = useVibeAccess.getState();
    if (s.status !== "waitlist" || document.visibilityState !== "visible") return;
    if (Date.now() - s.checkedAt >= every) void refreshAccess();
  };
  const timer = setInterval(tick, Math.min(60_000, every));
  document.addEventListener("visibilitychange", tick);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", tick);
  };
}
