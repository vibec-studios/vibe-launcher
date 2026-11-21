import type { HelpContent } from "../types";

const en: HelpContent = {
  guides: {
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
        "Open the instance and switch to the “Backups” area (Expert mode only).",
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
      title: "Host a world with friends",
      summary: "With the Vibe Relay your friends can join your world without port forwarding. A play link invites them straight away with the right modpack.",
      steps: [
        "Start your instance with the Vibey Client (instance settings → Client).",
        "Open your world in game and choose “Open to friends”. The client connects to the Vibe Relay.",
        "The launcher shows a bar “You're hosting …” with the play link. Copy it or send it straight to friends.",
        "Your friends open the link. Their launcher sets up the matching modpack and connects them right into your world.",
        "For a server that keeps running without you, create one under “Servers” and pick “Vibe Relay” as connection.",
      ],
      tips: [
        "Hosting needs Vibe (Settings → Vibe & account). Vibe is in beta right now, see “Vibe beta waitlist”.",
        "Play links expire when you stop hosting, after 12 hours at the latest.",
      ],
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
      title: "Skins and cosmetics",
      summary: "Change your skin right in the launcher. Cosmetics like capes, hats and emotes are visible to other players with the Vibey Client.",
      steps: [
        "Open “Skins” (in Simple mode via the account button at the top right).",
        "Upload a skin or pick one from your library. The 3D preview shows how it looks.",
        "Choose between the classic and slim model and click “Apply”.",
        "For cosmetics, open “Cosmetics” in the sidebar, pick items and save your outfit.",
      ],
      tips: [
        "To change your skin you need to be signed in with your Microsoft account.",
        "Cosmetics need Vibe and the Vibey Client in the instance.",
      ],
      keywords: "skin cape cosmetics emote look",
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
      title: "Gallery and clips",
      summary: "The gallery collects all screenshots and clips from your instances in one place.",
      steps: [
        "Open “Gallery” in the sidebar (Expert mode).",
        "Switch between “Screenshots” and “Clips” at the top. Clips are recorded in game by the Vibey Client.",
        "Filter by instance to only see pictures from one game.",
        "Click a picture or clip to view it large, copy it or open its folder.",
      ],
      tips: ["Take screenshots in game with F2."],
      keywords: "screenshot picture video clip gallery recording",
    },
    waitlist: {
      title: "Vibe beta waitlist",
      summary: "Vibe (friends, chat, hosting, cosmetics, Vibey Client) is in beta. To take part you join a waitlist and the team lets you in.",
      steps: [
        "Open Settings → Vibe & account.",
        "Sign in to Vibe with your Minecraft account.",
        "Join the waitlist. Your status is shown in this section afterwards.",
        "As soon as the team approves you, friends, hosting, cosmetics and the Vibey Client work.",
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
        "For all instances: Settings → Java & memory → Memory (Expert mode).",
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
  },
  tours: {
    intro: {
      title: "Quick tour",
      steps: [
        {
          title: "Start your game here",
          text: "One click on “Play” starts your most recent game. The launcher downloads everything it needs.",
          variants: {
            "new-game": { title: "Create a new game", text: "Just pick what you want to do. The launcher takes care of version and setup." },
            "new-instance": { title: "Create a new game", text: "Just pick what you want to do. The launcher takes care of version and setup." },
          },
        },
        { title: "My games", text: "All your games at a glance. Add mods, see your worlds or fix problems there." },
        { title: "Discover", text: "Find mods, resource packs, shaders and modpacks. They go straight into the selected game." },
        { title: "Your account", text: "Switch accounts and skins here, and switch to Expert mode any time." },
        { title: "Help & guides", text: "Step-by-step guides and more tours are always here." },
      ],
    },
    "first-instance": {
      title: "First instance",
      steps: [
        { title: "New instance", text: "This plus creates a new instance at any time, whatever page you're on." },
        { title: "Or right in the library", text: "This works too. Then pick version and loader, the launcher downloads the rest." },
        { title: "Already using another launcher?", text: "“Import” brings over your existing instances with worlds and settings." },
        { title: "Your library", text: "All instances live here. Click one to see its mods, worlds and settings." },
      ],
    },
    modpack: {
      title: "Install a modpack",
      steps: [
        { title: "Discover", text: "Find mods and modpacks from Modrinth and CurseForge here." },
        { title: "Choose a type", text: "“Modpacks” is already selected. Switch to mods, shaders or resource packs here." },
        { title: "Search", text: "Enter the modpack's name. Filter by version, loader and category on the left." },
        { title: "Install", text: "Open a modpack and click “Install”. A new instance with everything included is created." },
      ],
    },
    mods: {
      title: "Manage mods",
      steps: [
        { title: "Add content", text: "Opens “Discover”, already filtered to this instance's version and loader." },
        { title: "Your own files", text: "Got a .jar file? Add it here or just drag it into the window." },
        {
          title: "Updates",
          text: "There are updates. One click updates all mods at once.",
          variants: { "content-refresh": { title: "Check for updates", text: "“Check again” (or F5) looks for updates and problems. If there are any, “Update all” appears next to it." } },
        },
        { title: "Your content", text: "The switch in each row turns a mod off without deleting it." },
      ],
    },
    import: {
      title: "Import",
      steps: [
        { title: "Import", text: "Bring over modpack files or whole instances from other launchers here." },
        { title: "File or launcher", text: "“From another launcher” automatically looks for the Modrinth App, CurseForge, Prism, MultiMC and more." },
        { title: "Select", text: "Tick the instances and click “Import”. If your launcher is missing, pick its folder yourself." },
        { title: "Import more later", text: "New instances in your old launcher? Just open the import again. Instances already imported are marked." },
      ],
    },
    autofix: {
      title: "Autofix",
      steps: [
        {
          title: "Fix problems",
          text: "One click and the launcher looks for the cause, shows its suggestions and creates a backup first.",
          variants: {
            "crash-banner": { title: "Crash detected", text: "After a crash this notice appears here with the most likely cause. “Fix” repairs the game automatically." },
            "logs-diagnose": { title: "Diagnosis", text: "After a crash a red notice with “Fix” appears at the top. Here in the diagnosis you see details and can start “Fix problems” too." },
          },
        },
        { title: "Start again", text: "Then just click “Play” again. The launcher checks once more before starting." },
        { title: "Nothing helps?", text: "Then send us a bug report via feedback. Logs can be attached." },
      ],
    },
    backups: {
      title: "Backups",
      steps: [
        { title: "Create snapshot", text: "Saves this instance's mods, configs and packs, e.g. before a big update. Back up worlds in the “Worlds” area." },
        { title: "Your backups", text: "Snapshots and world backups are listed here. “Restore” takes you back." },
        { title: "Automatic backups", text: "Choose in the settings when the launcher backs up by itself and how many backups it keeps." },
      ],
    },
    hosting: {
      title: "Play with friends",
      steps: [
        { title: "Your worlds", text: "Start the world with the Vibey Client and choose “Open to friends” in game. The Vibe Relay does the rest." },
        { title: "Play link", text: "While you're hosting, your play link shows here. Copy it or send it straight to friends." },
        { title: "Friends", text: "See who's online and invite friends right into your world." },
        { title: "Your own server", text: "Should the world keep running without you? Create a server and pick “Vibe Relay” as connection." },
      ],
    },
    servers: {
      title: "Servers",
      steps: [
        { title: "New server", text: "Pick a platform and version. The launcher downloads and sets up the server." },
        { title: "Your servers", text: "Open a server for console, players, worlds, add-ons and the connection for friends." },
        { title: "Always here", text: "Find your servers here any time. A green dot shows one is running." },
      ],
    },
    skins: {
      title: "Skins",
      steps: [
        { title: "Preview", text: "This is how your skin looks right now. Drag the character to rotate it." },
        { title: "Your skins", text: "Upload new skins or pick a saved one and apply it." },
        { title: "Cosmetics", text: "Capes, hats and emotes for the Vibey Client are here." },
      ],
    },
    modsets: {
      title: "Mod sets",
      steps: [
        { title: "New set", text: "Create a list of your favourite mods. It works for any version." },
        { title: "Import", text: "Take over sets from friends or from a file here." },
        { title: "Your sets", text: "Open a set to add mods or apply it to an instance." },
      ],
    },
    gallery: {
      title: "Gallery",
      steps: [
        { title: "Screenshots and clips", text: "Switch between pictures and the Vibey Client's clips here." },
        { title: "Filter by instance", text: "Only show pictures from a specific instance." },
        { title: "View", text: "Click a picture to open it large, copy it or show it in its folder." },
      ],
    },
    waitlist: {
      title: "Vibe beta",
      steps: [
        { title: "Vibe & account", text: "Sign in to Vibe here. Vibe is in beta, you join a waitlist first." },
        { title: "Your access", text: "Your status is shown here. Once approved, friends, hosting and cosmetics work." },
      ],
    },
    feedback: {
      title: "Feedback",
      steps: [
        { title: "Send feedback", text: "Bug or idea? Write to us here. Logs and a screenshot can be attached." },
        { title: "Help", text: "And here you'll find all guides and tours whenever you're stuck." },
      ],
    },
    performance: {
      title: "Performance & RAM",
      steps: [
        { title: "Instance settings", text: "The gear opens the settings of this instance." },
        { title: "Performance of this instance", text: "Set how much memory this instance gets. “Custom values” overrides the defaults." },
        { title: "Memory for all", text: "These values apply to all instances without their own setting. With mods, 4–6 GB is a good start." },
      ],
    },
  },
};

export default en;
