# Vertrag: Vibe-Beta-Warteliste (v1)

Vibe (Online-Dienste: Konto, Freunde, Chat, Hosting/Relay, Cosmetics, Vibey Client) ist in der Beta. Neue Spieler
können Vibe nicht mehr einfach aktivieren. Sie treten einer Warteliste bei, und das Team nimmt sie im Admin an.

## Zustände (users.access_status)
- `none`: Das Konto existiert (Login über /auth/verify), aber es gibt noch keine Anfrage.
- `waitlist`: Die Anfrage läuft.
- `approved`: freigeschaltet.
- `rejected`: abgelehnt (optional mit Grund für den Spieler).

Migration: Alle bestehenden Nutzer werden `approved`. Neue Nutzer starten mit `none`. Ist die Admin-Einstellung
`access.mode = "open"`, werden neue Nutzer beim Beitreten sofort `approved`. Standard ist `"waitlist"`.

## Backend-API
Der Login (`POST /api/v1/auth/challenge` und `/verify`) bleibt für alle offen und liefert Tokens wie bisher.

`GET /api/v1/access` (auth: user) liefert:
```json
{ "status": "none|waitlist|approved|rejected", "position": 12, "total": 40,
  "requestedAt": "ISO|null", "decidedAt": "ISO|null", "reason": "string|null", "mode": "waitlist|open" }
```
`position` ist 1-basiert und nur bei `waitlist` gesetzt, sonst null.

`POST /api/v1/access/request` (auth: user) mit Body `{ "note"?: string ≤ 500, "source"?: "launcher"|"client"|"website" }`:
- Setzt `none` oder `rejected` auf `waitlist`.
- Bei `access.mode = "open"` wird sofort `approved` gesetzt.
- Ist der Nutzer schon `waitlist` oder `approved`, passiert nichts.
- Antwort: dasselbe Objekt wie `GET /api/v1/access`.
- Rate-Limit.

`DELETE /api/v1/access/request` (auth: user): Der Spieler verlässt die Warteliste und ist danach wieder `none`.

Sperre: Alle anderen Routen mit `auth: "user"` antworten mit 403
`{ "error": { "code": "ACCESS_PENDING" | "ACCESS_REJECTED" | "ACCESS_NONE", "message": "…" } }`, solange der Status
nicht `approved` ist. Ausgenommen sind:
- `/api/v1/access*`
- `/api/v1/auth/*` (logout, refresh, sessions)
- Konto löschen und Datenexport (DSGVO)
- `/api/v1/feedback` (Feedback geht immer)

Der Gateway-WebSocket schließt bei nicht freigeschalteten Nutzern mit Close-Code 4403 und Grund
`ACCESS_PENDING|ACCESS_REJECTED|ACCESS_NONE`. Öffentliche Routen (`auth: "none"`) bleiben unverändert.

Benachrichtigung bei Freischaltung: Es wird eine Notification `access_approved` angelegt (bestehende
notifications-Tabelle). Der Launcher fragt `/api/v1/access` ab, solange der Status `waitlist` ist: beim Start und
dann höchstens alle 5 Minuten.

## Admin und MCP
- Admin-Seite „Warteliste“:
  - Liste mit Filter (wartend/angenommen/abgelehnt), Suche, Notiz des Spielers, Kopf, Name, Beitrittsdatum
  - Annehmen und Ablehnen (mit Grund), auch mehrere gleichzeitig
  - Schalter `access.mode` (waitlist/open)
  - Zähler im Dashboard
  - Jede Entscheidung steht im Audit-Log.
  - Beim Nutzer-Detail lässt sich der Zugang ändern.
- MCP-Tools:
  - `waitlist_list` (read)
  - `waitlist_decide` (moderate: ids[], approve|reject, reason?)
  - `access_mode_set` (moderate)

## Launcher
- Vibe-Einstellungen: „Vibe aktivieren“ wird zu „Warteliste beitreten“. Ablauf: Login mit Microsoft-Konto (wie bisher), danach `POST /access/request`. Optional mit einer kurzen Notiz.
- Zustände im UI:
  - wartet: Position X von Y, „Warteliste verlassen“
  - angenommen: Vibe läuft wie bisher, mit einmaligem „Willkommen“-Toast
  - abgelehnt: Grund anzeigen, erneut anfragen möglich
- Bei 403 mit `ACCESS_*` oder WS-Close 4403 hört der Launcher auf, Vibe-Dienste zu nutzen (keine Endlos-Reconnects) und zeigt den Status.
- Bestehende Nutzer (approved) merken nichts.

## Vibey Client
Der Client funktioniert nur mit freigeschaltetem Vibe-Zugang.
- Beim Start und nach dem Login prüft er `GET /api/v1/access`.
- Nur bei `approved` werden die Vibey-Module aktiv.
- Sonst bleibt er ein „inaktiver“ Mod: Minecraft läuft normal, aber ohne Vibey-Features. Im Titelbildschirm steht ein dezenter Hinweis mit Status: Warteliste Position X, bzw. „Tritt im Vibe Launcher der Warteliste bei“.
- Ein positives Ergebnis wird 7 Tage zwischengespeichert, damit Offline- und Backend-Ausfälle nicht sperren.
- Ein negatives Ergebnis wird nicht gespeichert, sondern beim nächsten Start neu geprüft.

