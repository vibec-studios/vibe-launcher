import type { Glossary } from "./terms";

const de: Glossary = {
  instance: {
    title: "Instanz (Spiel)",
    text: "Eine eigene Minecraft-Einrichtung mit eigener Version, eigenen Mods und eigenen Welten. Du kannst beliebig viele haben – sie stören sich nicht gegenseitig.",
    example: "Zum Beispiel eine Instanz „Vanilla 1.21“ und eine „Modpack mit Freunden“.",
  },
  modpack: {
    title: "Modpack",
    text: "Ein fertiges Paket aus vielen Mods, die zusammenpassen. Der Launcher legt es als neue Instanz an und lädt alles automatisch herunter.",
    example: "Gut für den Einstieg: Fabulously Optimized (schneller, schöner, ohne Spieländerungen).",
  },
  mod: {
    title: "Mod",
    text: "Eine Erweiterung, die Minecraft verändert: neue Blöcke, Mobs, bessere Leistung oder Komfort. Mods brauchen eine Instanz mit Mod-Loader.",
  },
  loader: {
    title: "Mod-Loader",
    text: "Der Unterbau, der Mods überhaupt erst lädt. Jede Mod ist für einen bestimmten Loader gemacht – Fabric-Mods laufen nicht mit Forge und umgekehrt. Der Launcher zeigt dir beim Installieren nur passende Mods.",
    example: "Unsicher? Nimm Fabric – dafür gibt es die meisten neuen Mods.",
  },
  vanilla: {
    title: "Vanilla",
    text: "Minecraft genau so, wie Mojang es ausliefert – ohne Mods. Texturpakete und Shader gehen trotzdem.",
  },
  fabric: {
    title: "Fabric",
    text: "Ein schlanker, schneller Mod-Loader. Für neue Minecraft-Versionen gibt es hier die meisten Mods, auch Leistungs-Mods wie Sodium.",
  },
  quilt: {
    title: "Quilt",
    text: "Ein Ableger von Fabric. Die meisten Fabric-Mods laufen auch hier. Nur nötig, wenn eine Mod ausdrücklich Quilt verlangt.",
  },
  forge: {
    title: "Forge",
    text: "Der älteste Mod-Loader. Viele große Modpacks und Mods für ältere Versionen (bis 1.20) setzen darauf.",
  },
  neoforge: {
    title: "NeoForge",
    text: "Der Nachfolger von Forge ab Minecraft 1.20.2. Große neue Modpacks nutzen oft NeoForge.",
  },
  resourcepack: {
    title: "Texturpaket",
    text: "Ändert, wie Blöcke, Gegenstände und Menüs aussehen oder klingen. Braucht keine Mods und funktioniert in jeder Instanz.",
  },
  shader: {
    title: "Shader",
    text: "Bringt Licht, Schatten und Wasser auf ein neues Niveau. Braucht eine Instanz mit Iris oder OptiFine und eine gute Grafikkarte.",
  },
  datapack: {
    title: "Datapack",
    text: "Ändert Spielregeln, Rezepte oder Welt-Erzeugung ohne Mods. Datapacks gehören immer zu einer bestimmten Welt.",
  },
  ram: {
    title: "Arbeitsspeicher (RAM)",
    text: "So viel Speicher darf Minecraft benutzen. Zu wenig führt zu Rucklern oder Abstürzen, zu viel bremst den Rest des PCs. Der Launcher wählt automatisch einen guten Wert.",
    example: "Faustregel: 2–4 GB ohne Mods, 4–8 GB für große Modpacks.",
  },
  java: {
    title: "Java",
    text: "Die Software, mit der Minecraft: Java Edition läuft. Der Launcher lädt die richtige Java-Version automatisch – du musst nichts installieren.",
  },
  snapshot: {
    title: "Snapshot",
    text: "Eine Testversion von Minecraft mit Funktionen, die noch nicht fertig sind. Kann Fehler haben und Welten beschädigen – vorher eine Sicherung anlegen.",
  },
  server: {
    title: "Server",
    text: "Ein Rechner, auf dem eine Welt dauerhaft läuft, damit andere beitreten können. Zum gemeinsamen Spielen reicht meist „Welt hosten“ – eigene Server gibt es im Experten-Modus.",
  },
  backup: {
    title: "Backup (Sicherung)",
    text: "Eine Kopie deiner Welt oder Instanz. Geht etwas schief, holst du damit den alten Stand zurück.",
  },
  vibe: {
    title: "Vibe",
    text: "Die Online-Dienste des Launchers: Freunde, Chat, gemeinsam Welten spielen und Cosmetics. Freiwillig und jederzeit abschaltbar.",
  },
  account: {
    title: "Microsoft-Konto",
    text: "Minecraft: Java Edition ist an dein Microsoft-Konto gebunden. Die Anmeldung läuft direkt bei Microsoft – der Launcher sieht dein Passwort nie.",
  },
  dependency: {
    title: "Abhängigkeit",
    text: "Eine Mod, die eine andere Mod zum Laufen braucht, zum Beispiel Fabric API. Vibe installiert Abhängigkeiten automatisch mit und sagt dir, wenn keine Mod sie mehr braucht.",
    example: "Mod Menu braucht Fabric API – ohne Fabric API startet Mod Menu nicht.",
  },
  portable: {
    title: "Portabel",
    text: "Ein portabler Launcher braucht keine Installation. Er speichert alles im Ordner „VibeData“ direkt neben sich, zum Beispiel auf einem USB-Stick, und lässt den PC unverändert.",
    example: "Stick einstecken, vibe-launcher.exe starten, weiterspielen – auch an einem anderen PC.",
  },
  telemetry: {
    title: "Telemetrie",
    text: "Automatisch gesendete Nutzungsdaten, zum Beispiel welche Knöpfe du klickst oder wie oft du spielst. Der Vibe Launcher sammelt so etwas nicht.",
  },
};

export default de;
