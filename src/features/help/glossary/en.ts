import type { Glossary } from "./terms";

const en: Glossary = {
  instance: {
    title: "Instance (game)",
    text: "A separate Minecraft setup with its own version, mods and worlds. You can have as many as you like – they don't affect each other.",
    example: "For example one instance “Vanilla 1.21” and one “Modpack with friends”.",
  },
  modpack: {
    title: "Modpack",
    text: "A ready-made bundle of many mods that work together. The launcher creates it as a new instance and downloads everything automatically.",
    example: "A good start: Fabulously Optimized (faster, prettier, no gameplay changes).",
  },
  mod: {
    title: "Mod",
    text: "An add-on that changes Minecraft: new blocks, mobs, better performance or convenience. Mods need an instance with a mod loader.",
  },
  loader: {
    title: "Mod loader",
    text: "The foundation that loads mods in the first place. Every mod is made for one loader – Fabric mods don't run on Forge and vice versa. The launcher only shows you matching mods when installing.",
    example: "Not sure? Pick Fabric – it has the most new mods.",
  },
  vanilla: {
    title: "Vanilla",
    text: "Minecraft exactly as Mojang ships it – without mods. Resource packs and shaders still work.",
  },
  fabric: {
    title: "Fabric",
    text: "A lightweight, fast mod loader. Most mods for new Minecraft versions are here, including performance mods like Sodium.",
  },
  quilt: {
    title: "Quilt",
    text: "An offshoot of Fabric. Most Fabric mods run here too. Only needed if a mod explicitly asks for Quilt.",
  },
  forge: {
    title: "Forge",
    text: "The oldest mod loader. Many big modpacks and mods for older versions (up to 1.20) rely on it.",
  },
  neoforge: {
    title: "NeoForge",
    text: "The successor of Forge from Minecraft 1.20.2. Big new modpacks often use NeoForge.",
  },
  resourcepack: {
    title: "Resource pack",
    text: "Changes how blocks, items and menus look or sound. Needs no mods and works in every instance.",
  },
  shader: {
    title: "Shader",
    text: "Takes light, shadows and water to a new level. Needs an instance with Iris or OptiFine and a good graphics card.",
  },
  datapack: {
    title: "Data pack",
    text: "Changes game rules, recipes or world generation without mods. Data packs always belong to a specific world.",
  },
  ram: {
    title: "Memory (RAM)",
    text: "How much memory Minecraft may use. Too little causes stutter or crashes, too much slows down the rest of your PC. The launcher picks a good value automatically.",
    example: "Rule of thumb: 2–4 GB without mods, 4–8 GB for big modpacks.",
  },
  java: {
    title: "Java",
    text: "The software Minecraft: Java Edition runs on. The launcher downloads the right Java version automatically – you don't need to install anything.",
  },
  snapshot: {
    title: "Snapshot",
    text: "A test version of Minecraft with features that aren't finished yet. May have bugs and can damage worlds – make a backup first.",
  },
  server: {
    title: "Server",
    text: "A computer that keeps a world running so others can join. To play together, “Host world” is usually enough – your own servers are in expert mode.",
  },
  backup: {
    title: "Backup",
    text: "A copy of your world or instance. If something goes wrong, it brings back the old state.",
  },
  vibe: {
    title: "Vibe",
    text: "The launcher's online services: friends, chat, playing worlds together and cosmetics. Optional and can be turned off any time.",
  },
  account: {
    title: "Microsoft account",
    text: "Minecraft: Java Edition is tied to your Microsoft account. Sign-in happens directly at Microsoft – the launcher never sees your password.",
  },
  dependency: {
    title: "Dependency",
    text: "A mod that another mod needs in order to work, for example Fabric API. Vibe installs dependencies automatically and tells you when no mod needs them anymore.",
    example: "Mod Menu needs Fabric API – without Fabric API, Mod Menu won't start.",
  },
  portable: {
    title: "Portable",
    text: "A portable launcher needs no installation. It stores everything in the “VibeData” folder right next to it, for example on a USB stick, and leaves the PC unchanged.",
    example: "Plug in the stick, start vibe-launcher.exe, keep playing – on another PC too.",
  },
  telemetry: {
    title: "Telemetry",
    text: "Usage data sent automatically, for example which buttons you click or how often you play. Vibe Launcher doesn't collect anything like that.",
  },
};

export default en;
