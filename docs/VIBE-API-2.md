# Vibe-Backend – Erweiterungen Runde 2 (Vertrag zwischen Backend, Launcher, Client, Website)

Stand 2026-11-18 (Backend-Ergänzungen *kursiv markiert*, live auf vibe.henny.dev). Basis: `https://vibe.henny.dev`. Alle Nutzer-Routen mit dem bestehenden Bearer-Token
(Login über Mojang `hasJoined`, wie bisher). Fehlerformat wie bisher (`{ error: { code, message } }`).
Wer etwas ändert, passt diese Datei an und sagt es den anderen.

## 1. Konto

- `DELETE /api/v1/me` – Body `{ "confirm": true }`. Löscht das Vibe-Konto mit allen persönlichen Daten
  (Freundschaften, Anfragen, Blocks, Chat-Mitgliedschaften und eigene Nachrichten, Loadout, Geräte/Sessions,
  geteilte Packs, eingereichte Cosmetics die noch nicht freigegeben sind). Freigegebene Creator-Cosmetics bleiben im
  Katalog, der Creator-Name wird zu „Gelöschter Nutzer“. Schließt alle Gateway-Verbindungen. Freunde bekommen
  `friend.removed`. Antwort `204`. Danach ist ein neuer Login wieder möglich (neues, leeres Konto).
  *(Backend, umgesetzt:)* Ohne `confirm: true` → `400`. Gateway-Close `4010` mit `session.revoked { reason: "account_deleted" }`.
  DMs werden ganz gelöscht (Partner bekommt `chat.removed`), Gruppen behalten die Nachrichten der anderen
  (`chat.updated`). Konten mit aktivem Bann: `403 banned`. Gelöschter Creator im Katalog:
  `creator: { uuid: "00000000-0000-0000-0000-000000000000", name: "Gelöschter Nutzer" }` (Typ bleibt `string`).
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
  *(Backend, umgesetzt:)* `channel=beta` = neuestes aus **beta und release**; „neuestes“ = zuletzt veröffentlicht;
  ohne Release `404 not_found`; `ETag`/`If-None-Match`. `blockbench` ist `null`, wenn ein Release kein Plugin hat.
- `GET /api/v1/client/releases` – Liste (neueste zuerst), gleiche Form ohne `changelog`-Kürzung.
  Antwort `{ releases: [...] }`, optional `?channel=` und `?limit=` (≤ 100); zurückgezogene fehlen.
