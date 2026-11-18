# Vibe-Backend – Erweiterungen Runde 2 (Vertrag zwischen Backend, Launcher, Client, Website)

Stand 2026-11-18. Basis: `https://vibe.henny.dev`. Alle Nutzer-Routen mit dem bestehenden Bearer-Token
(Login über Mojang `hasJoined`, wie bisher). Fehlerformat wie bisher (`{ error: { code, message } }`).
Wer etwas ändert, passt diese Datei an und sagt es den anderen.

## 1. Konto

- `DELETE /api/v1/me` – Body `{ "confirm": true }`. Löscht das Vibe-Konto mit allen persönlichen Daten
  (Freundschaften, Anfragen, Blocks, Chat-Mitgliedschaften und eigene Nachrichten, Loadout, Geräte/Sessions,
  geteilte Packs, eingereichte Cosmetics die noch nicht freigegeben sind). Freigegebene Creator-Cosmetics bleiben im
  Katalog, der Creator-Name wird zu „Gelöschter Nutzer“. Schließt alle Gateway-Verbindungen. Freunde bekommen
  `friend.removed`. Antwort `204`. Danach ist ein neuer Login wieder möglich (neues, leeres Konto).
- Abmelden („Verknüpfung lösen“) = bestehender Logout/Session-Widerruf des aktuellen Geräts.

## 2. Vibey Client – Verteilung (öffentlich, CORS `*`, kein Login)

- `GET /api/v1/client/latest?channel=release|beta` (Standard `release`):
  ```json
  {
    "version": "0.2.0", "channel": "release", "publishedAt": "…", "changelog": "Markdown",
    "files": [
      { "loader": "fabric", "mcVersions": ["1.21.1"], "file": "vibeyclient-fabric-1.21.1-0.2.0.jar",
        "size": 123, "sha256": "…", "url": "https://vibe.henny.dev/api/v1/client/files/<sha256>/<file>",
        "requires": [ { "modrinth": "P7dR8mSH", "name": "Fabric API" } ] }
    ],
    "blockbench": { "version": "0.2.0", "file": "vibey.js", "size": 1, "sha256": "…", "url": "…" }
  }
  ```
  `mcVersions` = alle Minecraft-Versionen, die dieses Jar unterstützt (exakte Strings wie in `version_manifest`).
  `requires` = Pflicht-Abhängigkeiten, die ein Launcher mitinstallieren muss (Modrinth-Projekt-ID).
- `GET /api/v1/client/releases` – Liste (neueste zuerst), gleiche Form ohne `changelog`-Kürzung.
- `GET /api/v1/client/files/:sha256/:file` – Datei (mit `ETag`, `Content-Length`, `immutable`-Cache).
- Veröffentlichen (CI des privaten vibey-client-Repos): `POST /internal/client/v1/releases`,
  `Authorization: Bearer <CLIENT_PUBLISH_TOKEN>`, multipart: `manifest` (JSON wie oben ohne url/sha256/size) + alle
  Jars + `vibey.js`. Gleiche Version zweimal = 409. Admin-UI: Seite „Client“ mit Releases, Kanal ändern,
  zurückziehen.

## 3. Eigene Cosmetics einreichen

- `POST /api/v1/cosmetics/submissions` – multipart: `bundle` (`.vibey`, gleiche Prüfung und Größenlimits wie der
  Admin-Upload), optional `thumbnail` (PNG 256×256), Felder `name`, `description`. Max. 5 offene Einreichungen pro
  Nutzer, Rate-Limit. Antwort `{ submission }`.
- `GET /api/v1/cosmetics/submissions` – eigene Einreichungen:
  `{ id, name, description, kind, status: "pending"|"approved"|"rejected"|"withdrawn", reason?, itemId?,
     createdAt, reviewedAt?, assetUrl, thumbnailUrl? }`
- `GET /api/v1/cosmetics/submissions/:id/asset` – eigenes Bundle (für die Vorschau), nur für den Einreicher/Admins.
- `DELETE /api/v1/cosmetics/submissions/:id` – offene Einreichung zurückziehen.
- Admin-UI: Warteschlange mit 3D-Vorschau, Freigeben (→ Katalog-Item mit `creator: { uuid, name }`, Verfügbarkeit
  wählbar) oder Ablehnen mit Grund. Gateway-Event an den Einreicher: `submission.updated` `{ submission }`.
- Katalog-Items bekommen optional `creator: { uuid, name } | null`.

## 4. Over-the-air-Cosmetics

- Neue/geänderte Items brauchen nie ein Client- oder Launcher-Update: alles kommt aus Katalog + `.vibey`-Assets.
- Gateway-Event `catalog.updated` `{ version }` an alle verbundenen Clients, sobald sich der Katalog ändert
  (Admin-Edit, Freigabe, Zurückziehen). Clients laden dann Katalog neu und fehlende Assets per sha256 nach.
- `GET /api/v1/cosmetics/catalog` liefert weiter `version` + `ETag` (304 bei `If-None-Match`).

## 5. Nametag-Icons

- Die bestehende Loadout-Abfrage für Spieler in der Nähe liefert pro Spieler zusätzlich
  `client: "vibey" | null` (aktuell mit dem Vibey Client verbunden oder in den letzten 2 Minuten gesehen) und
  `badges: string[]` (z. B. `"staff"`, `"creator"`).
- Der Vibey Client zeigt vor dem Namen im Nametag (und in der Tab-Liste) ein kleines Robben-Icon bei
  `client == "vibey"`, plus Badge-Icon; per Einstellung abschaltbar.
