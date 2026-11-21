# Server entdecken (Nr. 25)

Vertrag: `/api/v1/discovery/*`. Erreichbar über die Freunde-Seite, Eintrag „Server entdecken“ (`/social?view=servers`).

- Karten mit Kategorie, Beschreibung, Ping über die vorhandene Ping-Funktion (`usePing`/`server_ping`: Latenz, Spieler, Version, MOTD, Favicon) und „N Freunde spielen hier“ (Presence `activity.server`, Adresse normalisiert ohne `:25565`). Server mit Freunden stehen oben.
- „Spielen“ öffnet `JoinDialog`: Instanz wird anhand der Ping-Version vorgeschlagen (Vanilla/Fabric/Quilt bevorzugt, zuletzt gespielt zuerst), wählbar, Start mit `instanceLaunch(..., server)`.
- „Server einreichen“ (Name, Kategorie, Adresse mit Prüfung und Erreichbarkeitstest, Beschreibung) und „Meine Einreichungen“ mit Prüfstand.
