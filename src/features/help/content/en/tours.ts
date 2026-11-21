import type { HelpContent } from "../../types";

export const tours: HelpContent["tours"] = {
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
      { title: "Your worlds", text: "Your worlds live here. To play with friends, turn one into your own server under “Servers”, with the Vibe Relay as connection." },
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
      { title: "Filter by instance", text: "Only show pictures from a specific instance." },
      { title: "View", text: "Click a picture to open it large, copy it or show it in its folder." },
    ],
  },
  waitlist: {
    title: "Vibe beta",
    steps: [
      { title: "Vibe & account", text: "Sign in to Vibe here. Vibe is in beta, you join a waitlist first." },
      { title: "Your access", text: "Your status is shown here. Once approved, friends, chat and hosting work." },
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
  privacy: {
    title: "Privacy",
    steps: [
      { title: "Privacy", text: "Everything about what the launcher sends, and how to turn it off." },
      { title: "What goes where", text: "Every service, what it receives and when. Our promise is at the top." },
    ],
  },
};