- `GET /api/v1/client/files/:sha256/:file` – Datei (mit `ETag`, `Content-Length`, `immutable`-Cache).
- *(Backend, Stand 2026-11-18 – Standardweg:)* **Das Backend holt neue Releases selbst von GitHub.** Cloudflare
  (Bot Fight Mode, Free-Plan) fordert GitHub-Runner bei `/internal/client/*` heraus, ein Push aus der CI geht deshalb
  nicht. Stattdessen fragt das Backend alle ~10 min (±20 % Zufall) `GET https://api.github.com/repos/vibec-studios/vibey-client/releases`
  ab – bedingt mit `If-None-Match`/ETag (304 zählt kaum gegen das Limit von 60/h ohne Token). Regeln:
  - Importiert wird jedes **Nicht-Entwurf**-Release, dessen Version noch nicht im Backend ist und das ein Asset
    **`vibey-manifest.json`** hat (Altlast: `manifest.json` wird auch akzeptiert). Das Manifest hat die Form des
    Publish-Manifests **plus `sha256` und `size` je Datei und beim Blockbench-Plugin**:
    ```json
    { "version": "0.3.0", "channel": "release", "changelog": "Markdown",
      "files": [ { "loader": "fabric", "mcVersions": ["1.21.4"], "file": "vibey-client-fabric-1.21.4-0.3.0.jar",
                   "requires": [ { "modrinth": "P7dR8mSH", "name": "Fabric API" } ], "sha256": "…", "size": 14945225 } ],
      "blockbench": { "version": "0.3.0", "file": "vibey.js", "sha256": "…", "size": 134204 } }
    ```
    Jede Datei muss als Asset gleichen Namens am Release hängen. Ohne `sha256` (Altlast 0.2.0) vertraut das Backend
    den geladenen Bytes und speichert den berechneten Hash; den GitHub-Asset-`digest` prüft es zusätzlich, wenn da.
  - **Kanal:** GitHub-`prerelease` → `beta`, sonst `release`. Das GitHub-Flag gewinnt über `channel` im Manifest
    (Abweichung wird geloggt). **Changelog:** `changelog` aus dem Manifest, wenn leer der Release-Text.
    `publishedAt` = `published_at` des GitHub-Releases.
  - Tag `v<version>` muss zur Manifest-Version passen. Jede Abweichung bei Größe/sha256, fehlende Assets, ungültiges
    Manifest oder Limits (wie beim Publish: 48 Dateien, je 64 MB, zusammen 768 MB) → **das ganze Release wird
    abgelehnt** (keine Teil-Releases, neu gespeicherte Dateien werden wieder entfernt). Ein abgelehntes Release
    versucht der automatische Abgleich erst wieder, wenn es sich auf GitHub ändert (z. B. Asset ersetzt); Netz- oder
    Serverfehler werden beim nächsten Lauf wiederholt.
  - Idempotent: vorhandene Versionen werden übersprungen (auch manuell veröffentlichte wie 0.2.0), **zurückgezogene
    werden nie erneut importiert**. Auf GitHub gelöschte Releases bleiben im Backend (zurückziehen im Admin-UI).
  - Ergebnis identisch zum Publish-Weg (`latest`/`releases`/`files` unverändert), Audit `client.import`.
  - Das Repo ist noch privat: ohne Lese-Token antwortet GitHub `404` – das Backend loggt das einmal und versucht es
    leise weiter; sobald das Repo öffentlich ist, läuft der Import von selbst. Optional `GITHUB_RELEASES_TOKEN`
    (fine-grained, nur Lesen) – dann über die API-Asset-URL mit `Accept: application/octet-stream`.
  - Admin-UI „Client“: **„Jetzt von GitHub importieren“** (Rolle admin; ohne ETag, abgelehnte Releases werden neu
    versucht) mit Ergebnis (importiert/übersprungen/Fehler) und Stand der letzten automatischen Prüfung.
    Admin-API `POST /admin/api/client/github-import` (wartet ≤ 45 s, sonst `done: false` und Stand per
    `GET /admin/api/client/github-import`).
  - Für die vibey-client-CI heißt das: Release auf GitHub mit allen Jars, `vibey.js` und `vibey-manifest.json`
    (mit `sha256`/`size`) anlegen; `prerelease` setzen für Betas. Kein Push ans Backend nötig.
- Veröffentlichen von Hand (manueller Weg, bleibt bestehen): `POST /internal/client/v1/releases`,
  `Authorization: Bearer <CLIENT_PUBLISH_TOKEN>`, multipart: `manifest` (JSON wie oben ohne url; `sha256`/`size` optional, werden geprüft) + alle
  Jars + `vibey.js`. Gleiche Version zweimal = 409. Admin-UI: Seite „Client“ mit Releases, Kanal ändern,
  zurückziehen.
  *(Backend, ergänzt – wichtig für die CI:)* Vor `vibe.henny.dev` liegt **Cloudflare mit 100 MB pro Anfrage**; ein
  Release mit ~20 Jars à 15 MB passt nicht in eine Anfrage. Deshalb zusätzlich `POST /internal/client/v1/files`
  (gleicher Bearer, multipart, eine oder mehrere Dateien, Dateiname = `file`, Gruppen < 100 MB) →
  `201 { files: [{ file, sha256, size }] }`; danach im Manifest je Datei optional `sha256` angeben und die Datei im
  Release-Request weglassen (gemischt erlaubt). Ohne `sha256` muss die Datei wie bisher mitkommen.
  Fehlende/zusätzliche Dateien → `400 validation_failed` mit `details: { missing, extra }`; kein Token auf dem Server
  → `503`; falscher Token → `401`. Limits je Anfrage: 48 Dateien, je 64 MB. Zurückgezogene Releases: Dateien → `410`.

