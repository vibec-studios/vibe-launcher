import type { LogLevel, LogLine } from "@/lib/types";

export type LevelCat = "debug" | "info" | "warn" | "error" | "launcher";
export const CATS: LevelCat[] = ["info", "warn", "error", "debug", "launcher"];

export function catOf(l: LogLevel): LevelCat {
  switch (l) {
    case "trace":
    case "debug":
      return "debug";
    case "warn":
      return "warn";
    case "error":
    case "fatal":
    case "stderr":
      return "error";
    case "launcher":
      return "launcher";
    default:
      return "info";
  }
}

const LEVEL_TAG: Record<LogLevel, string> = {
  trace: "TRACE",
  debug: "DEBUG",
  info: "INFO",
  warn: "WARN",
  error: "ERROR",
  fatal: "FATAL",
  stdout: "OUT",
  stderr: "ERR",
  launcher: "LAUNCH",
};

export function formatLine(l: LogLine): string {
  if (!l.time) return l.text;
  return `[${l.time}] [${l.thread ?? "main"}/${LEVEL_TAG[l.level]}]${l.logger ? ` [${l.logger}]` : ""}: ${l.text}`;
}

export function formatLines(lines: LogLine[]): string {
  let s = "";
  for (let i = 0; i < lines.length; i++) s += (i ? "\n" : "") + formatLine(lines[i]);
  return s;
}

export const levelTag = (l: LogLevel) => LEVEL_TAG[l];

