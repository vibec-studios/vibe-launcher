# Domain-Umzug: henny.dev → axolite

Stand 19.11.2026. Gilt für Launcher, Vibey Client, Backend, Relay und Website.

## Neue Adressen

| Alt | Neu | Wofür |
|---|---|---|
| `https://vibe.henny.dev` | `https://vibe.axolite.app` | Backend-API, Konten, Admin, Website von Vibe |
| `https://vibe.henny.dev/j/<code>` | `https://axolite.cc/j/<code>` | Einladungslinks (Landingpage) |
| `<name>.vibey.henny.dev` | `<name>.axolite.cc` | Minecraft-Adressen über das Relay |
| `vibey.henny.dev` (Relay-Host) | `relay.axolite.cc` | Verbindung Host → Relay, gleicher Port |
| `vibey-status.henny.dev` | `status.axolite.app` | Status-API |

Infrastruktur (erledigt):

- `*.axolite.cc`: A-Eintrag auf `91.107.217.166`, nur DNS, für das Relay (TCP).
- `axolite.cc` und `*.axolite.app`: Cloudflare-Tunnel → Dokploy-Traefik.
- `vibe.axolite.app` und `axolite.cc` sind Domains der Backend-Compose.
- Bot Fight Mode ist auf den axolite-Zonen **aus**.
- `axolite.app` selbst und `api.axolite.app` gehören zu einer anderen App. Nicht benutzen.

## Übergang

- **henny.dev bleibt parallel in Betrieb**, mit demselben Server und derselben Datenbank. Veröffentlichte Launcher (bis beta.3) und Clients (bis 0.2.1) haben `vibe.henny.dev` und `vibey.henny.dev` fest eingebaut.
- Neue Versionen nutzen nur die neuen Adressen. Alte Adressen werden weiter **akzeptiert**: Einladungslinks, Server-Adressen, Deep-Links und gespeicherte Einstellungen.
- Hat ein Nutzer in den Einstellungen die alte Standardadresse gespeichert, wird sie auf die neue umgestellt. Eigene, abweichende Adressen bleiben unverändert.
- Der Relay vergibt neue Adressen unter `axolite.cc`. Verbindungen über `*.vibey.henny.dev` nimmt er weiter an, und dieselbe Adresse ist unter beiden Domains erreichbar.
- E-Mail-Absender bleiben vorerst auf henny.dev.

## Hinweise an Nutzer (Ankündigungen)

`GET /api/v1/announcements?app=launcher|client&version=<x>` ist öffentlich und ohne Login erreichbar:

```json
{ "items": [ { "id": "domain-move-2026-11", "level": "info|warn", "title": "…", "body": "…", "url": "https://…", "until": "2027-03-01T00:00:00Z", "apps": ["launcher", "client"], "max_version": null } ] }
```

- Texte gibt es auf DE und EN: `title`/`body` kommen in der Sprache aus `?lang=de|en`, Standard ist `de`.
- Clients zeigen jede `id` als Banner bzw. Hinweis an. Der Nutzer kann ihn wegklicken, danach bleibt er pro `id` ausgeblendet.
- Ist der Abruf nicht möglich, wird nichts angezeigt.
- Erste Ankündigung `domain-move-2026-11`: „Vibe zieht um: neue Adressen vibe.axolite.app und *.axolite.cc. Alte Adressen funktionieren vorerst weiter. Bitte Launcher und Vibey Client aktuell halten und gespeicherte Server-Adressen auf .axolite.cc umstellen.“
- Zusätzlich hat jede neue Version diesen Hinweis **fest eingebaut** (einmalig, wegklickbar). So erscheint er auch ohne Backend.

## Launcher (umgesetzt)

- Alle Adressen stehen zentral in `src-tauri/src/domains.rs` (Frontend: `src/lib/domains.ts`). Backend
  `https://vibe.axolite.app`, Relay `relay.axolite.cc:25565`, Einladungslinks `https://axolite.cc/j/<code>`.
- **Alte Adressen werden angenommen:** `vibe::check_api_url` behandelt `vibe.henny.dev` und `vibe.axolite.app` als
  dasselbe Backend (Downloads, Icons, Manifeste). Spiel-Links `https://axolite.cc/j/…`, `https://vibe.axolite.app/j/…`
  und `https://vibe.henny.dev/j/…` gelten in `session.json`, als Kommandozeilen-Argument und eingefügt in „Code oder
  Link eingeben“. Deep-Links `vibelauncher://…` sind unverändert.
- **Gespeicherte Werte:** Vibe-Tokens im Schlüsselbund, die noch für `https://vibe.henny.dev` gespeichert sind, werden
  beim ersten Lesen auf die neue Adresse umgeschrieben (kein Abmelden). Debug-Overrides (`VIBE_API_URL`, `VIBE_RELAY`),
  die genau der alten Standardadresse entsprechen, zeigen auf die neue. Eigene Adressen bleiben unverändert.
- **Hinweise:** Leiste oben über dem Inhalt (auch im Simple-Modus, dort mit einfachen Worten). Der eingebaute Hinweis
  hat die ID `domain-move-2026-11`; die Ankündigung mit derselben ID erscheint deshalb nicht doppelt. Ankündigungen
  holt Rust (`vibe_announcements`, nur mit Hauptschalter) beim Start und alle 30 min mit
  `?app=launcher&version=<Launcher-Version>&lang=<UI-Sprache>`; geprüft werden ID, Länge, `until`, `apps`,
  `max_version` und `https`-Links, höchstens 5. Fehler bleiben still. Weggeklickte IDs stehen in
  `settings.dismissed_notices`.
- **Serverliste:** Hat `servers.dat` einer Instanz Adressen `*.vibey.henny.dev`, zeigt der Tab „Server“ einen Hinweis
  mit „Auf .axolite.cc umstellen“ (`instance_servers_modernize`: gleicher Name, neue Domain, Port und alle anderen
  Felder bleiben).
