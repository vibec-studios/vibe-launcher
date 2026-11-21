# Screenshots hochladen und teilen (Nr. 16)

Vertrag: `/api/v1/screenshots` (Backend `docs/SCREENSHOTS.md`). Nur mit Vibe-Freunde-Schalter und Vibe-Anmeldung sichtbar.

- **Galerie** (`src/features/screenshots/ScreenshotsPage.tsx`): Rechtsklick auf ein Bild → „Hochladen und teilen …“ öffnet `ShareShotDialog` (Schritt 1 Sichtbarkeit Nur ich/Freunde/Link als `ChoiceCard`s mit Kontingent-Anzeige, Schritt 2 Link kopieren, in Chat senden, Sichtbarkeit ändern, online löschen). Wolken-Knopf in der Werkzeugleiste öffnet die Online-Galerie (`CloudShotsDialog`) mit Kontingent, Sichtbarkeit je Bild, Link, Chat und Löschen.
- **Upload** läuft in Rust (`vibe_screenshot_upload`, `src-tauri/src/vibe/media.rs`), weil der SDK-HTTP-Proxy nur Text kann. Der Pfad wird wie bei den übrigen Screenshot-Befehlen gegen `instances/<id>/minecraft/screenshots` geprüft. Fehler kommen als `shot:quota|too_large|format` und werden übersetzt.
- **Bilder anzeigen** (Chat, Feed, Online-Galerie ohne lokale Datei): `vibe_image` lädt eine Backend-URL mit Token und liefert eine data-URL (höchstens 8 MB, nur PNG/JPEG, nur Backend-Host).
- **Chat**: Gesendet wird `📷 Screenshot: <URL>`. `ChatShot` erkennt die URL, zeigt die Vorschau (Lightbox) und bei fremden Bildern „Melden“ (`POST /screenshots/:id/report`, Gründe aus `ReportReason`, Schlüssel aus `?key=`). Ist das Bild privat, stellt das Senden die Sichtbarkeit auf „Freunde“.
- Welche lokale Datei zu welcher Online-ID gehört, merkt sich `localStorage["vl.shots.uploaded"]`.
