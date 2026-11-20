# Microsoft-Anmeldung

Der Launcher meldet nur echte Microsoft-Konten an (keine Offline-/Cracked-Konten). Die Kette danach ist immer
gleich: Microsoft-Token -> Xbox Live -> XSTS -> Minecraft Services (`src-tauri/src/auth/msa.rs`).

## Standard: eigenes Anmeldefenster

- Eigenes Fenster (Tauri-`WebviewWindow`, InPrivate/`incognito`), wie beim offiziellen Launcher oder Modrinth.
- OAuth 2.0 **Authorization Code + PKCE** (S256) gegen
  `https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize`, `prompt=select_account`,
  Scope `XboxLive.signin offline_access`, Redirect URI `https://login.microsoftonline.com/common/oauth2/nativeclient`.
- Der Redirect wird per `on_navigation` abgefangen (nie geladen), `state` wird geprüft, das Fenster schließt sich,
  Code + `code_verifier` werden am Token-Endpunkt getauscht.
- Fenster schließen = Abbruch; Zeitlimit 10 Minuten; es gibt immer nur ein Anmeldefenster.
- Client-ID wie bisher aus der Build-Konfiguration (`VIBE_MSA_CLIENT_ID`) bzw. den Einstellungen.

Code: `auth/pkce.rs` (PKCE, URL, Redirect auswerten), `auth/webview.rs` (Fenster), `AuthState::msa_window_login`.

## Fallback: Im Browser anmelden (Code)

Der bisherige Device-Code-Flow bleibt im Login-Dialog als Link „Im Browser anmelden (Code)“ – z. B. für Passkeys
oder Passwortmanager, die nur im normalen Browser funktionieren.

## Einmalig in Azure einrichten

In der App-Registrierung (Azure-Portal -> App registrations -> die Launcher-App):

1. **Authentication -> Add a platform -> Mobile and desktop applications**
2. Die Redirect URI `https://login.microsoftonline.com/common/oauth2/nativeclient` anhaken und speichern.
3. „Allow public client flows“ bleibt auf **Yes** (für den Code-Fallback).

Eine neue Freigabe bei Mojang ist **nicht** nötig – Client-ID und Minecraft-Freigabe bleiben gleich.

Solange die Redirect URI fehlt, zeigt Microsoft im Fenster einen Fehler zur `redirect_uri`; der Launcher meldet dann
„Das Anmeldefenster ist in der Azure-App noch nicht freigeschaltet …“ und verweist auf den Code-Fallback.

## Tresor

Tokens liegen im Windows-Tresor (Anmeldeinformationsverwaltung). Schlägt das Speichern fehl, läuft die Sitzung
weiter, und der Launcher zeigt einen Hinweis (`auth://vault-warning`): Nach dem Beenden ist eine neue Anmeldung nötig.

## Offline-Start (nur Einzelspieler)

Scheitert die Token-Erneuerung eines bereits verifizierten Kontos nur an der Verbindung (Netzwerkfehler oder
Microsoft/Xbox/Minecraft mit HTTP 5xx), bietet der Launcher einen Offline-Start an: echter Name und UUID des Kontos,
kein gültiger Token. Mehrspieler-Server im Online-Modus funktionieren so nicht. Bei abgelehnter Anmeldung
(`needs_relogin`) gibt es kein Offline-Angebot. Installierte Instanzen starten dabei ohne Manifest-/Asset-Abrufe,
solange alle Dateien lokal vorhanden sind (`minecraft/install/local.rs`).