## 3. Eigene Cosmetics einreichen

- `POST /api/v1/cosmetics/submissions` – multipart: `bundle` (`.vibey`, gleiche Prüfung und Größenlimits wie der
  Admin-Upload), optional `thumbnail` (PNG 256×256), Felder `name`, `description`. Max. 5 offene Einreichungen pro
  Nutzer, Rate-Limit. Antwort `{ submission }`.
- `GET /api/v1/cosmetics/submissions` – eigene Einreichungen:
  `{ id, name, description, kind, status: "pending"|"approved"|"rejected"|"withdrawn", reason?, itemId?,
     createdAt, reviewedAt?, assetUrl, thumbnailUrl? }`
- `GET /api/v1/cosmetics/submissions/:id/asset` – eigenes Bundle (für die Vorschau), nur für den Einreicher/Admins.
  *(Backend, ergänzt:)* `GET …/:id/thumbnail.png` (Bearer, Einreicher) für `thumbnailUrl`; beide URLs relativ.
  Listen-Antwort `{ submissions: [...] }`, Einträge zusätzlich mit `slot`, `bundleId`, `asset: { hash, size }`.
  `name` optional (Standard = Name aus dem Bundle). Vorschaubild PNG ≤ 256×256 px und ≤ 1 MB. 5 offene →
  `403 limit_reached`; Rate-Limit 10 Uploads/Stunde → `429`. Zurückgezogen → Status `withdrawn` (Antwort `{ submission }`).
- `DELETE /api/v1/cosmetics/submissions/:id` – offene Einreichung zurückziehen.
- Admin-UI: Warteschlange mit 3D-Vorschau, Freigeben (→ Katalog-Item mit `creator: { uuid, name }`, Verfügbarkeit
  wählbar) oder Ablehnen mit Grund. Gateway-Event an den Einreicher: `submission.updated` `{ submission }`.
- Katalog-Items bekommen optional `creator: { uuid, name } | null`.
  *(Backend, umgesetzt:)* Freigegebene Items liegen **immer im Namespace `community:`** (`community:<pfad>`, bei
  Kollision `_2`, `_3` …); weicht die ID vom Bundle ab, schreibt das Backend `id` im Bundle um (Katalog-ID = Bundle-ID,
  neuer Hash). Niemand kann `vibey:`-IDs einreichen. Der Einreicher bekommt zusätzlich eine Inbox-Benachrichtigung.

## 4. Over-the-air-Cosmetics

- Neue/geänderte Items brauchen nie ein Client- oder Launcher-Update: alles kommt aus Katalog + `.vibey`-Assets.
- Gateway-Event `catalog.updated` `{ version }` an alle verbundenen Clients, sobald sich der Katalog ändert
  (Admin-Edit, Freigabe, Zurückziehen). Clients laden dann Katalog neu und fehlende Assets per sha256 nach.
- `GET /api/v1/cosmetics/catalog` liefert weiter `version` + `ETag` (304 bei `If-None-Match`).
  *(Backend, umgesetzt:)* `catalog.updated` wird 1 s gebündelt, nur bei geänderter `version` gesendet und ist ein
  normales **sequenziertes** Event (wird beim Resume nachgeliefert). `ready` enthält zusätzlich `catalogVersion`
  (nach Reconnect vergleichen; Seed-Änderungen beim Server-Start kommen nur so an).

## 5. Nametag-Icons

