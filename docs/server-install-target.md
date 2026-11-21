# Server als Installationsziel & Modpack → Server

## Warum ging das vorher nicht über „Entdecken“?
Die Entdecken-Seite kannte nur Instanzen als Ziel (`?instance=`). Die Server-Suche (Modrinth-Projekttyp `plugin`/`mod` mit
`server_side`-Filter, Hangar, Abhängigkeiten, Updates) lebte getrennt im Plugins-/Mods-Tab des Servers (`server::plugins`).
Jetzt ist ein Server ein gleichwertiges Ziel; der Tab verweist auf Entdecken.

## Entdecken mit Server-Ziel
- URL: `#/discover?server=<key>` mit `key = local:<serverId>` bzw. `remote:<agentId>:<serverId>`.
- Seitenleiste „Installieren auf“: Spiel ↔ Server (`TargetPicker`). Simple Mode: ausgeblendet (Server sind Expertenfunktion).
- Server-Modus (`features/discover/server/`): Quelle Modrinth oder Hangar (nur Paper/Purpur), Sortierung, „Passend für“
  (MC-Version, Software, „läuft auf dem Server“). Treffer kommen vorgefiltert vom Backend (`server_addon_search`).
- Installieren inkl. Pflicht-Abhängigkeiten (`server_addon_install`), Updates einzeln/alle, Hinweis bei laufendem Server.
- Projekt-Overlay (`?p=modrinth:<id>` bzw. `?p=hangar:<owner/slug>`) mit Knopf „Auf „Server“ installieren“ und
  Kompatibilitätsprüfung `server_addon_check` (Gründe: `vanilla`, `hangar`, `client_only`, `not_plugin`, `loader`,
  `version`, `external`). Client-only-Mods lassen sich nach Rückfrage trotzdem installieren.
- „Installieren“-Menü auf Projektseiten und der `modrinth://`-Link-Dialog listen zusätzlich passende Server.

## Schnittstelle für Remote-Server (R3)
`src/features/installtarget/`:
- `InstallTarget = { kind: "instance", id } | { kind: "server", origin: "local" | "remote", id, agentId? }`
- `ServerTargetProvider` (Liste, Addons, Suche, Installieren, Prüfen, Updates, Hangar-Projekt, optional `uploadPack`).
- Lokal ist registriert (`local.ts`). Remote: `registerServerTargetProvider({ origin: "remote", … })` – danach erscheinen
  Remote-Server automatisch in Entdecken, Installieren-Menü, Link-Dialog und Modpack-Assistent.
- Abbildung auf die Agent-API (`docs/remote/agent-api.md`): `addons` → `GET /servers/:id/addons`, `search` →
  `GET /servers/:id/addons/search`, `install` → `POST /servers/:id/addons`, `updates`/`update` → `/addons/updates`,
  `/addons/update`, `hangarProject` → `GET /addons/hangar/:project`. `check` hat (noch) keinen Agent-Endpunkt –
  der Remote-Provider kann `{ ok: true, … }` liefern; der Agent prüft beim Installieren selbst.
- `uploadPack(agentId, bundlePath, { name, serverId, format: "mrpack" })` → `POST /servers/import?format=mrpack&name=&server=`
  mit der Datei als Rohdaten-Stream (§6.9), Rückgabe `{ server_id, task_id }`.

## Modpack → Server
Assistent „Modpack auf einen Server bringen“ (Serverliste „Aus Modpack“, ⋯-Menü „Modpack aufspielen …“, Karte im Mods-Tab):
1. Quelle: Instanz oder Datei (`.mrpack`, CurseForge-`.zip`, `.vlpack`, Prism/MultiMC-Export).
2. Ziel: neuer Server (Name, bei gekoppelten Agents auch „Wo“) oder bestehender Server.
3. Prüfen: Mods mit Client/Server-Einordnung (client-only abgewählt), Configs, Welt (nur neue Server aus Instanz),
   Hinweise (Software-Wechsel, laufender Server, manuelle Downloads, weggelassene Client-Dateien).

Backend `src-tauri/src/serverpack/` (bewusst außerhalb von `server/`):
- `read`: Plan aus Instanz (`server::sides` + `content::sides`) oder Datei (`content::import::analyze`, eigener
  mrpack-Leser mit `env.server != unsupported`, Overrides `overrides/` + `server-overrides/`, CurseForge über `resolve_cf`,
  JARs in Overrides werden per Metadaten eingeordnet).
- `run`: Snapshot (`backups/modpack/vor-modpack_<zeit>.zip`: mods, config, defaultconfigs, kubejs, scripts, global_packs,
  `vibe-pack.json`, `vibe-addons.json` + alte Software), Download in Staging, alte Pack-Mods entfernen
  (laut `vibe-pack.json`, sonst ganzer `mods/`-Ordner), Configs übernehmen (ohne `server.properties`, `ops.json` usw.),
  Loader/Version setzen (Paper → Mod-Loader möglich) und Server installieren.
- `snapshot`: Liste, Wiederherstellen (setzt auch Loader/Version/Plattform zurück), Löschen.
- `bundle`: server-gefiltertes `.mrpack` (Downloads mit SHA-1 als Links, lokale Dateien eingebettet in `overrides/`) für den Upload.

Befehle: `server_addon_check`, `server_pack_preview`, `server_pack_apply`, `server_pack_bundle`, `server_pack_status`,
`server_pack_restore`, `server_pack_snapshot_delete`. Mock: `src/dev/mock/servertarget.ts` (plus Paper-Server „Lobby“).
