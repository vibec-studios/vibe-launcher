# Schnellleisten, Befehle und Tastenbelegung synchronisieren

Aktiviere unter **Instanz-Einstellungen → Synchronisieren** die gewünschten Bereiche. Der Abgleich bleibt auf diesem Gerät und läuft vor dem ersten Start und nach Ende der letzten Sitzung einer Instanz. **Jetzt abgleichen** gleicht die Dateien einer beendeten Instanz sofort ab.

- **Gespeicherte Schnellleisten** teilt `hotbar.nbt` zwischen Instanzen derselben Minecraft-Version. Gibt es zwei abweichende Stände, übernimmt die Instanz den gemeinsamen Stand und behält ihre vorherige Fassung als `hotbar-backup-….nbt`. Der Tab zeigt den Konflikt und den Sicherungsnamen.
- **Befehlsverlauf** führt bis zu 50 per Schrägstrich eingegebene Befehle aus `command_history.txt` zusammen. Minecraft speichert die Datei seit Java Edition 1.20.2. Der Verlauf kann Befehle enthalten, die für einen bestimmten Server oder ein bestimmtes Konto gedacht waren. Aktiviere ihn nur für die Instanzen, in denen du diese Befehle sehen möchtest.
- **Tastenbelegung** ist getrennt von der übrigen Steuerung wählbar. Bestehende Profile mit aktivierter Steuerung übernehmen diese Auswahl. Numerische und neuere Tastenbelegungen werden getrennt gespeichert. **Aus dieser Instanz übernehmen** setzt das gewählte Profil aus einer beendeten Instanz.

## Parallele Sitzungen

Laufen mehrere Instanzen gleichzeitig, schreibt eine später beendete Instanz keine veralteten Werte zurück. Der Launcher merkt sich beim Start, welche Optionen er in die Instanz geschrieben hat. Nach dem Spielen übernimmt er nur Werte, die in dieser Sitzung geändert wurden oder im gemeinsamen Profil noch fehlen. Das gilt für alle Optionsbereiche, also auch für Tastenbelegungen von Mods. Beim Befehlsverlauf kommen nur neu eingegebene Befehle dazu. Bereits gekürzte, alte Einträge tauchen nicht wieder auf. Schnellleisten vergleichen den Stand vom Start mit dem gemeinsamen Stand, sodass eine unveränderte Instanz die neuere Fassung übernimmt.

Der gemeinsame Dateistand liegt im Launcher-Datenordner unter `sync/personal`.