- Die bestehende Loadout-Abfrage für Spieler in der Nähe liefert pro Spieler zusätzlich
  `client: "vibey" | null` (aktuell mit dem Vibey Client verbunden oder in den letzten 2 Minuten gesehen) und
  `badges: string[]` (z. B. `"staff"`, `"creator"`).
  *(Backend, umgesetzt:)* „Vibey Client“ = Gateway-Verbindung einer Login-Sitzung mit `client.name = "vibey-client"`.
  Bei Status „unsichtbar“ ist `client` immer `null`. `badges` ⊆ `"staff" | "supporter" | "creator"` (unbekannte
  ignorieren). Beide Felder stehen auch in `loadout.updated`.
- Der Vibey Client zeigt vor dem Namen im Nametag (und in der Tab-Liste) ein kleines Robben-Icon bei
  `client == "vibey"`, plus Badge-Icon; per Einstellung abschaltbar.

## 6. Signierte Loadouts (Server-Kanal absichern)

Ziel: Ein veränderter Client kann anderen Spielern über den Server-Kanal (`vibeyclient:loadout`/`emote`, wenn die Mod
auf dem Server ist) keine Items zeigen, die er nicht besitzt.

- `GET /api/v1/meta` → zusätzlich `loadoutSigning: { alg: "Ed25519", keyId: "<8 hex>", publicKey: "<base64, 32 Byte raw>" } | null`.
  `keyId` = erste 8 Hex-Zeichen von SHA-256(publicKey raw). Der Schlüssel liegt im Backend als Secret
  `LOADOUT_SIGNING_KEY` (PKCS#8, base64); ohne Secret erzeugt ein Dev-Backend einen flüchtigen Schlüssel,
  Produktion braucht das Secret.
- `GET /api/v1/cosmetics/loadout/signed` (Bearer, 20/min) → `{ token, payload }`; `503 feature_disabled`, wenn das
  Backend nicht signiert (`loadoutSigning: null`). Auch `PUT /api/v1/cosmetics/loadout` liefert zusätzlich
  `signed: { token, payload } | null` (`null`, wenn das Backend nicht signiert).
  - `token` = `base64url(payloadJsonBytes) + "." + base64url(ed25519Signature(payloadJsonBytes))`. Signiert werden
    genau die Bytes des ersten Teils, keine Kanonisierung nötig. base64url ohne Padding. Java: `X509EncodedKeySpec`
    aus Präfix `302a300506032b6570032100` + 32 Byte `publicKey`, `Signature.getInstance("Ed25519")`.
  - `payload` = `{ v: 1, kid, uuid, slots: { slot: itemId }, emotes: [itemId…], iat, exp }`. `uuid` mit Bindestrichen,
    `iat`/`exp` in Unix-Sekunden, `exp = iat + 6 h`.
  - `emotes` = alle besessenen Emote-IDs mit Verfügbarkeit `granted` (Standard-Emotes muss niemand belegen).
  - Größe des Tokens ≤ 2 KiB (sonst `413`, beim `PUT` dann `signed: null` – in der Praxis unerreichbar).
- Client (Server-Kanal):
  - Sendet im `loadout`-Paket das Token mit. Neue Tokens holt er nach jedem Loadout-Wechsel und spätestens 30 min vor
    `exp`.
  - Empfänger prüfen Signatur (`kid` muss zum Meta-Schlüssel passen), `uuid` = UUID des sendenden Spielers,
    `exp > jetzt − 5 min`.
  - Gültig → Slots aus dem `payload` übernehmen (nicht aus ungeprüften Feldern).
  - Ohne oder mit ungültigem Token gelten nur Items mit Verfügbarkeit `default` (die jeder besitzt). Alles andere
    wird ignoriert und, wenn möglich, über `POST /api/v1/cosmetics/lookup` nachgeladen.
  - Emotes über den Server-Kanal: `default`-Emotes immer, `granted`-Emotes nur, wenn sie im zuletzt gültigen Token des
    Spielers unter `emotes` stehen.
- Der Server-Relay (Mod auf dem Server) leitet Token unverändert weiter und prüft nur Größe und Rate.
