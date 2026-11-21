# Welle 4: Geteilte Packs, Mitspielen mit Pack, Hosting-Panel, Beta-Einladungen

Launcher-Seite zu den Backend-Verträgen 01, 02, 06 und 09 (`vibe-backend` Branch `feat/w3-social`).
SDK: `src/lib/vibe-sdk/types-social.ts` und neue Methoden in `client.ts` (`packs.follow/unfollow/following/followState/diff`,
`hosting.panel/setPolicy/setMember/removeMember/kick/unkick/events/update`, `playLinks.create/get/remove`,
`accessInvites.list/create/revoke/preview/redeem`). Mock: `src/dev/mock/socialw4.ts`.

## Nr. 1 – Geteilte Instanz mit Live-Sync (`src/features/packsync/`)
- **Leiste auf der Instanzseite** (`PackSyncBar`) bei Instanzen aus einem Vibe-Pack (`source.kind = "vibe"`): Folgen/Entfolgen,
  Schalter „Benachrichtigen“, Hinweis auf eine neue Version, Knopf „Änderungen ansehen“. Eigene Packs: kein Folgen.
- **Diff-Dialog** (`DiffDialog`): `GET /packs/:code/diff?from=<installiert>&to=<neu>` – Zusammenfassung, Minecraft/Loader-Wechsel,
  neu/aktualisiert/entfernt mit Kategorie, Änderungsnotizen. Fehlt die alte Version (404), erklärt er den vollständigen Abgleich.
- **Übernehmen** öffnet die vorhandene Modpack-Update-Vorschau mit `PackInput { kind: "vibe", code, version_id }`
  (Rust `content/modpack_from.rs` → `vibe/pack_fetch.rs`). Dort: Sicherung vorher, eigene Mods und geänderte Configs bleiben.
- **Installierte Version melden:** `PackSyncHost` gleicht nach dem Verbinden und bei jeder Instanzänderung alle Vibe-Pack-Instanzen
  mit `GET /packs/following` ab und ruft `PUT /packs/:code/follow { installedVersionId }` auf. Neu installierte Packs werden dabei
  automatisch gefolgt, außer man hat sie bewusst entfolgt (gemerkt in `localStorage vl.packsync.unfollowed`).
- **Gateway:** `pack.version.published` → Toast mit „Änderungen ansehen“; `pack.follow.updated`; `pack.removed`.

## Nr. 2 – Mitspielen-Link inklusive Modpack
- **Host:** Die Teilen-Leiste (`PlayLinkBar`) zeigt bei Instanzen mit Vibe-Pack (gefolgt oder selbst geteilt) „Modpack anhängen“,
  solange der Link noch kein `vibe_pack` hat. Das legt den Link mit denselben Daten plus `vibe_pack` neu an
  (`POST /play-links`, ersetzt den alten Link) und zeigt danach den neuen Link an (`PlayLinkExtras.tsx`).
- **`instance.json`** enthält jetzt zusätzlich `vibe_pack: { code, version_id? }`. Ein Vibey Client, der das Feld an
  `POST /play-links` durchreicht, braucht den Knopf nicht mehr (Wunsch-Vertrag `contracts/02-wunsch-client.md`).
- **Gast:** `play/join.rs` versteht `vibe_pack`: gleiche Pack-Version vorhanden → direkt joinen; gleiches Pack in anderer Version
  → Update mit Sicherung über `modpack_from` (Manifest über `/play-links/<code>/pack`, also auch bei Sichtbarkeit `friends`);
  sonst neue Instanz über `packs::install_from(PlayLink)`. Danach Quick Play auf `relay_host` und Meldung der installierten
  Version. Der Dialog zeigt die Schritte „Prüfen → Modpack einrichten → Beitreten“.

## Nr. 6 – Hosting-Panel (`src/features/hostpanel/`)
- Einstieg: Abschnitt „Deine gehosteten Welten“ auf der Freunde-Seite und „Verwalten“ in der Teilen-Leiste beim Hosten.
- Dialog (`size="full"`): Kopf mit Status, Adresse, Privatsphäre und eigener Rolle; Tabs **Spieler** (Rolle ändern, entfernen),
  **Rollen** (Erklärung Host/Mitglied/Gast, Spieler per Name hinzufügen), **Sperren** (aufheben), **Wer darf rein?**
  (nur Einladung / Freunde / alle, Rolle für neue Spieler, max. Spieler). Rechts das Ereignisprotokoll live.
- Entfernen-Dialog: „Nur diese Runde“ oder „Dauerhaft sperren“, optional mit Grund.
- Gateway: `hosting.panel.updated`, `hosting.event`, `hosting.kick` (Toast für den Gekickten).

## Nr. 9 – Einladungscodes (`src/features/accessinvite/`)
- **Freunde einladen:** Karte in der Seitenleiste der Freunde-Seite, Dialog mit Kontingent, „Für jeden“ oder „Nur für einen
  Spieler“ (Minecraft-Name), Ergebnis mit Code, Link und fertiger Nachricht zum Kopieren, Liste mit Status und Zurückziehen.
- **Einlösen:** Zeile in der Beta-Karte (Einstellungen → Vibe) und Knopf „Ich habe einen Einladungscode“ im Wartelisten-Hinweis;
  Deep-Link `vibelauncher://invite/<code>` (8 Zeichen) öffnet einen Dialog mit Vorschau (wer lädt ein, gültig bis) und
  „Einlösen“. Längere Codes bleiben Spiel-Einladungen (`AppAction::Invite`).

## Mock testen (`VITE_MOCK=1`)
- Instanz „Insel-Survival“: gefolgtes Pack mit Update 1.2.0 → 1.3.0; nach etwa 9 s kommt ein `pack.version.published`-Toast.
- `?join=insel2` (Update der vorhandenen Instanz), `?join=inselx` (neues Pack), `?invite=k3x9q2ab` (Einladung; `exp23456` abgelaufen,
  `zzzzzzzz` unbekannt), `?running=survival` (Hosten → „Modpack anhängen“, „Verwalten“).
  Warteliste: `localStorage vl.mock.access = "waitlist"`.
