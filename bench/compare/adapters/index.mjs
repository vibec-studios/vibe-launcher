import { vibe } from "./vibe.mjs";
import { prism } from "./prism.mjs";
import { atlauncher } from "./atlauncher.mjs";

export const adapters = { vibe, prism, atlauncher };
export const defaultLaunchers = ["vibe", "prism"];

export const manual = [
  {
    name: "Modrinth App",
    reason: "Speichert Konfiguration und Daten fest unter %APPDATA%\\ModrinthApp (Tauri, Known-Folder-API). Ein getrennter Datenordner ist ohne Eingriff in die echte Installation nicht möglich.",
    how: "Nur auf einem Rechner/Windows-Konto ohne echte Modrinth-App messen, z. B. in einer Windows-Sandbox oder VM. Kaltstart/RAM dann mit `node bench/compare/run.mjs --phase attach --name \"Modrinth App\" --exe <Pfad>` erfassen.",
  },
  {
    name: "CurseForge App",
    reason: "Installiert sich systemweit (Overwolf/Electron) und teilt Daten mit der echten Installation.",
    how: "Nur in einer Windows-Sandbox oder VM messen. Kaltstart/RAM per `--phase attach`.",
  },
  {
    name: "GDLauncher",
    reason: "Der Datenordner wird beim ersten Start abgefragt, die App-Konfiguration liegt aber immer unter %APPDATA%\\gdlauncher_carbon.",
    how: "Wie Modrinth App: in einer Sandbox oder VM, Kaltstart/RAM per `--phase attach`.",
  },
  {
    name: "X Minecraft Launcher (XMCL)",
    reason: "Das ZIP läuft portabel, die Einstellungen liegen aber in %APPDATA%\\xmcl. Ohne eigene Installation von XMCL ist es trotzdem sicher, nur noch nicht automatisiert.",
    how: "Per `--phase attach` mit der entpackten EXE messen (Start und RAM). Für die Instanzen-Messung fehlt noch ein Adapter.",
  },
];
