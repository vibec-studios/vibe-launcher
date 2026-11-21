# Vibe Panel (Web-Oberfläche für den Vibe Server Agent)

Quellcode: `panel/` (eigenes Vite + React + Tailwind-Projekt, unabhängig vom Launcher-Frontend).
Build-Ausgabe: `agent/panel-dist/` (wird vom Agent ins Binary eingebettet und vom Backend unter `/panel/` ausgeliefert, nicht eingecheckt).

## Befehle (im Ordner `panel/`)

| Befehl | Zweck |
|---|---|
| `pnpm install` | Abhängigkeiten (eigene `pnpm-lock.yaml`, kein Workspace mit dem Launcher) |
| `pnpm build` | Typprüfung + Produktions-Build nach `../agent/panel-dist` (ohne Mock) |
| `pnpm dev:mock` | Entwicklungsserver mit Mock-Agent und Mock-Vibe-Konto auf Port 5190 |
| `pnpm dev` | Entwicklungsserver gegen einen echten Agent: `VIBE_AGENT_URL=https://192.168.1.20:25580 pnpm dev` (Proxy für `/api`) |
| `pnpm build:mock` | Demo-Build mit Mock nach `panel/dist-mock` (z. B. für Screenshots) |

Reihenfolge für Releases: zuerst `pnpm --dir panel install && pnpm --dir panel build`, danach den Agent bauen.

## Betriebsarten

Die Transport-Schicht (`panel/src/api/`) kapselt beide Wege, die Oberfläche merkt keinen Unterschied:

- **Lokal (`local`)**: Der Agent liefert das Panel unter `/` aus. Die Anmeldung läuft über einen Kopplungscode (`POST /api/v1/pair`, Klartext-Variante) und liefert ein Agent-Token (`va_…`, im `localStorage`). REST unter `/api/v1`, WebSocket `/api/v1/ws` mit `{"t":"auth"}`.
- **Über Vibe (`gateway`)**: Das Panel läuft unter `vibe.axolite.app/panel/`. Die Startseite hat den Knopf „Mit Microsoft/Minecraft anmelden“, der auf `/auth/login?return=/panel/` führt (Web-Login, R7). Danach holt das Panel mit `POST /api/v1/auth/web/token` (Cookie `vibe_web` + `X-CSRF-Token` aus `vibe_csrf`) ein Access-Token. Alternativ gibt es die Geräte-Kopplung mit einem Code, den man im Launcher bestätigt (`/auth/device/*`). Danach kommen die Agents des Kontos (`GET /api/v1/agents`). Agent-Aufrufe laufen über `/api/v1/agents/{id}/proxy/…`, Live-Daten über `/api/v1/agents/{id}/ws?token=…`. Uploads über 8 MiB gehen automatisch in Blöcken (`/agents/{id}/uploads`). Bei `401` nach bestehender Sitzung leitet das Panel zum Login weiter, bei `403 ACCESS_*` zeigt es die Warteliste.

Erkennung: Pfad beginnt mit `/panel` → `gateway`, sonst `local`. Überschreiben lässt sich das mit `?mode=local|gateway` oder `VITE_PANEL_MODE`. Andere Hosts: `VITE_AGENT_URL`, `VITE_VIBE_URL`.

## Funktionen

Server-Liste mit Start/Stopp und Join-Adresse · Erstellen-Assistent (Art → Version → Name/RAM → fertig, mit Empfehlungen) · EULA-Bestätigung · Live-Konsole mit Befehlsverlauf und Schnellbefehlen · Spieler online, Whitelist, OPs, Banns · Server-Einstellungen und `server.properties` mit Erklärungen (Formular oder Text) · Dateimanager (Upload per Drag & Drop, Download, Textdateien bearbeiten, Ordner, Umbenennen, Löschen) · Backups (erstellen, wiederherstellen, herunterladen) · Plugins/Mods suchen (Modrinth + Hangar) mit Kompatibilitätsanzeige, installieren, aktivieren/deaktivieren, `.jar` hochladen · Modpack hochladen (`.mrpack`/`.zip`/`.vlpack`, neuer Server oder Update) · Verbindung (Vibe-Tunnel/playit/direkt, Status, UDP für Sprachchat/Bedrock, LAN-/öffentliche Adressen) · Ressourcen (CPU/RAM/Platte live, pro Server) · Agent-Einstellungen (Name, Update, Fernzugriff über Vibe verbinden/trennen, Benutzer und Rollen, Einladungscodes, neuer Kopplungscode, Protokoll) · hell/dunkel · Deutsch/Englisch.

## Mock

`panel/src/api/mock/` bildet die Verträge `agent-api.md` (R1) und `agent-gateway.md` (R5) nach, inklusive WebSocket-Ereignissen, Aufgaben-Fortschritt, Kompatibilitätsprüfung und drei Agents („Zu Hause“, „Hetzner-VPS“, offline „Mias Laptop“). Unbekannte Pfade antworten mit 404, so fallen Abweichungen vom Vertrag auf. Der Mock ist nur im Modus `mock` aktiv und landet nicht im Produktions-Build.

Demo-Sonderfälle: Kopplungscode `AAAA-AAAA` wird abgelehnt. `?mode=gateway&mock_access=pending` zeigt die Wartelisten-Ansicht.
