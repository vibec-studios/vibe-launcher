# Aktivitäten-Feed (Nr. 37)

Vertrag: `/api/v1/feed*`. Standard aus (Opt-in).

- Schalter „Aktivitäten mit Freunden teilen“: Einstellungen → Datenschutz (`FeedPrivacyRow`) und direkt in der Feed-Karte, solange er aus ist. Ausschalten löscht frühere Einträge (Backend).
- Feed „Was machen meine Freunde?“ in der Seitenleiste der Freunde-Übersicht (`src/features/feed/FeedCard.tsx`), mit Cursor-Nachladen und Screenshot-Vorschau (Lightbox).
- `FeedBridge` (in `VibeBridge`) meldet `played`, sobald ein Spiel läuft, und `created_instance`, wenn während der Sitzung eine neue Instanz in der Liste auftaucht. Nur bei Opt-in, höchstens einmal pro Typ und Tag (zusätzlich lokal in `vl.feed.sent`). Keine Namen oder Adressen.
