# Cloud-Sicherung von Einstellungen und Instanzliste (Nr. 26)

Vertrag: `GET/PUT /api/v1/cloud-settings`. Einstellungen → Vibe & Konto → „Cloud-Sicherung“ (Opt-in je Account, `localStorage["vl.cloud.enabled"]`).

- **Sichern** (`BackupDialog`): Launcher-Einstellungen (Allowlist `SYNC_KEYS` in `src/features/cloudsync/snapshot.ts`, ohne Pfade, Schlüssel, Java-Pfade, Stores; eigene Hintergrundbilder/-videos werden entfernt) und gewählte Instanzen (max. 100). Manifeste erzeugt Rust (`vibe_cloud_manifests`): vlpack-Export nur von `mods`, `resourcepacks`, `shaderpacks`, davon nur `vlpack.json`, ohne Overrides und Icon. Unter `settings._meta` stehen Zeitpunkt und Umfang.
- **Wiederherstellen** (`RestoreDialog`): Einstellungen werden in die lokalen gemischt (lokale Bildpfade bleiben), gewählte Instanzen werden über `vibe_cloud_restore_instance` neu angelegt (temporäres vlpack → normaler Import, Task in der Aufgabenleiste). Vorhandene (gleiche ID oder gleicher Name) sind abgewählt.
- **Konflikt**: Bei `409 revision_conflict` zeigt `ConflictDialog` beide Stände und bietet „Cloud-Stand übernehmen“ (führt in die Wiederherstellung), „Mit diesem PC überschreiben“ (PUT mit der neuen Revision) oder „Nichts tun“.
- „Aus der Cloud löschen“ setzt `snapshot: null`.
