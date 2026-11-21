import { t } from "@/i18n";
import { rt } from "./runtime";

// ------------------------------------------------------------------ Navigation / Toasts (von außen gesetzt)

type Notifier = (title: string, text?: string, action?: { label: string; onClick: () => void }) => void;
let notifier: Notifier = () => {};
let opener: (chatId?: string) => void = () => {};
export function setSocialHooks(n: Notifier, o: (chatId?: string) => void) {
  notifier = n;
  opener = o;
}
// Kurz hintereinander eintreffende Benachrichtigungen (z. B. nach dem Verbinden) zu einem Toast bündeln.
let notifyQueue: { title: string; text?: string; action?: { label: string; onClick: () => void } }[] = [];
let notifyTimer: ReturnType<typeof setTimeout> | null = null;
export function notify(title: string, text?: string, action?: { label: string; onClick: () => void }) {
  if (!rt.cfg.social) return;
  notifyQueue.push({ title, text, action });
  if (notifyTimer) return;
  notifyTimer = setTimeout(() => {
    const q = notifyQueue;
    notifyQueue = [];
    notifyTimer = null;
    if (q.length <= 2) {
      for (const n of q) notifier(n.title, n.text, n.action);
    } else {
      const names = [...new Set(q.map((n) => n.title.split(" · ")[0]))].slice(0, 3).join(", ");
      notifier(t("social.toast.many", { count: q.length }), names, { label: t("social.open"), onClick: () => openSocial() });
    }
  }, 1200);
}
export function openSocial(chatId?: string) {
  opener(chatId);
}
