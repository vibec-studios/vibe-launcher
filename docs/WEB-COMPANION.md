# Web-Companion: Geräte koppeln (Nr. 35)

Vertrag: `/api/v1/auth/device/*`. Einstellungen → Vibe & Konto → „Browser und Handy“ (`src/features/companion/DevicesCard.tsx`).

- 8-stelliger Code (Alphabet ohne 0/1/I/O, Eingabe wird normalisiert und als `ABCD-2345` angezeigt). „Weiter“ öffnet eine Bestätigung mit deutlichem Hinweis auf das neue Gerät, was es darf und dass niemand nach Codes fragt. Erst dann `VibeClient.approveDevicePairing(code)`.
- Liste der angemeldeten Geräte über `GET /auth/sessions` (Browser-Sitzungen als „Vibe im Browser“), Abmelden über `DELETE /auth/sessions/:id` mit Bestätigung. Die eigene Sitzung ist markiert und nicht abmeldbar.
