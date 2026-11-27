# Tickets (Meine Tickets, Antworten, Chat melden)

Gesendete Feedback-Meldungen und Chat-Meldungen erscheinen im Launcher als **Tickets** mit Verlauf. Der Vertrag mit dem
Backend steht im Backend-Repo (`docs/TICKETS.md`), hier nur die Launcher-Seite.

Code: `src-tauri/src/tickets/`, `src-tauri/src/commands/tickets.rs`, `src/features/tickets/`, Mock `src/dev/mock/tickets.ts`.

## Einstiege

- **Topbar:** Knopf „Meine Tickets“ neben „Feedback & Fehler melden“, sichtbar sobald es ein Ticket gibt. Punkt = ein Ticket ist
  ungelesen oder das Team wartet auf etwas (`unread` oder `openRequests > 0`).
- **Feedback-Dialog:** nach dem Senden „Ticket ansehen“.
- **Einstellungen → Über:** „Tickets öffnen“.
- **Toast** bei neuer Antwort (Gateway `notification.created` mit `type = ticket.*`, sonst beim Hintergrund-Abgleich).
- **Chat:** „Melden“ an fremden Nachrichten (Rechtsklick/⋯) und „Chat melden“ im ⋯-Menü des Chat-Kopfs. Chats gibt es nur mit
  Konto, deshalb ist Melden immer angemeldet.

Seite `/tickets?t=VB-42`: links die Liste (Offen/Alle), rechts der Verlauf mit offenen Anfragen oben, Antwortfeld unten
(Strg+Enter sendet). „Wartet auf dich“-Anfragen haben einen Knopf: Text → Antwortfeld mit Bezug auf die Anfrage, Log /
Crash-Report / Screenshot → Anhang-Dialog mit passender Vorauswahl.

## Ticket-Tokens

- `POST /api/v1/feedback` und `POST /api/v1/tickets/report-chat` liefern `token` (`vtk_…`). Rust speichert `{ id, ticket, token }`
  im **OS-Schlüsselbund** (`SecretStore`, Eintrag `tickets:<hash der API-Adresse>`), nie in Dateien oder `localStorage`.
- Das Token verlässt Rust nie: `SendResult::Sent.token` ist `#[serde(skip)]`, Lookup-Antworten werden vor der Rückgabe von
  `token` befreit (`tickets::sanitize`), Rust setzt `X-Ticket-Token` selbst. Tokens werden nicht geloggt.
- Unbekannte Tokens aus `lookup.unknown` werden lokal entfernt.
- Die Oberfläche kennt nur `tickets_local` → `{ id, ticket, added }` (für den Topbar-Knopf ohne Netz).

## Anmeldung

Bearer nur, wenn Vibe eingeschaltet und ein Vibe-Login vorhanden ist (`tickets::bearer`). Vor jedem Aufruf erneuert das
SDK das Access-Token bei Bedarf (`ticketCall` in `src/features/tickets/call.ts`); bei `401 token_expired`/`invalid_token`
einmal `refresh()` und erneut versuchen. Ohne Konto laufen alle Aufrufe über das Ticket-Token.

## Abgleich

| Wann | Was |
|---|---|
| Seite „Meine Tickets“ öffnen | `tickets_list(background = false)`: Konto-Liste + `lookup` mit allen Tokens, zusammengeführt über `id` |
| Hintergrund, nur bei Vibe an | alle 5 min (mit Gateway-Verbindung alle 15 min) `tickets_list(background = true)`; Tickets `rejected` und seit 30 Tagen unverändert werden ausgelassen |
| Geöffnetes Ticket | alle 45 s `GET …?after=<letzte id>`, Nachrichten werden über `id` zusammengeführt |
| Gateway `ticket.updated` | Liste aktualisieren, offenes Ticket neu laden |
| Ticket mit `unread` geöffnet | `POST …/read` |

Bei ausgeschaltetem Vibe gibt es **keinen** Hintergrund-Abgleich: Tickets werden nur geladen, wenn der Nutzer die Seite öffnet
(wie Feedback: Kernfunktion, aber nur auf Klick).

## Antworten und Anhänge

- Nur Text: `ticket_reply` → JSON `{ body, fulfills }`.
- Mit Dateien: `ticket_reply_preview` baut das Paket wie beim Feedback (`feedback::attach::collect`: gleiche Log-Quellen,
  Kürzung und Bereinigung, Screenshots nur aus dem Datei-Dialog von Rust), die Vorschau zeigt genau den Inhalt,
  `ticket_reply_send(token)` schickt ihn als multipart (`meta`, `log`, `screenshot`).
- Anhänge ansehen: `ticket_attachment` lädt mit Auth; Bilder werden per Signatur erkannt und als data-URL geliefert, Logs als Text.

Fehler kommen als `{ kind, http, code, message, retry_after, details }` (`TicketError`) und werden in
`ticketErrorText` übersetzt (`ticket_closed`, `limit_reached`, `conflict`, 413, 429 mit `Retry-After`, offline).
Chat melden mit `409 conflict` öffnet das bestehende Ticket aus `details.ticket`.

## Mock

`localStorage vl.mock.tickets` = `none` (keine Tickets) | `offline` (Liste schlägt fehl) | `conflict` (Chat schon gemeldet).
Sonst vier Beispiel-Tickets: `VB-1042` wartet auf Log + Screenshot, `VB-1031` mit Text-Anfrage, `VB-998` erledigt mit
abgelaufenem Anhang, `VB-1050` Chat-Meldung.
