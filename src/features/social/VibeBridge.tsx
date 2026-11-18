// Verbindet Einstellungen/Account mit dem Vibe-Service (einmal in der Shell eingebunden, rendert nichts).
import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAccounts, useInstances, useServers } from "@/lib/queries";
import { useVibe } from "@/lib/vibe";
import { toast } from "@/components/ui";
import { configure, markRead, setPresenceSources, setSocialHooks, useSocial } from "./service";

export function VibeBridge() {
  const vibe = useVibe();
  const nav = useNavigate();
  const { data: accounts } = useAccounts();
  const active = accounts?.find((a) => a.active)?.id ?? accounts?.[0]?.id ?? "";
  const { data: instances = [] } = useInstances();
  const { data: servers = [] } = useServers();

  // Einstellungen / Account -> Client + Gateway
  useEffect(() => {
    void configure({ enabled: vibe.enabled, social: vibe.social, presence: vibe.presence, sharing: vibe.sharing, hosting: vibe.hosting });
  }, [vibe.enabled, vibe.social, vibe.presence, vibe.sharing, vibe.hosting, vibe.apiUrl, active]);

  useEffect(() => {
    setPresenceSources(instances, servers);
  }, [instances, servers]);

  useEffect(() => {
    setSocialHooks(
      (title, text, action) => toast.info(title, text, action),
      (chatId) => nav({ to: "/social", search: chatId ? { chat: chatId } : {} }),
    );
  }, [nav]);

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
