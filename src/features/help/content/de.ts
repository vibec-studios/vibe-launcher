import type { HelpContent } from "../types";

const de: HelpContent = {
  guides: {
    "first-instance": {
      title: "Erste Instanz erstellen",
      summary: "Eine Instanz ist ein eigenes Minecraft mit eigener Version, eigenen Mods und eigenen Welten. Du kannst beliebig viele davon haben.",
      steps: [
        "Klicke links in der Seitenleiste auf „+ Neue Instanz“ oder auf der Startseite auf „Neue Instanz“.",
        "Wähle aus, was du vorhast: Vanilla, mit Mods, ein Modpack oder einen Import. Im Simple-Modus reicht ein Klick auf ein Ziel.",
        "Gib der Instanz einen Namen und wähle die Minecraft-Version. Für Mods wählst du zusätzlich einen Loader (Fabric, NeoForge, Forge oder Quilt).",
        "Klicke auf „Erstellen“. Der Launcher lädt Minecraft, Java und den Loader selbst herunter. Den Fortschritt siehst du oben rechts bei den Aufgaben.",
        "Sobald die Instanz fertig ist, startest du sie mit „Spielen“.",
      ],
      tips: [
        "Melde dich vorher mit deinem Microsoft-Konto an (Konto-Knopf oben rechts), sonst kannst du nicht online spielen.",
        "Du weißt nicht, welchen Loader du brauchst? Nimm Fabric. Die meisten aktuellen Mods gibt es dafür.",
      ],
      keywords: "neu anlegen version loader fabric forge vanilla spiel",
    },
    modpack: {
      title: "Modpack installieren",
      summary: "Ein Modpack ist eine fertige Sammlung von Mods. Der Launcher legt dafür eine neue Instanz an und installiert alles automatisch.",
      steps: [
        "Öffne „Entdecken“ in der Seitenleiste.",
        "Wähle oben den Typ „Modpacks“.",
        "Suche nach dem Namen des Modpacks oder stöbere über die Filter links.",
        "Öffne das Modpack und klicke auf „Installieren“. Es entsteht eine neue Instanz mit dem Namen des Modpacks.",
        "Warte, bis die Installation fertig ist (oben rechts bei den Aufgaben), und klicke dann auf „Spielen“.",
      ],
      tips: [
        "Modpack-Dateien (.mrpack, .zip von CurseForge) kannst du auch einfach ins Launcher-Fenster ziehen.",
        "Gibt es ein Update, zeigt die Instanz einen Hinweis. Deine Welten bleiben beim Update erhalten.",
      ],
      keywords: "modrinth curseforge mrpack pack sammlung",
    },
    mods: {
      title: "Mods hinzufügen und aktualisieren",
      summary: "Mods, Texturpakete und Shader fügst du direkt in einer Instanz hinzu. Updates prüft der Launcher für dich.",
      steps: [
        "Öffne die Instanz in der Bibliothek und bleibe im Bereich „Inhalte“.",
        "Klicke auf „Inhalte hinzufügen“. Es öffnet sich „Entdecken“, gefiltert auf passende Version und Loader.",
        "Klicke bei einem Mod auf „Installieren“. Benötigte Abhängigkeiten lädt der Launcher mit.",
        "Eigene .jar-Dateien fügst du über „Dateien hinzufügen“ hinzu oder ziehst sie ins Fenster.",
        "Mit „Neu prüfen“ (oder F5) sucht der Launcher nach Updates. Gibt es welche, aktualisierst du sie mit „Alle aktualisieren“.",
      ],
      tips: [
        "Einzelne Mods kannst du mit dem Schalter in der Liste ausschalten, ohne sie zu löschen.",
        "Vor großen Updates lohnt sich ein Backup der Instanz.",
      ],
      keywords: "mod jar update aktualisieren shader texturpaket resourcepack hinzufügen",
    },
    import: {
      title: "Aus anderem Launcher importieren",
      summary: "Du kannst Instanzen aus anderen Launchern übernehmen, z. B. Modrinth App, CurseForge, Prism, MultiMC, ATLauncher, GDLauncher oder dem offiziellen Launcher.",
      steps: [
        "Klicke in der Bibliothek oder auf der Startseite auf „Importieren“.",
        "Wähle oben „Aus anderem Launcher“. Der Launcher sucht selbst nach installierten Launchern.",
        "Wird dein Launcher nicht gefunden, klicke auf „Ordner wählen …“ und wähle seinen Ordner oder den einer einzelnen Instanz.",
        "Hake die Instanzen an, die du übernehmen möchtest, und klicke auf „Importieren“. Welten, Configs und Einstellungen kommen mit.",
        "Nachimportieren: Öffne den Import später einfach erneut. Schon übernommene Instanzen sind als „Bereits importiert“ markiert, neue kannst du dazunehmen.",
      ],
      tips: [
        "Dein alter Launcher bleibt unverändert, es wird nur kopiert.",
        "Einzelne Modpack-Dateien importierst du im Modus „Datei“.",
        "Nach dem Import bietet der Launcher an, Einstellungen wie RAM oder Java mitzunehmen.",
      ],
      keywords: "import übernehmen prism multimc curseforge modrinth atlauncher gdlauncher nachimport erneut",
    },
    autofix: {
      title: "Autofix nach einem Absturz",
      summary: "Stürzt Minecraft ab, sucht der Launcher die Ursache und schlägt eine Lösung vor, z. B. fehlende Abhängigkeiten, falsches Java oder zu wenig RAM.",
      steps: [
        "Nach einem Absturz erscheint oben in der Instanz ein roter Hinweis „Absturz erkannt“.",
        "Klicke auf „Beheben“ bzw. „Probleme beheben“. Der Launcher zeigt, was er gefunden hat und was er ändern würde.",
        "Bestätige die Vorschläge. Vorher legt der Launcher automatisch eine Sicherung an.",
        "Starte das Spiel erneut. Hilft es nicht, öffne im Experten-Modus unter „Logs“ die „Diagnose“ für Details.",
        "Klappt es immer noch nicht, schicke über „Problem melden“ einen Fehlerbericht mit Logs.",
      ],
      tips: [
        "Häufigste Ursache: ein Mod passt nicht zur Minecraft-Version oder eine Abhängigkeit fehlt.",
        "Autofix kannst du jederzeit rückgängig machen: Die Sicherung findest du unter „Backups“.",
      ],
      keywords: "absturz crash fehler reparieren beheben diagnose logs startet nicht",
    },
    backups: {
      title: "Backups",
      summary: "Backups sichern Welten oder ganze Instanzen. So kannst du nach einem kaputten Update oder einem Fehler zurück.",
      steps: [
        "Öffne die Instanz und wechsle in den Bereich „Backups“ (nur im Experten-Modus).",
        "„Snapshot erstellen“ sichert Mods, Configs, Packs und Optionen, aber keine Welten. Ideal vor einem Update.",
        "Welten sicherst du im Bereich „Welten“: Rechtsklick auf die Welt → „Backup erstellen“. Sie erscheinen unter „Welt-Backups“.",
        "Zum Zurückspielen klickst du beim Snapshot bzw. Backup auf „Wiederherstellen“.",
        "Automatische Backups stellst du unter Einstellungen → Spiel → Backups ein, z. B. vor jedem Start.",
      ],
      tips: [
        "Automatische Backups zählen zur Aufbewahrungsgrenze, alte werden dann gelöscht.",
        "Autofix legt vor jeder Änderung selbst einen Snapshot an.",
      ],
      keywords: "sicherung backup wiederherstellen welt zurück",
    },
    hosting: {
      title: "Welt mit Freunden hosten",
      summary: "Mit dem Vibe Relay spielen Freunde ohne Portfreigabe in deiner Welt. Ein Play-Link lädt sie direkt mit dem passenden Modpack ein.",
      steps: [
        "Starte deine Instanz mit dem Vibey Client (Instanz-Einstellungen → Client).",
        "Öffne im Spiel deine Welt und wähle „Für Freunde öffnen“. Der Client verbindet sich mit dem Vibe Relay.",
        "Im Launcher erscheint eine Leiste „Du hostest …“ mit dem Play-Link. Kopiere ihn oder schicke ihn direkt an Freunde.",
        "Deine Freunde öffnen den Link. Ihr Launcher richtet das passende Modpack ein und verbindet sie direkt mit deiner Welt.",
        "Für einen Server, der auch ohne dich läuft, lege unter „Server“ einen eigenen Server an und wähle als Verbindung „Vibe Relay“.",
      ],
      tips: [
        "Hosting braucht Vibe (Einstellungen → Vibe & Konto). Vibe ist gerade in der Beta, siehe „Vibe-Beta-Warteliste“.",
        "Play-Links laufen ab, wenn du aufhörst zu hosten, spätestens nach 12 Stunden.",
      ],
      keywords: "freunde multiplayer relay einladen link play-link teilen lan hosten",
    },
    servers: {
      title: "Server verwalten",
      summary: "Du kannst eigene Minecraft-Server auf deinem PC anlegen, starten und verwalten, mit Konsole, Spielern, Welten und Add-ons.",
      steps: [
        "Öffne „Server“ in der Seitenleiste (im Experten-Modus).",
        "Klicke auf „Neuer Server“ und wähle Plattform (z. B. Paper, Fabric, NeoForge) und Version.",
        "Starte den Server. In der Konsole siehst du, was passiert, und kannst Befehle eingeben.",
        "Unter „Verbindung“ legst du fest, wie Freunde beitreten: lokal/LAN, Vibe Relay oder playit.gg.",
        "Unter „Spieler“ verwaltest du Whitelist, Operatoren und Banns, unter „Add-ons“ Plugins und Mods.",
      ],
      tips: ["Der Server läuft auf deinem PC. Er ist nur erreichbar, solange der PC an ist."],
      keywords: "server paper spigot konsole whitelist plugin verbindung",
    },
    skins: {
      title: "Skins und Cosmetics",
      summary: "Skins änderst du direkt im Launcher. Cosmetics wie Umhänge, Hüte und Emotes sehen andere Spieler mit dem Vibey Client.",
      steps: [
        "Öffne „Skins“ (im Simple-Modus über den Konto-Knopf oben rechts).",
        "Lade einen Skin hoch oder wähle einen aus deiner Bibliothek. Die 3D-Vorschau zeigt, wie er aussieht.",
        "Wähle zwischen klassischem und schmalem Modell und klicke auf „Übernehmen“.",
        "Für Cosmetics öffne „Cosmetics“ in der Seitenleiste, wähle Teile aus und speichere dein Outfit.",
      ],
      tips: [
        "Zum Ändern des Skins musst du mit deinem Microsoft-Konto angemeldet sein.",
        "Cosmetics brauchen Vibe und den Vibey Client in der Instanz.",
      ],
      keywords: "skin umhang cape cosmetics emote aussehen",
    },
    modsets: {
      title: "Mod-Sets",
      summary: "Ein Mod-Set ist eine Liste deiner Lieblings-Mods. Du kannst es auf jede Instanz anwenden, auch auf andere Versionen.",
      steps: [
        "Öffne „Bibliothek“ und dort oben „Mod-Sets“.",
        "Klicke auf „Neues Set“ oder übernimm die Mods einer bestehenden Instanz.",
        "Füge Mods hinzu, über die Suche oder per eingefügter Liste.",
        "Wende das Set über „Anwenden“ auf eine Instanz an. Der Launcher sucht passende Versionen für die jeweilige Minecraft-Version.",
      ],
      tips: ["Sets lassen sich exportieren und importieren, ideal zum Teilen mit Freunden."],
      keywords: "set liste sammlung lieblings mods anwenden",
    },
    gallery: {
      title: "Galerie und Clips",
      summary: "In der Galerie findest du alle Screenshots und Clips aus deinen Instanzen an einem Ort.",
      steps: [
        "Öffne „Galerie“ in der Seitenleiste (im Experten-Modus).",
        "Schalte oben zwischen „Screenshots“ und „Clips“ um. Clips nimmt der Vibey Client im Spiel auf.",
        "Filtere nach Instanz, um nur Bilder aus einem Spiel zu sehen.",
        "Klicke auf ein Bild oder einen Clip, um ihn groß anzusehen, zu kopieren oder den Ordner zu öffnen.",
      ],
      tips: ["Screenshots machst du im Spiel mit F2."],
      keywords: "screenshot bild video clip galerie aufnahme",
    },
    waitlist: {
      title: "Vibe-Beta-Warteliste",
      summary: "Vibe (Freunde, Chat, Hosting, Cosmetics, Vibey Client) ist in der Beta. Zum Mitmachen trittst du einer Warteliste bei, das Team schaltet dich frei.",
      steps: [
        "Öffne Einstellungen → Vibe & Konto.",
        "Melde dich mit deinem Minecraft-Konto bei Vibe an.",
        "Tritt der Warteliste bei. Dein Status steht danach in diesem Bereich.",
        "Sobald das Team dich freischaltet, funktionieren Freunde, Hosting, Cosmetics und der Vibey Client.",
      ],
      tips: [
        "Der Launcher selbst funktioniert auch ohne Vibe voll: Instanzen, Mods, Modpacks und Server.",
        "Wer schon vor der Beta dabei war, ist automatisch freigeschaltet.",
      ],
      keywords: "beta warteliste freischalten zugang vibe konto anmelden",
    },
    bedrock: {
      title: "Bedrock (experimentell)",
      summary: "Neben Java kann der Launcher auch Minecraft Bedrock starten und Add-ons, Welten und Sicherungen verwalten. Die Funktion ist noch experimentell.",
      steps: [
        "Installiere Minecraft Bedrock vorher über den Microsoft Store oder die Xbox-App.",
        "Klicke auf „Neue Instanz“ und wähle den Reiter „Bedrock“.",
        "Wähle Release oder Preview und ob die Instanz eigene Spieldaten bekommen soll.",
        "In der Bedrock-Instanz verwaltest du Add-ons, Welten und Sicherungen. Mit „Spielen“ startest du das installierte Spiel.",
      ],
      tips: [
        "Bedrock-Instanzen erkennst du am Kürzel „BE“.",
        "Versionswahl, Java-Mods und Play-Links gibt es für Bedrock nicht.",
      ],
      keywords: "bedrock windows edition xbox addon store experimentell",
    },
    feedback: {
      title: "Feedback senden",
      summary: "Etwas funktioniert nicht oder du hast eine Idee? Schick es direkt aus dem Launcher an das Team.",
      steps: [
        "Klicke oben rechts auf das Feedback-Symbol (Sprechblase mit Ausrufezeichen).",
        "Wähle, ob es ein Fehler, eine Idee oder etwas anderes ist, und beschreibe es kurz.",
        "Bei Fehlern kannst du Logs und einen Screenshot anhängen. Das hilft beim Finden der Ursache.",
        "Klicke auf „Senden“. Du bekommst eine Ticket-Nummer. Gib sie an, wenn du uns dazu auf Discord schreibst.",
      ],
      tips: ["Nach einem Absturz gibt es den Knopf „Problem melden“, der die passenden Logs schon mitnimmt."],
      keywords: "feedback fehler bug melden idee vorschlag support ticket",
    },
    performance: {
      title: "Leistung und RAM einstellen",
      summary: "Wie viel Arbeitsspeicher (RAM) Minecraft bekommt, stellst du für alle Instanzen oder für eine einzelne Instanz ein.",
      steps: [
        "Für alle Instanzen: Einstellungen → Java & Speicher → Arbeitsspeicher (im Experten-Modus).",
        "Für eine Instanz: Instanz öffnen → Zahnrad (Instanz-Einstellungen) → Java → „Eigene Werte“.",
        "Faustregel: Vanilla 2–4 GB, mit Mods 4–6 GB, große Modpacks 6–8 GB.",
        "Gib nie mehr als etwa drei Viertel deines RAMs. Windows und andere Programme brauchen auch Speicher.",
        "Ruckelt es trotzdem, helfen Leistungs-Mods wie Sodium. Der Launcher schlägt sie im Bereich „Inhalte“ vor.",
      ],
      tips: [
        "Im Simple-Modus wählst du die Leistungsstufe in den Instanz-Einstellungen statt genauer Zahlen.",
        "Zu viel RAM kann das Spiel sogar langsamer machen.",
      ],
      keywords: "ram speicher arbeitsspeicher leistung fps ruckeln langsam java memory",
    },
  },
  tours: {
    intro: {
      title: "Kurze Einführung",
      steps: [
        {
          title: "Hier startest du dein Spiel",
          text: "Ein Klick auf „Spielen“ startet dein zuletzt gespieltes Spiel. Alles Nötige lädt der Launcher selbst.",
          variants: {
            "new-game": { title: "Neues Spiel erstellen", text: "Wähle einfach, was du vorhast. Version und Einrichtung übernimmt der Launcher." },
            "new-instance": { title: "Neues Spiel erstellen", text: "Wähle einfach, was du vorhast. Version und Einrichtung übernimmt der Launcher." },
          },
        },
        { title: "Meine Spiele", text: "Alle deine Spiele auf einen Blick. Dort fügst du Mods hinzu, siehst deine Welten oder behebst Probleme." },
        { title: "Entdecken", text: "Mods, Texturpakete, Shader und Modpacks finden. Sie landen direkt im gewählten Spiel." },
        { title: "Dein Konto", text: "Hier wechselst du Konten und Skins und schaltest jederzeit in den Experten-Modus." },
        { title: "Hilfe & Anleitungen", text: "Hier findest du jederzeit Schritt-für-Schritt-Anleitungen und weitere Touren." },
      ],
    },
    "first-instance": {
      title: "Erste Instanz",
      steps: [
        { title: "Neue Instanz", text: "Über dieses Plus legst du jederzeit eine neue Instanz an, egal auf welcher Seite du bist." },
        { title: "Oder direkt in der Bibliothek", text: "Hier geht es auch. Danach wählst du Version und Loader, den Rest lädt der Launcher." },
        { title: "Schon einen anderen Launcher?", text: "Mit „Importieren“ übernimmst du deine bestehenden Instanzen mit Welten und Einstellungen." },
        { title: "Deine Bibliothek", text: "Alle Instanzen findest du hier. Klick auf eine Instanz, um Mods, Welten und Einstellungen zu sehen." },
      ],
    },
    modpack: {
      title: "Modpack installieren",
      steps: [
        { title: "Entdecken", text: "Hier findest du Mods und Modpacks von Modrinth und CurseForge." },
        { title: "Typ wählen", text: "„Modpacks“ ist schon ausgewählt. Hier wechselst du auch zu Mods, Shadern oder Texturpaketen." },
        { title: "Suchen", text: "Gib den Namen des Modpacks ein. Links kannst du nach Version, Loader und Kategorie filtern." },
        { title: "Installieren", text: "Öffne ein Modpack und klicke auf „Installieren“. Es entsteht eine neue Instanz mit allem Drum und Dran." },
      ],
    },
    mods: {
      title: "Mods verwalten",
      steps: [
        { title: "Inhalte hinzufügen", text: "Öffnet „Entdecken“, schon passend gefiltert auf die Version und den Loader dieser Instanz." },
        { title: "Eigene Dateien", text: "Hast du eine .jar-Datei? Füge sie hier hinzu oder ziehe sie einfach ins Fenster." },
        {
          title: "Updates",
          text: "Es gibt Updates. Ein Klick aktualisiert alle Mods auf einmal.",
          variants: { "content-refresh": { title: "Nach Updates suchen", text: "„Neu prüfen“ (oder F5) sucht nach Updates und Problemen. Gibt es welche, erscheint daneben „Alle aktualisieren“." } },
        },
        { title: "Deine Inhalte", text: "Mit dem Schalter in jeder Zeile schaltest du einen Mod aus, ohne ihn zu löschen." },
      ],
    },
    import: {
      title: "Import",
      steps: [
        { title: "Importieren", text: "Hier übernimmst du Modpack-Dateien oder ganze Instanzen aus anderen Launchern." },
        { title: "Datei oder Launcher", text: "„Aus anderem Launcher“ sucht automatisch nach Modrinth App, CurseForge, Prism, MultiMC und weiteren." },
        { title: "Auswählen", text: "Hake die Instanzen an und klicke auf „Importieren“. Fehlt dein Launcher, wähle seinen Ordner selbst." },
        { title: "Nachimportieren", text: "Neue Instanzen im alten Launcher? Öffne den Import einfach wieder. Schon übernommene sind markiert." },
      ],
    },
    autofix: {
      title: "Autofix",
      steps: [
        {
          title: "Probleme beheben",
          text: "Ein Klick und der Launcher sucht die Ursache, zeigt seine Vorschläge und legt vorher eine Sicherung an.",
          variants: {
            "crash-banner": { title: "Absturz erkannt", text: "Nach einem Absturz erscheint hier dieser Hinweis mit der wahrscheinlichsten Ursache. „Beheben“ repariert das Spiel automatisch." },
            "logs-diagnose": { title: "Diagnose", text: "Nach einem Absturz erscheint oben ein roter Hinweis mit „Beheben“. Hier in der Diagnose siehst du Details und startest ebenfalls „Probleme beheben“." },
          },
        },
        { title: "Neu starten", text: "Danach einfach wieder auf „Spielen“. Der Launcher prüft vor dem Start erneut." },
        { title: "Hilft nichts?", text: "Dann schick uns über Feedback einen Fehlerbericht. Logs hängen wir auf Wunsch an." },
      ],
    },
    backups: {
      title: "Backups",
      steps: [
        { title: "Snapshot erstellen", text: "Sichert Mods, Configs und Packs dieser Instanz, z. B. vor einem großen Update. Welten sicherst du im Bereich „Welten“." },
        { title: "Deine Sicherungen", text: "Hier stehen Snapshots und Welt-Backups. Mit „Wiederherstellen“ gehst du zurück." },
        { title: "Automatisch sichern", text: "In den Einstellungen legst du fest, wann der Launcher selbst sichert und wie viele Backups er behält." },
      ],
    },
    hosting: {
      title: "Mit Freunden spielen",
      steps: [
        { title: "Deine Welten", text: "Starte die Welt mit dem Vibey Client und wähle im Spiel „Für Freunde öffnen“. Der Vibe Relay erledigt den Rest." },
        { title: "Play-Link", text: "Solange du hostest, steht hier dein Play-Link. Kopiere ihn oder schick ihn direkt an Freunde." },
        { title: "Freunde", text: "Hier siehst du, wer online ist, und lädst Freunde direkt in deine Welt ein." },
        { title: "Eigener Server", text: "Soll die Welt auch ohne dich laufen? Lege einen Server an und wähle als Verbindung „Vibe Relay“." },
      ],
    },
    servers: {
      title: "Server",
      steps: [
        { title: "Neuer Server", text: "Wähle Plattform und Version. Der Launcher lädt den Server herunter und richtet ihn ein." },
        { title: "Deine Server", text: "Öffne einen Server für Konsole, Spieler, Welten, Add-ons und die Verbindung für Freunde." },
        { title: "Immer erreichbar", text: "Hier findest du deine Server jederzeit wieder. Ein grüner Punkt zeigt, dass einer läuft." },
      ],
    },
    skins: {
      title: "Skins",
      steps: [
        { title: "Vorschau", text: "So sieht dein Skin gerade aus. Ziehe die Figur, um sie zu drehen." },
        { title: "Deine Skins", text: "Lade neue Skins hoch oder wähle einen gespeicherten aus und übernimm ihn." },
        { title: "Cosmetics", text: "Umhänge, Hüte und Emotes für den Vibey Client findest du hier." },
      ],
    },
    modsets: {
      title: "Mod-Sets",
      steps: [
        { title: "Neues Set", text: "Lege eine Liste deiner Lieblings-Mods an. Sie gilt für jede Version." },
        { title: "Importieren", text: "Sets von Freunden oder aus einer Datei übernimmst du hier." },
        { title: "Deine Sets", text: "Öffne ein Set, um Mods hinzuzufügen oder es auf eine Instanz anzuwenden." },
      ],
    },
    gallery: {
      title: "Galerie",
      steps: [
        { title: "Screenshots und Clips", text: "Schalte hier zwischen Bildern und den Clips des Vibey Clients um." },
        { title: "Nach Instanz filtern", text: "Zeige nur Bilder aus einer bestimmten Instanz." },
        { title: "Ansehen", text: "Klicke auf ein Bild, um es groß zu öffnen, zu kopieren oder im Ordner zu zeigen." },
      ],
    },
    waitlist: {
      title: "Vibe-Beta",
      steps: [
        { title: "Vibe & Konto", text: "Hier meldest du dich bei Vibe an. Vibe ist in der Beta, du trittst zuerst einer Warteliste bei." },
        { title: "Dein Zugang", text: "Hier siehst du deinen Status. Nach der Freischaltung funktionieren Freunde, Hosting und Cosmetics." },
      ],
    },
    feedback: {
      title: "Feedback",
      steps: [
        { title: "Feedback senden", text: "Fehler oder Idee? Hier schreibst du uns. Logs und ein Screenshot lassen sich anhängen." },
        { title: "Hilfe", text: "Und hier findest du alle Anleitungen und Touren, falls du nicht weiterweißt." },
      ],
    },
    performance: {
      title: "Leistung & RAM",
      steps: [
        { title: "Instanz-Einstellungen", text: "Über das Zahnrad öffnest du die Einstellungen dieser Instanz." },
        { title: "Leistung dieser Instanz", text: "Hier legst du fest, wie viel Arbeitsspeicher diese Instanz bekommt. Mit „Eigene Werte“ überschreibst du die Standardwerte." },
        { title: "Arbeitsspeicher für alle", text: "Diese Werte gelten für alle Instanzen ohne eigene Einstellung. Mit Mods sind 4–6 GB ein guter Start." },
      ],
    },
  },
};

export default de;
