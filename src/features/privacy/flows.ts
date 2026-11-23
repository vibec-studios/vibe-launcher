export type FlowGroup = "needed" | "auto" | "click" | "images";

export interface Flow {
  id: string;
  group: FlowGroup;
  hosts: string[];
  switchKey?: string;
}

export const FLOW_GROUPS: FlowGroup[] = ["needed", "auto", "click", "images"];

export const FLOWS: Flow[] = [
  { id: "microsoft", group: "needed", hosts: ["login.microsoftonline.com", "*.xboxlive.com", "api.minecraftservices.com", "sessionserver.mojang.com", "piston-meta.mojang.com", "libraries.minecraft.net", "resources.download.minecraft.net", "textures.minecraft.net"] },
  { id: "loaders", group: "needed", hosts: ["meta.fabricmc.net", "maven.fabricmc.net", "meta.quiltmc.org", "maven.minecraftforge.net", "maven.neoforged.net"] },
  { id: "java", group: "needed", hosts: ["piston-meta.mojang.com", "api.adoptium.net"], switchKey: "privacy.f.java.switch" },
  { id: "mods", group: "needed", hosts: ["api.modrinth.com", "cdn.modrinth.com", "api.curseforge.com", "edge.forgecdn.net"] },
  { id: "servers", group: "needed", hosts: [] },
  { id: "serversw", group: "needed", hosts: ["fill.papermc.io", "api.purpurmc.org", "hangar.papermc.io"] },
  { id: "github", group: "auto", hosts: ["github.com"], switchKey: "privacy.sw.updates" },
  { id: "vibe", group: "auto", hosts: ["vibe.axolite.app"], switchKey: "privacy.sw.vibe" },
  { id: "discord", group: "auto", hosts: ["Discord-App"], switchKey: "privacy.sw.discord" },
  { id: "capes", group: "auto", hosts: ["api.minecraftcapes.net"], switchKey: "privacy.sw.capes" },
  { id: "vibefix", group: "auto", hosts: ["github.com"], switchKey: "vibefix.setting" },
  { id: "hosting", group: "auto", hosts: ["relay.axolite.cc", "api.playit.gg"] },
  { id: "feedback", group: "click", hosts: ["vibe.axolite.app"] },
  { id: "mclogs", group: "click", hosts: ["api.mclo.gs"] },
  { id: "share", group: "click", hosts: ["vibe.axolite.app"] },
  { id: "shots", group: "click", hosts: ["vibe.axolite.app"] },
  { id: "feed", group: "auto", hosts: ["vibe.axolite.app"], switchKey: "feed.switch" },
  { id: "cloud", group: "click", hosts: ["vibe.axolite.app"] },
  { id: "discovery", group: "auto", hosts: ["vibe.axolite.app"] },
  { id: "heads", group: "images", hosts: ["mc-heads.net"] },
  { id: "web", group: "images", hosts: ["www.youtube-nocookie.com", "…"] },
];