## Präzisierungen aus dem Backend (Branch `feat/waitlist`)

- `GET /api/v1/me` ist für nicht freigeschaltete Nutzer ebenfalls gesperrt (403 `ACCESS_*`). Der Status kommt nur aus
  `GET /api/v1/access`.
- `DELETE /api/v1/access/request` antwortet mit 200 und demselben Objekt wie `GET`. `waitlist` und `rejected` werden zu
  `none`.
- `total` ist immer die Zahl der Wartenden.
- Gateway: Vor dem Close 4403 kommt `op: "error"` mit dem `ACCESS_*`-Code. Es gibt kein `session.revoked`, die Sitzung
  bleibt gültig, der Launcher meldet also nicht ab.
- Von der Sperre ausgenommen ist nur `DELETE /api/v1/me` (Konto löschen). Einen Datenexport gibt es nicht. Feedback geht
  immer.

## Umsetzung im Launcher

Code: `src/features/access/` (Store, Polling, UI), angebunden in `src/features/social/service.ts`.

- **Zentraler Status** `useVibeAccess` (`store.ts`): `unknown | none | waitlist | approved | rejected` plus die Antwort
  von `GET /api/v1/access`. Nach jedem Login (automatisch oder per Klick) prüft `ensureAccess()` den Zugang, bevor das
  Gateway startet. Ist der Status nicht `approved`, bleibt das Gateway aus und `useSocial.conn` ist `"no_access"`.
- **Bestandsnutzer**: Ein bestätigtes `approved` wird je Account in `localStorage["vibe.access.ok"]` gemerkt. Danach
  startet das Gateway ohne zusätzliche Anfrage. Eine spätere Sperre erkennt der Launcher über 403 bzw. 4403.
- **Altes Backend** ohne `/api/v1/access` (404) gilt als `approved`, ohne den Status zu merken.
- **Sperre erkennen**: Jede Antwort der SDK-Anfragen läuft durch `accessFetch`. 403 mit `ACCESS_*` setzt den Status und
  stoppt die Dienste. Der Gateway-Fehler `op: "error"` mit `ACCESS_*` und der Close 4403 setzen ebenfalls den Status, 4403 ist im SDK
  fatal (kein Reconnect, kein Abmelden). Danach
  wird `/api/v1/access` einmal neu geladen (Position).
- **Rust**: `vibe::api_error` macht aus 403 `ACCESS_*` den Fehler `AppError::Access` (`kind: "access"`) mit einem
  freundlichen deutschen Text (z. B. Vibey-Client-Downloads, Pack-Teilen).
- **Abfragen**: Nur bei `waitlist`, höchstens alle 5 Minuten und nur, solange das Fenster sichtbar ist (`poll.ts`).
- **Beitreten** (`actions.ts`, `JoinDialog.tsx`): mit optionaler Notiz (max. 500 Zeichen, `source: "launcher"`). Ist
  Vibe aus oder noch nicht angemeldet, merkt sich der Launcher den Wunsch (`localStorage["vibe.access.join"]`), schaltet
  Vibe ein bzw. meldet an und schickt die Anfrage direkt nach dem Login. Das Onboarding nutzt denselben Weg.
- **Willkommen**: Wer einmal nicht freigeschaltet war (`localStorage["vibe.access.seen"]`), bekommt beim Wechsel auf
  `approved` einmal den Toast „Willkommen bei Vibe!“. Bestandsnutzer sehen ihn nie.
- **UI**: Einstellungen „Vibe & Konto“ (Karte „Beta-Zugang“, dezentes „Beta“ am Abschnitt), Freunde-Seite und -Panel
  (`Gate`), Cosmetics (Seite und Gast-Banner), Server-Verbindung (Relay), Einladen beim Hosten, Vibey Client,
  Konto-Menü und Onboarding.
- **Tour-Anker** `data-tour="vibe-access"`: Karte „Beta-Zugang“, solange sie sichtbar ist, sonst die Vibe-Karte mit
  „Warteliste beitreten“ bzw. dem Hauptschalter.

### Mock (`VITE_MOCK=1`)

| localStorage | Werte | Wirkung |
| --- | --- | --- |
| `vl.mock.access` | `none`, `waitlist`, `approved` (Standard), `rejected` | Startzustand |
| `vl.mock.access.mode` | `waitlist` (Standard), `open` | `open`: Beitreten schaltet sofort frei |
| `vl.mock.access.approve_after` | Millisekunden | Warteliste wird danach beim nächsten `GET` angenommen |
| `vl.mock.access.poll` | Millisekunden | Abfrage-Abstand statt 5 Minuten (nur im Mock) |

Ohne Freischaltung antworten alle nicht ausgenommenen Mock-Routen mit 403 `ACCESS_*`, das Gateway schließt mit 4403.
