import { ArrowUpCircle, Cpu, Download, ExternalLink, MemoryStick, PackageCheck, Power, PowerOff, RefreshCw, RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import type { useT } from "@/i18n";
import { loaderNames } from "@/lib/format";
import type { FixAction, FixStep, LoaderKind, Unfixable } from "@/lib/types";

// ------------------------------------------------------------------ Texte

export function actionText(a: FixAction, t: ReturnType<typeof useT>, step?: FixStep): string {
  const main = !!step && JSON.stringify(step.action) === JSON.stringify(a);
  switch (a.kind) {
    case "install":
      return t("fix.do.install", { title: a.title });
    case "replace":
      return a.manual ? t("fix.do.replace_manual", { title: a.title, to: a.to_version }) : t("fix.do.replace", { title: a.title, to: a.to_version });
    case "enable":
      return t("fix.do.enable", { name: main ? step!.name : fileLabel(a.file_name) });
    case "disable":
      return t("fix.do.disable", { name: step ? (main ? step.name : (step.alt_name ?? fileLabel(a.file_name))) : fileLabel(a.file_name) });
    case "set_java":
      return t("fix.do.java", { major: a.major });
    case "set_ram":
      return t("fix.do.ram", { gb: Math.round(a.mb / 1024) });
    case "set_loader":
      // Nach oben = „aktualisieren“; nach unten bzw. unbekannte Version = neutral „umstellen“
      return t(step?.reason === "loader_too_old" ? "fix.do.loader_up" : "fix.do.loader_set", { loader: loaderNames[a.loader], to: a.to });
    case "repair_loader":
      return a.version ? t("fix.do.loader_repair", { loader: loaderNames[a.loader], version: a.version }) : t("fix.do.loader_repair_any", { loader: loaderNames[a.loader] });
    case "reset_config":
      return t("fix.do.reset_config", { path: a.path });
  }
}

/** Anzeigename eines Loaders aus der Mod-Metadaten-Kennung („forge“, „fabric“ …). */
export function loaderLabel(l: string | null): string {
  return (l && loaderNames[l as LoaderKind]) || l || "?";
}

export function fileLabel(f: string) {
  return f.replace(/\.disabled$/, "").replace(/\.jar$/, "");
}

export function actionIcon(a: FixAction, size = 15): ReactNode {
  switch (a.kind) {
    case "install":
      return <Download size={size} />;
    case "replace":
      return a.manual ? <ExternalLink size={size} /> : <RefreshCw size={size} />;
    case "enable":
      return <Power size={size} />;
    case "disable":
      return <PowerOff size={size} />;
    case "set_java":
      return <Cpu size={size} />;
    case "set_ram":
      return <MemoryStick size={size} />;
    case "set_loader":
      return <ArrowUpCircle size={size} />;
    case "repair_loader":
      return <PackageCheck size={size} />;
    case "reset_config":
      return <RotateCcw size={size} />;
  }
}

export function stepSub(s: FixStep, t: ReturnType<typeof useT>, instLoader?: LoaderKind, inCause = false): string {
  const inst = instLoader ? loaderNames[instLoader] : "";
  const a = s.action;
  let parts: string[];
  if (s.reason === "wrong_loader" && s.detail) {
    // „Für Forge gebaut – die Instanz nutzt Fabric“ bzw. beim Ersatz „Passende Version für Fabric“
    parts = [a.kind === "install" ? t("fix.reason.wrong_loader_variant", { loader: inst }) : t("fix.reason.wrong_loader_of", { mod: loaderLabel(s.detail), loader: inst })];
  } else {
    parts = [t(`fix.reason.${s.reason}`)];
  }
  if (a.kind === "replace" && a.from_version && !a.manual) parts.push(`${a.from_version} → ${a.to_version}`);
  if (a.kind === "set_java") parts.push(a.path ? t("fix.java.found") : t("fix.java.download"));
  if (a.kind === "set_loader" && a.from) parts.push(`${a.from} → ${a.to}`);
  if (a.kind === "set_loader" && s.detail) parts.push(t("fix.loader.requires", { detail: s.detail }));
  else if (s.required_by.length) parts.push(t("fix.needed_by", { names: s.required_by.slice(0, 3).join(", ") + (s.required_by.length > 3 ? " …" : "") }));
  if ((s.reason === "loader_files_missing" || s.reason === "loader_files_broken") && s.detail)
    parts.push(t(s.detail === "1" ? "fix.loader.files_1" : "fix.loader.files", { n: s.detail }));
  if (a.kind === "repair_loader") parts.push(t("fix.loader.repair_hint"));
  if (a.kind === "reset_config") parts.push(t("fix.config.hint"));
  if (s.reason === "known_pair" && s.detail) parts.push(t("fix.pair.source", { source: s.detail }));
  if (s.from_crash && !inCause) parts.push(t("fix.from_crash"));
  return parts.join(" · ");
}


export function unfixableText(u: Unfixable, t: ReturnType<typeof useT>) {
  return t(`fix.unfixable.${u.reason}`, { name: u.name, detail: u.detail ?? "" });
}
