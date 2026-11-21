import { BookOpen, Bug, Code2, Globe, MessageCircle } from "lucide-react";
import type { ReactNode } from "react";
import type { useT } from "@/i18n";
import type { ViewProject, ViewSource } from "./types";

export function viewSourceName(s: ViewSource): string {
  if (s === "modrinth") return "Modrinth";
  if (s === "curseforge") return "CurseForge";
  if (s === "hangar") return "Hangar";
  return s.replace(/^store:/, "");
}

export function linkList(p: ViewProject, t: ReturnType<typeof useT>) {
  const l = p.links;
  return [
    l.website && { key: "website", href: l.website, icon: <Globe size={15} />, label: t("project.link.website") },
    l.source && { key: "source", href: l.source, icon: <Code2 size={15} />, label: t("project.link.source") },
    l.issues && { key: "issues", href: l.issues, icon: <Bug size={15} />, label: t("project.link.issues") },
    l.wiki && { key: "wiki", href: l.wiki, icon: <BookOpen size={15} />, label: t("project.link.wiki") },
    l.discord && { key: "discord", href: l.discord, icon: <MessageCircle size={15} />, label: "Discord" },
  ].filter(Boolean) as { key: string; href: string; icon: ReactNode; label: string }[];
}
