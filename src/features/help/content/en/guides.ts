import type { HelpContent } from "../../types";

export const guides: HelpContent["guides"] = {
  "first-instance": {
    title: "Create your first instance",
    summary: "An instance is its own Minecraft with its own version, mods and worlds. You can have as many as you like.",
    steps: [
      "Click “+ New instance” in the sidebar or “New instance” on the home page.",
      "Pick what you want to do: vanilla, with mods, a modpack or an import. In Simple mode one click on a goal is enough.",
      "Give the instance a name and choose the Minecraft version. For mods, also pick a loader (Fabric, NeoForge, Forge or Quilt).",
      "Click “Create”. The launcher downloads Minecraft, Java and the loader by itself. Progress shows up in the tasks at the top right.",
      "Once the instance is ready, start it with “Play”.",
    ],
    tips: [
      "Sign in with your Microsoft account first (account button at the top right), otherwise you can't play online.",
      "Not sure which loader you need? Pick Fabric. Most current mods support it.",
    ],
    keywords: "new create version loader fabric forge vanilla game",
  },
  modpack: {
    title: "Install a modpack",
    summary: "A modpack is a ready-made collection of mods. The launcher creates a new instance for it and installs everything automatically.",
    steps: [
      "Open “Discover” in the sidebar.",
      "Choose the type “Modpacks” at the top.",
      "Search for the modpack's name or browse with the filters on the left.",
      "Open the modpack and click “Install”. A new instance named after the modpack is created.",
      "Wait until the installation is done (tasks at the top right), then click “Play”.",
    ],
    tips: [
      "You can also drag modpack files (.mrpack, CurseForge .zip) straight into the launcher window.",
      "If there's an update, the instance shows a notice. Your worlds are kept when updating.",
    ],
    keywords: "modrinth curseforge mrpack pack collection",
  },
  mods: {
    title: "Add and update mods",
    summary: "Add mods, resource packs and shaders right inside an instance. The launcher checks for updates for you.",
    steps: [
      "Open the instance in your library and stay in the “Content” area.",
      "Click “Add content”. “Discover” opens, filtered to the matching version and loader.",
      "Click “Install” on a mod. Required dependencies are downloaded too.",
      "Add your own .jar files with “Add files” or drag them into the window.",
      "“Check again” (or F5) looks for updates. If there are any, update them with “Update all”.",
    ],
    tips: [
      "Use the switch in the list to turn single mods off without deleting them.",
      "A backup of the instance is worth it before big updates.",
    ],
    keywords: "mod jar update shader resource pack texture add",
  },
  import: {
    title: "Import from another launcher",
    summary: "Bring over instances from other launchers, e.g. the Modrinth App, CurseForge, Prism, MultiMC, ATLauncher, GDLauncher or the official launcher.",
    steps: [
      "Click “Import” in the library or on the home page.",
      "Choose “From another launcher” at the top. The launcher looks for installed launchers by itself.",
      "If your launcher isn't found, click “Choose folder …” and pick its folder or the folder of a single instance.",
      "Tick the instances you want to bring over and click “Import”. Worlds, configs and settings come along.",
      "Importing more later: just open the import again. Instances you already brought over are marked “Already imported”, new ones can be added.",
    ],
    tips: [
      "Your old launcher stays untouched, everything is copied.",
      "Import single modpack files in “File” mode.",
      "After the import the launcher offers to take over settings like RAM or Java.",
    ],
    keywords: "import transfer prism multimc curseforge modrinth atlauncher gdlauncher again more",
  },
  autofix: {
    title: "Autofix after a crash",
    summary: "If Minecraft crashes, the launcher looks for the cause and suggests a fix, e.g. missing dependencies, the wrong Java or too little RAM.",
    steps: [
      "After a crash, a red “Crash detected” notice appears at the top of the instance.",
      "Click “Fix” or “Fix problems”. The launcher shows what it found and what it would change.",
      "Confirm the suggestions. The launcher creates a backup automatically first.",
      "Start the game again. If that doesn't help, open “Diagnosis” under “Logs” in Expert mode for details.",
      "Still stuck? Send a bug report with logs via “Report problem”.",
    ],
    tips: [
      "Most common cause: a mod doesn't match the Minecraft version or a dependency is missing.",
      "You can always undo Autofix: the backup is under “Backups”.",
    ],
    keywords: "crash error repair fix diagnosis logs won't start",
  },
  backups: {
    title: "Backups",
    summary: "Backups save worlds or the setup of an instance, so you can go back after a broken update or a mistake.",
    steps: [
      "Open the instance and switch to the “Backups” area.",
      "“Create snapshot” saves mods, configs, packs and options, but no worlds. Ideal before an update.",
      "Back up worlds in the “Worlds” area: right-click the world → “Create backup”. They show up under “World backups”.",
      "To go back, click “Restore” on the snapshot or backup.",
      "Set up automatic backups under Settings → Game → Backups, e.g. before every start.",
    ],
    tips: [
      "Automatic backups count toward the retention limit, old ones are deleted.",
      "Autofix creates a snapshot by itself before every change.",
    ],
    keywords: "backup restore world snapshot undo",
  },
  hosting: {
    title: "Play with friends",
    summary: "With your own server and the Vibe Relay, friends play with you without port forwarding. If you get a play link, the launcher sets up the right modpack.",
    steps: [
      "Open “Servers” in the sidebar and click “New server”. You can take over a singleplayer world as the server world.",
      "Choose “Vibe Relay” as the connection. Then it works without port forwarding.",
      "Start the server and invite friends directly from “Friends”.",
      "Got a play link from someone? Just open it. The launcher sets up the right modpack and connects you.",
    ],
    tips: ["Hosting needs Vibe (Settings → Vibe & account). Vibe is in beta right now, see “Vibe beta waitlist”."],
    keywords: "friends multiplayer relay invite link play link share lan host",
  },
  servers: {
    title: "Manage servers",
    summary: "Create, start and manage your own Minecraft servers on your PC, with console, players, worlds and add-ons.",
    steps: [
      "Open “Servers” in the sidebar (Expert mode).",
      "Click “New server” and pick a platform (e.g. Paper, Fabric, NeoForge) and version.",
      "Start the server. The console shows what's happening and lets you enter commands.",
      "Under “Connection” you choose how friends join: local/LAN, Vibe Relay or playit.gg.",
      "Manage whitelist, operators and bans under “Players”, plugins and mods under “Add-ons”.",
    ],
    tips: ["The server runs on your PC. It's only reachable while your PC is on."],
    keywords: "server paper spigot console whitelist plugin connection",
  },
  skins: {
    title: "Skins",
    summary: "Change your skin right in the launcher, with a 3D preview and your own skin library.",
    steps: [
      "Open “Skins” in the sidebar or via the account button at the top right.",
      "Upload a skin or pick one from your library. The 3D preview shows how it looks.",
      "Choose between the classic and slim model and click “Apply”.",
    ],
    tips: ["To change your skin you need to be signed in with your Microsoft account."],
    keywords: "skin cape look",
  },
  modsets: {
    title: "Mod sets",
    summary: "A mod set is a list of your favourite mods. Apply it to any instance, even on other versions.",
    steps: [
      "Open “Library” and then “Mod sets” at the top.",
      "Click “New set” or take the mods of an existing instance.",
      "Add mods via search or by pasting a list.",
      "Apply the set to an instance with “Apply”. The launcher finds matching versions for that Minecraft version.",
    ],
    tips: ["Sets can be exported and imported, great for sharing with friends."],
    keywords: "set list collection favourite mods apply",
  },
  gallery: {
    title: "Gallery",
    summary: "The gallery collects all screenshots from your instances in one place.",
    steps: [
      "Open “Gallery” in the sidebar.",
      "Filter by instance to only see pictures from one game.",
      "Click a picture to view it large, copy it or open its folder.",
    ],
    tips: ["Take screenshots in game with F2."],
    keywords: "screenshot picture gallery capture",
  },
  waitlist: {
    title: "Vibe beta waitlist",
    summary: "Vibe (friends, chat, hosting) is in beta. To take part you join a waitlist and the team lets you in.",
    steps: [
      "Open Settings → Vibe & account.",
      "Sign in to Vibe with your Minecraft account.",
      "Join the waitlist. Your status is shown in this section afterwards.",
      "As soon as the team approves you, friends, chat and hosting work.",
    ],
    tips: [
      "The launcher itself works fully without Vibe: instances, mods, modpacks and servers.",
      "If you were here before the beta, you're approved automatically.",
    ],
    keywords: "beta waitlist approve access vibe account sign in",
  },
  bedrock: {
    title: "Bedrock (experimental)",
    summary: "Besides Java, the launcher can start Minecraft Bedrock and manage add-ons, worlds and backups. This feature is still experimental.",
    steps: [
      "Install Minecraft Bedrock first via the Microsoft Store or the Xbox app.",
      "Click “New instance” and choose the “Bedrock” tab.",
      "Choose Release or Preview and whether the instance gets its own game data.",
      "In the Bedrock instance you manage add-ons, worlds and backups. “Play” starts the installed game.",
    ],
    tips: [
      "Bedrock instances are marked “BE”.",
      "Version selection, Java mods and play links aren't available for Bedrock.",
    ],
    keywords: "bedrock windows edition xbox addon store experimental",
  },
  feedback: {
    title: "Send feedback",
    summary: "Something doesn't work or you have an idea? Send it to the team right from the launcher.",
    steps: [
      "Click the feedback icon at the top right (speech bubble with an exclamation mark).",
      "Choose whether it's a bug, an idea or something else, and describe it briefly.",
      "For bugs you can attach logs and a screenshot. That helps finding the cause.",
      "Click “Send”. You get a ticket number. Mention it if you write to us about it on Discord.",
    ],
    tips: ["After a crash there's a “Report problem” button that already includes the right logs."],
    keywords: "feedback bug report idea suggestion support ticket",
  },
  performance: {
    title: "Performance and RAM",
    summary: "Set how much memory (RAM) Minecraft gets, for all instances or for a single one.",
    steps: [
      "For all instances: Settings → Java & memory (in Simple mode: Memory).",
      "For one instance: open the instance → gear (instance settings) → Java → “Custom values”.",
      "Rule of thumb: vanilla 2–4 GB, with mods 4–6 GB, big modpacks 6–8 GB.",
      "Never give more than about three quarters of your RAM. Windows and other programs need memory too.",
      "Still laggy? Performance mods like Sodium help. The launcher suggests them in the “Content” area.",
    ],
    tips: [
      "In Simple mode you pick a performance level in the instance settings instead of exact numbers.",
      "Too much RAM can even make the game slower.",
    ],
    keywords: "ram memory performance fps lag slow java",
  },
  privacy: {
    title: "Privacy & transparency",
    summary: "Vibe Launcher shows no ads and collects no telemetry. Here's what it sends where and when, and how to turn it off.",
    steps: [
      "Open Settings → Privacy. Our promise is at the top: no ads, no telemetry, Vibe only with your consent.",
      "Under “Your switches” you set update checks, Discord status, MinecraftCapes and your online status.",
      "“What is sent where” lists every service, what it receives and when that happens.",
      "Error reports are only sent after you've reviewed them and clicked “Send”. Logs are cleaned first.",
    ],
    tips: [
      "Vibe services are off on a new install. You turn them on during setup or under Settings → Vibe & account.",
      "Your sign-in data is kept in the Windows vault (Credential Manager), not in files.",
    ],
    keywords: "privacy data telemetry tracking ads send gdpr transparency",
  },
  portable: {
    title: "Portable mode (USB stick)",
    summary: "The launcher can run from a USB stick without installing. All data is then kept in the “VibeData” folder next to the file.",
    steps: [
      "Open Settings → General and click “Create portable copy …” under “Portable mode”.",
      "Pick a folder on your USB stick. The launcher copies itself there and puts a “portable.txt” file next to it.",
      "On the other PC, start “vibe-launcher.exe” from the stick. Sign in with Microsoft once there.",
      "On PCs that aren't yours, turn on “Sign out of this PC when closing”. Then no sign-in data stays behind.",
    ],
    tips: [
      "Sign-in data is never stored on the stick. If you lose it, nobody can get into your account with it.",
      "The portable launcher doesn't update itself. Just create the portable copy again from the new launcher into the same folder; your data is kept.",
      "Without the button: copy vibe-launcher.exe into a folder and create an empty file called “portable.txt” next to it.",
    ],
    keywords: "portable usb stick no install take along school other pc",
  },
};
