// Verbindet Einstellungen/Account mit dem Vibe-Service (einmal in der Shell eingebunden, rendert nichts).
import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAccounts, useServers, useJavaInstances } from "@/lib/queries";
import { useVibe } from "@/lib/vibe";
import { toast } from "@/components/ui";
import { openSettings } from "@/features/settings/store";
import { t } from "@/i18n";
import { startAccessPolling } from "@/features/access/poll";
import { setWelcomeHook } from "@/features/access/store";
import { configure, markRead, openSocial, setPresenceSources, setSocialHooks, useSocial } from "./service";

const HINT_KEY = "vibe.auto_hint_shown";

export function VibeBridge() {
  const vibe = useVibe();
  const nav = useNavigate();
  const { data: accounts } = useAccounts();
  const active = accounts?.find((a) => a.active)?.id ?? accounts?.[0]?.id ?? "";
  const { data: instances = [] } = useJavaInstances();
  const { data: servers = [] } = useServers();

  // Einstellungen / Account -> Client + Gateway
  useEffect(() => {
    void configure({ enabled: vibe.enabled, social: vibe.social, presence: vibe.presence, sharing: vibe.sharing, hosting: vibe.hosting });
  }, [vibe.enabled, vibe.social, vibe.presence, vibe.sharing, vibe.hosting, active]);

  useEffect(() => {
    setWelcomeHook(() => toast.success(t("access.welcome.title"), t("access.welcome.text"), { label: t("social.open_page"), onClick: () => openSocial() }));
    return startAccessPolling();
  }, []);

  useEffect(() => {
    setPresenceSources(instances, servers);
  }, [instances, servers]);

  useEffect(() => {
    setSocialHooks(
      (title, text, action) => toast.info(title, text, action),
      (chatId) => nav({ to: "/social", search: chatId ? { chat: chatId } : {} }),
    );
  }, [nav]);

  // Erstes automatisches Verbinden -> einmal dezent darauf hinweisen (mit Link zu „Vibe & Konto“)
  const autoLinked = useSocial((s) => s.autoLinked);
  useEffect(() => {
    if (!autoLinked) return;
    try {
      if (localStorage.getItem(HINT_KEY)) return;
      localStorage.setItem(HINT_KEY, "1");
    } catch {
      return;
    }
    const name = useSocial.getState().me?.name ?? useSocial.getState().identity ?? "";
    toast.info(t("vibe.hint.title"), t("vibe.hint.text", { name }), { label: t("vibe.hint.action"), onClick: () => openSettings("vibe") }, 12_000);
  }, [autoLinked]);

  // Zurück ins Fenster -> sichtbaren Chat als gelesen markieren
  useEffect(() => {
    const onFocus = () => {
      const { activeChat, chats } = useSocial.getState();
      if (activeChat && chats[activeChat]?.unreadCount) markRead(activeChat);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  return null;
}
