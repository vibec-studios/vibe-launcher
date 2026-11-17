// Mock-Handler Frontend-B (OWNER: Frontend-Agent B): Inhalte, Entdecken, Import/Export, Accounts.
// Datenbasis: einmalig abgerufene echte Modrinth-Suchergebnisse (gekürzt), daraus Paging, Projekte, Versionen.
import type {
  Account,
  ContentItem,
  ContentKind,
  ContentUpdate,
  ExportEntry,
  GalleryImage,
  Instance,
  MissingDownload,
  ProjectDetails,
  ProjectHit,
  ProjectType,
  ProjectVersion,
  SearchQuery,
  Source,
} from "@/lib/types";
import core, { instances } from "./core";
import { fakeTask, mockEmit, type Handlers } from "./util";

// [id, slug, title, description, author, icon, downloads, follows, categories, updated, loaders, versions, featured]
type Row = [string, string, string, string, string, string | null, number, number, string[], string, string[], string[], string | null];
// [id, name, number, game_versions, loaders, type, date, downloads, filename, size, changelog]
type VRow = [string, string, string, string[], string[], string, string, number, string, number, string];
interface Data {
  mod: Row[];
  modpack: Row[];
  resourcepack: Row[];
  shader: Row[];
  datapack: Row[];
  cats: Record<string, string[]>;
  sodium: { body: string; gallery: GalleryImage[]; links: ProjectDetails["links"]; license: string; published: string };
  sodiumVersions: VRow[];
}

const DATA: Data = {
  mod: [
    ["P7dR8mSH","fabric-api","Fabric API","Lightweight and modular API providing common hooks and intercompatibility measures utilized by mods using the Fabric toolchain.","modmuss50","https://cdn.modrinth.com/data/P7dR8mSH/icon.png",288624256,37892,["library"],"2026-11-11T13:44:04.147601+00:00",["fabric"],["1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],null],
    ["AANobbMI","sodium","Sodium","A high-performance rendering engine replacement for Minecraft, which greatly improves frame rates and reduces micro-stutter.","jellysquid3","https://cdn.modrinth.com/data/AANobbMI/295862f4724dc3f78df3447ad6072b2dcd3ef0c9_96.webp",253432494,42872,["optimization"],"2026-11-12T01:12:22.856079+00:00",["fabric","neoforge","quilt"],["1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],null],
    ["YL57xq9U","iris","Iris Shaders","A modern shader pack loader for Minecraft intended to be compatible with existing OptiFine shader packs","coderbot","https://cdn.modrinth.com/data/YL57xq9U/18d0e7f076d3d6ed5bedd472b853909aac5da202_96.webp",195604048,30781,["decoration","optimization"],"2026-09-30T02:58:18.855057+00:00",["fabric","neoforge","quilt"],["1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/YL57xq9U/images/f47cea26f135d74c2d69df0a1806751818d705d3_350.webp"],
    ["NNAgCjsB","entityculling","Entity Culling","Using async path-tracing to hide Block-/Entities that are not visible","tr7zw","https://cdn.modrinth.com/data/NNAgCjsB/7873452d6cede4daed12da3d7d8c193ab88b4fd6_96.webp",189745378,18292,["babric","optimization"],"2026-11-13T16:12:06.881264+00:00",["fabric","forge","neoforge","quilt"],["1.21.11","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","1.7.10","1.8.8","1.8.9","26.1","26.1.1","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/NNAgCjsB/images/65781fbd7cda31b8c8e4a8def40bf445c10a1562.gif"],
    ["9s6osm5g","cloth-config","Cloth Config API","Configuration Library for Minecraft Mods","shedaniel","https://cdn.modrinth.com/data/9s6osm5g/ed8a2316cbb6f4fc5f510e8e13a59a85cbbbff4d_96.webp",186722302,17179,["library"],"2026-09-23T07:00:50.158851+00:00",["fabric","forge","neoforge"],["1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/9s6osm5g/images/baa0dc605540953f5262f24109ec7837c090a04c.png"],
    ["uXXizFIs","ferrite-core","FerriteCore","Memory usage optimizations","malte0811","https://cdn.modrinth.com/data/uXXizFIs/222a126f26f8f9ae1eb339f3b767677f18bff31f_96.webp",168237971,17016,["optimization","utility"],"2026-03-24T18:31:48.941879+00:00",["fabric","forge","neoforge","quilt"],["1.21","1.21.1","1.21.10","1.21.11","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],null],
    ["mOgUt4GM","modmenu","Mod Menu","Adds a mod menu to view the list of mods you have installed.","Prospector","https://cdn.modrinth.com/data/mOgUt4GM/5a20ed1450a0e1e79a1fe04e61bb4e5878bf1d20.png",161919595,28254,["utility"],"2026-11-15T12:10:22.238521+00:00",["fabric","quilt"],["1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/mOgUt4GM/images/70fd54b0579f2de3ac45fa9650aca2ec8ff0882b_350.webp"],
    ["gvQqBUqZ","lithium","Lithium","No-compromises game logic optimization mod, useful for both single-player games and multi-player servers.","jellysquid3","https://cdn.modrinth.com/data/gvQqBUqZ/bcc8686c13af0143adf4285d741256af824f70b7_96.webp",144224673,24364,["optimization"],"2026-10-28T22:31:10.526811+00:00",["fabric","neoforge","quilt"],["1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],null],
    ["5ZwdcRci","immediatelyfast","ImmediatelyFast","Speed up immediate mode rendering in Minecraft","RaphiMC","https://cdn.modrinth.com/data/5ZwdcRci/e57b6b451425692ac17ad322d5e14bea686a383a_96.webp",138557401,12004,["optimization"],"2026-10-13T19:56:36.976733+00:00",["fabric","forge","neoforge","quilt"],["1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],null],
    ["1eAoo2KR","yacl","YetAnotherConfigLib (YACL)","A builder-based configuration library for Minecraft!","isxander","https://cdn.modrinth.com/data/1eAoo2KR/08c0cd32515e260f4bb20bbc0696510041523f9a_96.webp",135959045,9959,["library","management","utility"],"2026-11-03T16:30:19.085611+00:00",["fabric","forge","neoforge","quilt"],["1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/1eAoo2KR/images/5862570281f5109119c11f21a1bba52b6a2ab17f_350.webp"],
    ["Ha28R6CL","fabric-language-kotlin","Fabric Language Kotlin","This is a mod that enables usage of the Kotlin programming language for Fabric mods.","modmuss50","https://cdn.modrinth.com/data/Ha28R6CL/72c3d74aeb665e45aea93a945a01474cbce3b7da_96.webp",131664570,11446,["library"],"2026-10-09T08:17:11.456061+00:00",["fabric"],["1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],null],
    ["1bokaNcj","xaeros-minimap","Xaero's Minimap","Displays a map of the nearby world terrain, players, mobs, entities in the corner of your screen. Lets you create waypoints which help you find the locations yo","thexaero","https://cdn.modrinth.com/data/1bokaNcj/354080f65407e49f486fcf9c4580e82c45ae63b8_96.webp",121031529,19455,["adventure","transportation","utility"],"2026-10-25T15:15:55.603082+00:00",["fabric","forge","neoforge","quilt"],["1.21.10","1.21.11","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","1.7.10","1.8.9","26.1","26.1.1","26.1.2","26.2","26.3"],null],
    ["BVzZfTc1","entitytexturefeatures","[ETF] Entity Texture Features","Emissive, Random & Custom texture support for entities in resourcepacks just like Optifine but for Fabric","Traben","https://cdn.modrinth.com/data/BVzZfTc1/af683d206d50b05258d865b0d6e4aa2f2cee12f2_96.webp",111979182,10868,["decoration","utility"],"2026-11-03T10:30:25.084521+00:00",["fabric","forge","neoforge","quilt"],["1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/BVzZfTc1/images/5260909bc44abcade39ce46ec57d0edf6107ffb0_350.webp"],
    ["lhGA9TYQ","architectury-api","Architectury API","An intermediary api aimed to ease developing multiplatform mods.","shedaniel","https://cdn.modrinth.com/data/lhGA9TYQ/05fe3a61c28faaccaec3533b92e1b321edde7bf6_96.webp",109035559,7827,["library"],"2026-11-16T17:25:11.963612+00:00",["fabric","forge","neoforge","quilt"],["1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],null],
    ["PtjYWJkn","sodium-extra","Sodium Extra","A Sodium addon that adds features that shouldn't be in Sodium.","FlashyReese","https://cdn.modrinth.com/data/PtjYWJkn/0df4fb22a11e1dcb5e83cb0aadd275b571aca7a9_96.webp",107513719,13934,["cursed","optimization","utility"],"2026-11-12T19:59:49.909916+00:00",["fabric","neoforge","quilt"],["1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],null],
    ["NcUtCpym","xaeros-world-map","Xaero's World Map","Adds a full screen world map which shows you what you have explored in the world. Works great together with Xaero's Minimap.","thexaero","https://cdn.modrinth.com/data/NcUtCpym/354080f65407e49f486fcf9c4580e82c45ae63b8_96.webp",106270017,14690,["adventure","transportation","utility"],"2026-10-25T15:12:04.732184+00:00",["fabric","forge","neoforge","quilt"],["1.21.10","1.21.11","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","1.7.10","1.8.9","26.1","26.1.1","26.1.2","26.2","26.3"],null],
    ["4I1XuqiY","entity-model-features","[EMF] Entity Model Features","EMF is an, OptiFine format, Custom Entity Model replacement mod available for Fabric and Forge.","Traben","https://cdn.modrinth.com/data/4I1XuqiY/6e5bbd0d06b1741bfdab6c0cfab6de8fdaf0064c_96.webp",106193500,10391,["mobs","utility"],"2026-10-15T07:13:19.450989+00:00",["fabric","forge","neoforge","quilt"],["1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/4I1XuqiY/images/ba682dbb4d4ff5df8900987e6d8e86f4997fc119_350.webp"],
    ["OhduvhIc","veinminer","VeinMiner","Mine the whole vein on mining a single ore/block. Make the tedious mining experience to something satisfying and fun! FTB Ultimine alternative","Miraculixx","https://cdn.modrinth.com/data/OhduvhIc/5ea1f538e66ee4d4e5e571ad952cba0e06e0bd5c.png",104525869,7074,["bukkit","equipment","folia","game-mechanics"],"2026-11-14T13:41:15.308531+00:00",["fabric","forge","neoforge","quilt"],["1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/OhduvhIc/images/5ed63b5c5bfffadc782bde4a140ec8674f2d49a4.png"],
    ["EsAfCjCV","appleskin","AppleSkin","Food/hunger-related HUD improvements","squeek502","https://cdn.modrinth.com/data/EsAfCjCV/icon.png",99490856,18795,["food","utility"],"2026-09-17T23:59:30.437129+00:00",["fabric","forge","neoforge","quilt"],["1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],null],
    ["MPCX6s5C","not-enough-animations","Not Enough Animations","Bringing first-person animations to the third-person","tr7zw","https://cdn.modrinth.com/data/MPCX6s5C/b97fd5f7a893165052408b747286d6eb38d57abb_96.webp",94968851,9325,["adventure","decoration"],"2026-11-01T15:51:41.129583+00:00",["fabric","forge","neoforge"],["1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/MPCX6s5C/images/3b9ca72d7e6099ef67496a4b210d887d85254d80.gif"],
    ["Bh37bMuy","reeses-sodium-options","Reese's Sodium Options","Alternative Options Menu for Sodium","FlashyReese","https://cdn.modrinth.com/data/Bh37bMuy/icon.png",88975764,9068,["utility"],"2026-11-12T19:30:35.664796+00:00",["fabric","neoforge","quilt"],["1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],null],
    ["u6dRKJwZ","jei","Just Enough Items (JEI)","View Items and Recipes","mezz","https://cdn.modrinth.com/data/u6dRKJwZ/4a3f18ac0d096c9f8e9176984c44be4e58f94c89_96.webp",86024325,11858,["library","utility"],"2026-11-12T15:13:48.933359+00:00",["fabric","forge","neoforge"],["1.21.11","1.21.4","1.21.5","1.21.7","1.21.8","1.21.9","1.8","1.8.8","1.8.9","1.9","1.9.4","26.1","26.1.1","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/u6dRKJwZ/images/f281af132332942e0739d557d6608e9263273fbb.jpeg"],
    ["zV5r3pPn","3dskinlayers","3D Skin Layers","Render the player skin layer in 3d!","tr7zw","https://cdn.modrinth.com/data/zV5r3pPn/ff7010d4ec0275609866c8b0f603b25e25949c08_96.webp",85014987,12145,["adventure","decoration"],"2026-10-18T17:17:12.791268+00:00",["fabric","forge","neoforge","quilt"],["1.21.10","1.21.11","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","1.8.8","1.8.9","26.1","26.1.1","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/zV5r3pPn/images/5fedc9267a2e550c4e8f2e6a53b31b4286e728cb_350.webp"],
    ["nmDcB62a","modernfix","ModernFix","All-in-one mod that improves performance, reduces memory usage, and fixes many bugs. Compatible with all your favorite performance mods!","embeddedt","https://cdn.modrinth.com/data/nmDcB62a/2af94de5e08ae54567ee86b968fc7ce076d9fee5_96.webp",84523377,7299,["optimization","utility"],"2026-11-13T19:40:04.576352+00:00",["fabric","forge","neoforge"],["1.16.5","1.18.2","1.19.2","1.19.4","1.20","1.20.1","1.20.2","1.20.3","1.20.4","1.20.5","1.20.6","1.21","1.21.1","1.21.4","26.1","26.1.2"],"https://cdn.modrinth.com/data/nmDcB62a/images/2decaf4ab22bd38aa4ca39424bc1ec007fb70366_350.webp"],
  ],
  modpack: [
    ["1KVo5zza","fabulously-optimized","Fabulously Optimized","Beautiful graphics, speedy performance and familiar features in a simple package. Wilderness Bound beta!","robotkoer","https://cdn.modrinth.com/data/1KVo5zza/d8152911f8fd5d7e9a8c499fe89045af81fe816e_96.webp",19379687,5094,["lightweight","multiplayer","optimization"],"2026-11-14T17:16:52.017772+00:00",["fabric"],["1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/1KVo5zza/images/38f70f307f1a0b17d8ed4526d1636317e8c12d1d_350.webp"],
    ["l9m9tuPN","zombie-invade-100-days","Zombie Invade 100 Days","僵尸入侵 100 天（高版本惊变重制）—— Same as Forge Labs 100 Days Zombie Apocalypse in new Minecraft","FlameFire","https://cdn.modrinth.com/data/l9m9tuPN/fefe3f67c37744344d100638452c7bf059d586a1_96.webp",15316471,675,["challenging","combat"],"2025-12-13T12:35:17.892775+00:00",["forge"],["1.19.2","1.20.1"],null],
    ["5FFgwNNP","cobblemon-fabric","Cobblemon Official Modpack [Fabric]","The official modpack of the Cobblemon mod, for Fabric!","CobbledStudios","https://cdn.modrinth.com/data/5FFgwNNP/e7f9ee2e9d361623847853fe2ddce42f519ee64f.png",11469672,2787,["adventure","lightweight","multiplayer"],"2026-10-27T10:50:19.498193+00:00",["fabric"],["1.20.1","1.21.1"],"https://cdn.modrinth.com/data/5FFgwNNP/images/43765359395bb8216a238d18c02a045106d7bad4_350.webp"],
    ["Jkb29YJU","cobbleverse","COBBLEVERSE - Pokemon Adventure [Cobblemon]","Start a true Pokémon adventure in Minecraft: Cobblemon 1.7.3 | ALL 1025 Pokémon! | Mega Evolutions | Gyms & Badges | Starter Kit | Unique Structures | Custom Mu","LUMYVERSE","https://cdn.modrinth.com/data/Jkb29YJU/581ecf54530972afb18a04660afd820f2f24f6c7.png",7264856,2168,["adventure","multiplayer","optimization"],"2026-07-21T20:33:21.042977+00:00",["fabric"],["1.21.1"],null],
    ["rQiXwLhB","battlearmorytacz","BattleArmory TACZ","厌倦了每次开局都是一样的钻石剑和弓？BattleArmory 让你每场重生都像开盲盒——400+ 现代枪械随机配发，从使命召唤的经典步枪到赛博朋克科幻杀器，配上 CS 经典地图和战术投掷物，开局就是 80 帧+丝滑刚枪。** 这不是模组体验卡，这是完全免费的 1.20.1 战术枪战整合包，下载启动，直接开战。","JZ_zhenmeng","https://cdn.modrinth.com/data/rQiXwLhB/1f8cafea7dcd59dff7dc58cad7a17ae0424847a2_96.webp",3769593,108,["combat","multiplayer"],"2026-08-21T08:52:23.779822+00:00",["forge","neoforge"],["1.20.1"],null],
    ["shFhR8Vx","better-mc-fabric-bmc2","Better MC [FABRIC] - BMC2","Version 1.20 | A Proper Vanilla+ Modpack | Don't play Vanilla play this!","SHXRKIE","https://cdn.modrinth.com/data/shFhR8Vx/a19c2bcb51d38f32f138d3607e91cb2b7b8e387f_96.webp",3715900,1537,["adventure","combat","optimization"],"2026-07-15T06:31:42.748667+00:00",["fabric"],["1.20.1"],"https://cdn.modrinth.com/data/shFhR8Vx/images/d3df28d6602d05c894c33fac6f6e0e42b5ea7739_350.webp"],
    ["ch7UHY2J","sodiumplus","Sodium Plus","A client-side optimization modpack with a few extra tweaks.","NoSadBeHappy","https://cdn.modrinth.com/data/ch7UHY2J/cf0150ba8d6c01144974709a27b23bba93c0fc9e.png",2937927,656,["lightweight","multiplayer","optimization"],"2026-10-27T18:34:09.530470+00:00",["fabric","quilt"],["1.18.2","1.19","1.19.2","1.19.3","1.19.4","1.20","1.20.1","1.21","1.21.10","1.21.11","1.21.5","1.21.8","26.1.2","26.2","26.3"],null],
    ["1ocGzRHv","vanilla-perfected","Vanilla Perfected","A compilation of Vanilla Plus mods & packs to perfect the Minecraft experience without drifting too far from the feel of the base game!","demonjoeTV","https://cdn.modrinth.com/data/1ocGzRHv/ebec737126db7637001194ca5560ae58413d338f_96.webp",2695026,2623,["adventure","lightweight","optimization"],"2026-10-08T18:37:49.209004+00:00",["fabric"],["1.20.1","1.21","1.21.1","1.21.10","1.21.11","1.21.4","1.21.5","1.21.6","1.21.8","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/1ocGzRHv/images/60856cd3ea67a71b73b8ffa9b706c719836b861d_350.webp"],
    ["vwgtbO0y","the-pixelmon-modpack","The Pixelmon Modpack","This Modpack includes everything you need as a pre-built Pixelmon exerience - The Pixelmon Mod, The Pixelmon OST, Journeymap, BYG, Natures/Explorers Compass.","Pixelmon","https://cdn.modrinth.com/data/vwgtbO0y/e16493aab7b0a32a2c9920cb0d89ebe06c4b3726_96.webp",2396625,348,["adventure","quests"],"2026-10-22T13:02:57.986326+00:00",["forge","neoforge"],["1.16.5","1.20.1","1.20.2","1.21.1"],"https://cdn.modrinth.com/data/vwgtbO0y/images/967de4295c8436fce0531056f6f4dcffffc7b406_350.webp"],
    ["4BV47HRn","better-mc-forge-bmc4","Better MC [FORGE] - BMC4","Version 1.20.1 | A Proper Vanilla+ Modpack | Don't play Vanilla play this!","SHXRKIE","https://cdn.modrinth.com/data/4BV47HRn/7f5ef7cc61b2593609aabef3ed07a866a4f11b73_96.webp",2315551,689,["adventure","combat"],"2026-07-15T07:13:37.561950+00:00",["forge"],["1.20.1"],"https://cdn.modrinth.com/data/4BV47HRn/images/d3df28d6602d05c894c33fac6f6e0e42b5ea7739_350.webp"],
    ["EGs3lC8D","prominence-2-fabric","Prominence™ II: Hasturian Era","Lore-rich RPG modpack built on custom content. Level up and get stronger with the Talent Tree, forge and upgrade your own artifact weapon, and fight powerful bo","ElocinDev","https://cdn.modrinth.com/data/EGs3lC8D/a0d0d63375454061b73003d0a47dd92503604a64_96.webp",2206279,1533,["adventure","quests"],"2026-11-13T12:18:29.590378+00:00",["fabric"],["1.20.1"],"https://cdn.modrinth.com/data/EGs3lC8D/images/fb6811a55f3d2b30f927d5677b0e459b9a915c06_350.webp"],
    ["8yKzGJOG","slimes-adventure","Slimes Adventure","Tensura: that time i got reincarnated as a slime modpack with many features","NotWindx","https://cdn.modrinth.com/data/8yKzGJOG/707a64c36eb8fc59be69538e619e81bca15c6b3a_96.webp",2094321,548,["adventure","combat","magic"],"2026-09-11T07:27:35.682846+00:00",["fabric","forge"],["1.16.5","1.19.2","1.21.1"],null],
    ["e0oMrxjp","skyblock-enhanced","SkyBlock Enhanced","The only Hypixel SkyBlock modpack you need. Built for modern Minecraft — 60+ optimized mods, a guided setup wizard, and a config system no other pack comes clos","Kd_Gaming1","https://cdn.modrinth.com/data/e0oMrxjp/ee51624899235196ffce9c5d25a3c7e87ad9c224_96.webp",2015455,220,["adventure","multiplayer","optimization"],"2026-11-16T12:31:11.707846+00:00",["fabric"],["1.21.10","1.21.11","1.21.5","1.21.8","26.1.2","26.2"],"https://cdn.modrinth.com/data/e0oMrxjp/images/ce62b33a0f6a79c01c8dd1e85de2f0d08861c5ad_350.webp"],
    ["bHUKuhiA","optifabric-modpack","OptiFabric","Best alternative to OptiFine","Creanter","https://cdn.modrinth.com/data/bHUKuhiA/549df2be0790089fac5a535536acce8f315081aa_96.webp",1764764,549,["lightweight","multiplayer","optimization"],"2026-11-01T13:43:02.363032+00:00",["fabric"],["1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],null],
    ["C9FChyZ3","cobblemondelta","Cobblemon Delta","Pokemon Cobblemon Pack - QoL and Performance mods! The server included in the pack has Mega Evolution, Paradox Pokemon, Area Zero, Real Player Gyms, Raids, Dung","ItsJustChris","https://cdn.modrinth.com/data/C9FChyZ3/b4391701477ebf0f75458de085ce5c7deb6af199.png",1699628,344,["adventure","lightweight","multiplayer"],"2026-11-16T12:02:48.876788+00:00",["fabric"],["1.20.1","1.21.1"],"https://cdn.modrinth.com/data/C9FChyZ3/images/760c588fcaf71f5614b3a99be01f966a5167afc3_350.webp"],
    ["nJ2Rn3SV","fps","FPS Modpack","Minimal modpack optimized for improving game performance. \n\nIncludes only essential mods to boost FPS and reduce system load while maintaining stability and smo","MIRRONAKE","https://cdn.modrinth.com/data/nJ2Rn3SV/cddbd72f523039258faf0c28122a3e0164341b6b_96.webp",1653457,391,["lightweight","multiplayer","optimization"],"2026-09-24T15:35:20.829775+00:00",["fabric"],["1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],null],
    ["ICQPO4fX","fresh-smooth","Fresh & Smooth","Making Minecraft As Animated, and As Fresh As possible while remaining fully client-based (similar to Actions & Stuff pack)","EnderPacks","https://cdn.modrinth.com/data/ICQPO4fX/695efeeb8691d1e5d2a44729563b11d8f55d075a_96.webp",1553178,1903,["adventure","lightweight","optimization"],"2026-10-16T16:26:13.720796+00:00",["fabric","neoforge"],["1.20.1","1.21.1","1.21.10","1.21.11","1.21.4","1.21.5","1.21.6","1.21.8","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/ICQPO4fX/images/e1efdf4cb9091259da01cb198dc48f6d95c359af.gif"],
    ["t1tOiUHZ","create_plus","Create+","A simple, optimized, Vanilla+ pack, with the special exception of Create (and its addons). Now with Create: Aeronautics!","Sshmoob","https://cdn.modrinth.com/data/t1tOiUHZ/02e664d639c9ad8fed670148dbcc22a26d59e992_96.webp",1498340,660,["lightweight","multiplayer","technology"],"2026-06-15T00:34:52.138582+00:00",["forge","neoforge"],["1.19.2","1.21.1"],null],
    ["i4XHCd7Q","aged","Aged","realistic / medieval / progression based modpack for Fabric 1.21.1","xR4YM0ND","https://cdn.modrinth.com/data/i4XHCd7Q/08f0c63df56b34270bc77d39fa8e448de20b7c05.png",1498272,2542,["adventure","challenging","combat"],"2026-11-13T17:59:11.736325+00:00",["fabric"],["1.19.2","1.20.1","1.21.1"],"https://cdn.modrinth.com/data/i4XHCd7Q/images/dbad60b46bf313e598e5dcfc6b34886b56d75635_350.webp"],
    ["MNW3LUwK","remarkably","Remarkably Optimized","1.16.5-26.3 | A performance mod pack to save your computer from doubling as a starchy spud with a remarkably optimized collection of mods!","ThatDeeJay","https://cdn.modrinth.com/data/MNW3LUwK/261aff94d278ed76dca6abf3e50bd589d58a55d6_96.webp",1489375,673,["lightweight","multiplayer","optimization"],"2026-10-25T04:54:23.750525+00:00",["fabric"],["1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/MNW3LUwK/images/dc8ac9aeee26ec4194ba1bc2581fb36ae85d7515_350.webp"],
    ["1Fv3GHYS","rso","红石生电优化【Redstone Survival Optimization】","一个红石玩家必备的整合包，轻，快，小，是他的特点！A must-have integration package for a Redstone player, light, fast, and small, are his characteristics!","moonboss666","https://cdn.modrinth.com/data/1Fv3GHYS/858eb9b338685b41a68d6183ad6af7b4ae2da841_96.webp",1306376,126,["lightweight","multiplayer","optimization"],"2026-11-14T07:52:37.807277+00:00",["fabric"],["1.21","1.21.1","1.21.10","1.21.11","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/1Fv3GHYS/images/5cb6d7e04c823359f9f706873198d98269fa7025_350.webp"],
    ["fgUCZ5nU","pokemon-elysium","Pokemon Elysium","Modpack originally made for the Pokemon Elysium server, a Cobblemon-focused pack with hints of low-tech steampunk.","Chubblezap","https://cdn.modrinth.com/data/fgUCZ5nU/11dcbe1c82b94f810c6c612a51f91e24cdc4e4c1.png",1273446,134,["adventure","combat","multiplayer"],"2024-01-17T07:12:02.939516+00:00",["fabric"],["1.19.2","1.20.1"],null],
    ["X2bWRWhV","ardacraft","ArdaCraft","The modpack for the ArdaCraft server, a Lord of the Rings project re-creating J.R.R. Tolkien's Middle-earth in Minecraft.","Fornad","https://cdn.modrinth.com/data/X2bWRWhV/c4ad8a059dc9a909e70ff18657e92bc3c2c26fd5_96.webp",1143966,606,["multiplayer"],"2026-11-07T00:54:10.281379+00:00",["fabric"],["1.19.2","1.20.1"],"https://cdn.modrinth.com/data/X2bWRWhV/images/1bb1f16e022e04899a52828d481fefc6eb934d59_350.webp"],
    ["KmiWHzQ4","skyblocker-modpack","Skyblocker Modpack - Hypixel Skyblock","A Hypixel Skyblock Modpack with common client-side utilities, along with the Skyblocker mod.","Wohlhabend","https://cdn.modrinth.com/data/KmiWHzQ4/62f2e3a020f761f275f0a7f3ebca3327576edb4c.png",1142076,227,["lightweight","multiplayer"],"2026-10-19T21:49:46.844078+00:00",["fabric"],["1.18.2","1.19.2","1.19.4","1.20.1","1.20.2","1.20.4","1.20.6","1.21","1.21.1","1.21.10","1.21.11","1.21.4","1.21.5","1.21.8","26.1.2","26.2"],null],
  ],
  resourcepack: [
    ["50dA9Sha","fresh-animations","Fresh Animations","Make your game like the trailers! Dynamic animated entities to freshen your Minecraft experience.","FreshLX","https://cdn.modrinth.com/data/50dA9Sha/3132c10e9e3c73fde9799720fd3da5561071708c_96.webp",52358160,14939,["entities","tweaks","vanilla-like"],"2026-11-01T11:30:43.988747+00:00",[],["1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/50dA9Sha/images/26e5c0a8a65d421b1111e2c68880f1d657fdc920_350.webp"],
    ["yfDziwn1","translations-for-sodium","Translations for Sodium","Unofficial translations for the Sodium Minecraft mod","robotkoer","https://cdn.modrinth.com/data/yfDziwn1/907581019df45903df237952ce8d10ac37134cb5_96.webp",23447847,1692,["locale","modded","utility"],"2026-11-14T05:50:05.248579+00:00",[],["1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/yfDziwn1/images/41175c3da02a8737e1a474e47ff172e96d550149.png"],
    ["uvpymuxq","better-leaves","Motschen's Better Leaves","Improves the appearance of leaves with high mod compatibility and performance!","Motschen","https://cdn.modrinth.com/data/uvpymuxq/fe1a61998ae57dc6ad1a4bb028334c3c3925d22f_96.webp",21687731,5600,["models","realistic","vanilla-like"],"2026-09-14T22:38:36.576279+00:00",[],["1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/uvpymuxq/images/769f109a7d5a753ea93c8520bbaaace9f3059ea2_350.webp"],
    ["tN4E9NfV","chat-reporting-helper","Chat Reporting Helper","An educational tool that explains chat reporting in a simple and neutral way.","robotkoer","https://cdn.modrinth.com/data/tN4E9NfV/c2d93fd85469a512f67e53baa7648c1abe6645ef.png",18209302,287,["locale","simplistic","vanilla-like"],"2026-09-27T10:01:53.909962+00:00",[],["1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/tN4E9NfV/images/5eb8b8469192851bc4c2095f455f527cb413c12a.png"],
    ["RRxvWKNC","low-on-fire","Low On Fire","Low fire on your screen! Vanilla Friendly","Haikis","https://cdn.modrinth.com/data/RRxvWKNC/06a7e7691a6da41798c255108a8563d7ffea171d.png",17730136,3954,["16x","tweaks","utility"],"2026-06-19T12:38:40.380441+00:00",[],["1.8.4","1.8.5","1.8.6","1.8.7","1.8.8","1.8.9","1.9","1.9.1","1.9.2","1.9.3","1.9.4","26.1","26.1.1","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/RRxvWKNC/images/67e073e6149cfb9dd46c7a53cf9b8a995f774595_350.webp"],
    ["slufHzC2","tras-fresh-player","Fresh Moves","This is EMF Player Animation resource pack. Gives fancy animations to the player entity. Compatible with animations from other mods. Like Quark's emotes, Parcoo","IthanMendoza","https://cdn.modrinth.com/data/slufHzC2/02b78db6655ad8dd6cfd847f99c76f7552c053ec_96.webp",15714549,4018,["16x","equipment","modded"],"2025-01-20T05:34:53.287747+00:00",[],["1.19.1","1.19.2","1.19.3","1.19.4","1.20","1.20.1","1.20.2","1.20.3","1.20.4","1.20.5","1.20.6","1.21","1.21.1","1.21.2","1.21.3","1.21.4"],"https://cdn.modrinth.com/data/slufHzC2/images/7d72ccd7e75f18ab9bf1c804d9020c5ab89c5129_350.webp"],
    ["dspVZXKP","fast-better-grass","Fast Better Grass","Makes grass and related blocks use the top texture on the sides. Works with other resource packs!","robotkoer","https://cdn.modrinth.com/data/dspVZXKP/5de0774f423d220fcd4e635b91f2bdfcb8a2b910.png",14209741,2774,["decoration","models","tweaks"],"2026-09-15T17:46:43.015413+00:00",[],["1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/dspVZXKP/images/44b46fae71c21058a904311d99f63d4881d24b1c_350.webp"],
    ["ItHr72Fy","fullbright-ub","Fullbright UB","Experience Fullbright UB in Sodium, Optifine and Vanilla","worldresourcepack","https://cdn.modrinth.com/data/ItHr72Fy/c28c5e4ae4e1e5ac726ff192855d16d2c15c83e2_96.webp",12495115,2809,["core-shaders","vanilla-like"],"2026-09-19T10:48:02.485005+00:00",[],["1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/ItHr72Fy/images/56ca455a62a430402cfe80d5f42f2697ee1632f2.webp"],
    ["YAVTU8mK","fresh-animations-extensions","Fresh Animations: Extensions","A combination of offical extension packs for Fresh Animations","FreshLX","https://cdn.modrinth.com/data/YAVTU8mK/2e83da75469cdec6d4558023cba611443b105c9e_96.webp",12074183,3633,["entities","tweaks","vanilla-like"],"2026-10-31T22:50:46.856216+00:00",[],["1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/YAVTU8mK/images/5a1d78039b6f64ac429f24e6d98f133ae998764e_350.webp"],
    ["2YyNMled","dramatic-skys","Dramatic Skys","Dramatic Skys is an add on pack that will make the skies in your game HD with realistic clouds and lighting. This pack works with any other resource pack, just ","thebaum64","https://cdn.modrinth.com/data/2YyNMled/75af81c8e31ad9b2848bff6fc40c9d7232f3c3b0_96.webp",11552684,3848,["environment","realistic","tweaks"],"2026-09-18T21:55:39.005436+00:00",[],["1.8.4","1.8.5","1.8.6","1.8.7","1.8.8","1.8.9","1.9","1.9.1","1.9.2","1.9.3","1.9.4","26.1","26.1.1","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/2YyNMled/images/87c986c172dd772947444c4650cef8208433a77a_350.webp"],
    ["gfiYlQU0","cobblemon-interface","Cobblemon Interface","Cobblemon inspired GUI Textures and Sounds","VinnyStalck","https://cdn.modrinth.com/data/gfiYlQU0/d3797ea2a31bc002182554d1e1957c3aa27aa877.png",10083994,397,["audio","gui","modded"],"2025-11-14T13:23:03.974153+00:00",[],["1.19","1.19.1","1.19.2","1.20","1.20.1","1.21","1.21.1"],"https://cdn.modrinth.com/data/gfiYlQU0/images/0b58e578696610b931b2eb8788994f8dd2f187a9_350.webp"],
    ["oL18adaQ","new-glowing-ores","New Glowing Ores","Makes ores glow to make them more visible, and also adds connected outlines to them so you don't miss a single block. Mod support available","GridExpert","https://cdn.modrinth.com/data/oL18adaQ/2bb2608c4f8c4801cbbdd3c60673b3c2228c5027.png",8716894,3967,["blocks","decoration","utility"],"2024-10-23T07:12:54.863551+00:00",[],["1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/oL18adaQ/images/293c5b6ac00a647d39a47afc369c5ad7234f471f_350.webp"],
    ["Va3BanZa","e19_cobblemon_minimap_icons","E19 - Cobblemon Minimap Icons","Cobblemon icons from MBCMechachu for Xaero's Minimap.","Emery319","https://cdn.modrinth.com/data/Va3BanZa/cc0f6a4a8f279148d4e8b65212d67fe47000d6e7.png",8478962,421,["entities","gui","modded"],"2026-11-08T07:08:53.128916+00:00",[],["1.20","1.20.1","1.21","1.21.1"],"https://cdn.modrinth.com/data/Va3BanZa/images/95aa4abdc7e578f9d8ef328bac2cf3ffd5720dbc_350.webp"],
    ["UGEVQ6t9","fancy-crops","(Bee's) Fancy Crops","My take on prettier farming, compatible with mods","bebebea_loste","https://cdn.modrinth.com/data/UGEVQ6t9/5c1e966b2b67c21750875d8517c994d975a729de_96.webp",8454738,4674,["16x","tweaks","vanilla-like"],"2026-11-08T13:07:34.377676+00:00",[],["1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/UGEVQ6t9/images/fe7f0087456ec89960044225105f2b220ba4f2a2_350.webp"],
    ["6SLU7tS5","default-dark-mode","Default Dark Mode","🌙 The Dark Mode Resource Pack for Minecraft: Java Edition","nebulr","https://cdn.modrinth.com/data/6SLU7tS5/f90001e4ebed860e7ae913f34c85d745f516a89b.png",8389952,4182,["gui","modded","vanilla-like"],"2026-09-19T15:17:01.018292+00:00",[],["1.8.4","1.8.5","1.8.6","1.8.7","1.8.8","1.8.9","1.9","1.9.1","1.9.2","1.9.3","1.9.4","26.1","26.1.1","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/6SLU7tS5/images/72dad114b1d88964780d933d83e31e382c37cc48_350.webp"],
    ["1jZGHJ05","low-fire-pack","Low Fire","Lower your first-person fire to enhance visibility!","Oculie","https://cdn.modrinth.com/data/1jZGHJ05/f5121ce9e464ff6dc20b5de0127c52bfea6eb9f3_96.webp",8228093,845,["tweaks","utility","vanilla-like"],"2026-06-17T03:08:33.846429+00:00",[],["1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/1jZGHJ05/images/4b273000cb0e596c26b6a60e494ac47c5366c136_350.webp"],
    ["rox3U8B6","bare-bones","Bare Bones","Minecraft with the style of the trailers","RobotPants","https://cdn.modrinth.com/data/rox3U8B6/b502bd8b2a6048f635230da8e8a66eeb4383874b_96.webp",8038813,3423,["16x","simplistic","vanilla-like"],"2025-12-20T05:38:26.392361+00:00",[],["1.7.9","1.8","1.8.1","1.8.2","1.8.3","1.8.4","1.8.5","1.8.6","1.8.7","1.8.8","1.8.9","1.9","1.9.1","1.9.2","1.9.3","1.9.4"],"https://cdn.modrinth.com/data/rox3U8B6/images/08d508fd38c9ed1dd73e20f2b69c2b709eef8524_350.webp"],
    ["A32gwfe8","glowing-glints","Enchantment Outlines","Adds an outline to all enchantable tools.","tixul","https://cdn.modrinth.com/data/A32gwfe8/9f4bd3edfdb3df167c64757f66b828eba664a616_96.webp",7846296,2341,["equipment","tweaks","vanilla-like"],"2026-10-29T19:55:11.668478+00:00",[],["1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/A32gwfe8/images/10c310a14bb0dcd7ca119f49b4230a478ad1523f_350.webp"],
    ["d1nRD7RG","programmer-art-fix","Programmer Art Fix","A patch for Programmer Art / classic texture","THGABS","https://cdn.modrinth.com/data/d1nRD7RG/73267422faa3188aed5be6c4445015157fc765a4_96.webp",7769800,741,["16x","vanilla-like"],"2026-10-25T14:12:24.904583+00:00",[],["1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/d1nRD7RG/images/5f35fc64c6512f97eb4002a820095b497b77a72d_350.webp"],
    ["r4GILswZ","faithful-64x","Faithful 64x","An even more detailed experience with quadruple-resolution textures!","Faithful-Resource-Pack","https://cdn.modrinth.com/data/r4GILswZ/9ff7d3c66d6a263c158c2ef034b0361fdfbf354b.png",7753011,2260,["64x","vanilla-like"],"2026-09-15T17:26:09.938624+00:00",[],["1.20.4","1.20.6","1.21","1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.7","1.21.8","1.21.9","26.1","26.2","26.3"],"https://cdn.modrinth.com/data/r4GILswZ/images/336b7507a4e27b3abb29ecb678bdf3055b3f7015_350.webp"],
    ["h6zxsNVF","mandalas-gui-dark-mode","Mandala's GUI - Dark mode","Mandala GUI is an elegant theme, in the style of Mandala Creations.\nIt is specifically made for people who like Dark mode.\nIt only changes the UI of Minecraft, ","CesarZorak","https://cdn.modrinth.com/data/h6zxsNVF/458fb1c1a7c10c19f7a4a58e99defb73e54fbc93.png",7503177,1475,["gui","items","vanilla-like"],"2025-12-17T18:52:54.666505+00:00",[],["1.20.3","1.20.4","1.20.5","1.20.6","1.21","1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9"],"https://cdn.modrinth.com/data/h6zxsNVF/images/7dde2c7aef393e1076ca8815ffa94145c65937cd_350.webp"],
    ["5DF3hBIs","cobblemon-interface-modded","Cobblemon Interface: Modded","Mod support for the Cobblemon Interface resourcepack","VinnyStalck","https://cdn.modrinth.com/data/5DF3hBIs/06d65ae681586ffd856d6aa1d1d7d297d92cf2c0.png",6966370,125,["gui","modded"],"2025-10-02T14:01:25.042673+00:00",[],["1.20","1.20.1","1.21","1.21.1"],"https://cdn.modrinth.com/data/5DF3hBIs/images/22c0c87e179f3612c7eaa92fdf74b3d8f9c262f0.png"],
    ["ti9KkMHm","simple-grass-flowers","Simple Grass Flowers","Gives Grass, Podzol, Mycelium, Crimson Nylium, and Warped Nylium vanilla-friendly flowers, clovers, and rocks!","2DWisp","https://cdn.modrinth.com/data/ti9KkMHm/3d335c25a18ca44c7c2dd449eab25a7de82016eb.gif",6306116,2958,["decoration","environment","vanilla-like"],"2026-07-26T16:03:34.533949+00:00",[],["1.21","1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2"],"https://cdn.modrinth.com/data/ti9KkMHm/images/6c063c00e2af4f4689b3d48ee3b45d88aaa8f5aa_350.webp"],
    ["ARGDWSQq","rct-trainer-textures-plus","Radical Cobblemon Trainer Textures Plus","A resource pack for the latest version of the Radical Cobblemon Trainers mod.","forestfire","https://cdn.modrinth.com/data/ARGDWSQq/0eddd91a58141336fb0c2e038f9eeae60f9caba1_96.webp",6110673,109,["entities","models","themed"],"2026-08-13T20:38:29.332068+00:00",[],["1.20.1","1.21.1"],"https://cdn.modrinth.com/data/ARGDWSQq/images/bd0433f4f0d09450a68013ebf5ec751f52eee785_350.webp"],
  ],
  shader: [
    ["HVnmMxH1","complementary-reimagined","Complementary Shaders - Reimagined","Preserving the elements of Minecraft with exceptional quality, detail, and performance.","EminGT","https://cdn.modrinth.com/data/HVnmMxH1/79cb7c8123bbc54945305b2ebad6b8881efdf5f8_96.webp",73126285,11642,["colored-lighting","vanilla-like"],"2026-09-15T06:35:37.820364+00:00",[],["1.8.4","1.8.5","1.8.6","1.8.7","1.8.8","1.8.9","1.9","1.9.1","1.9.2","1.9.3","1.9.4","26.1","26.1.1","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/HVnmMxH1/images/111e76bfa966c68b3581a93f7322588e642ce4db_350.webp"],
    ["R6NEzAwj","complementary-unbound","Complementary Shaders - Unbound","Transforming the visuals of Minecraft with exceptional quality, detail, and performance.","EminGT","https://cdn.modrinth.com/data/R6NEzAwj/c85ce4049aac76360d2cd24fd9a7003de01ef312_96.webp",47567753,6181,["colored-lighting","fantasy"],"2026-09-15T06:36:15.762531+00:00",[],["1.8.4","1.8.5","1.8.6","1.8.7","1.8.8","1.8.9","1.9","1.9.1","1.9.2","1.9.3","1.9.4","26.1","26.1.1","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/R6NEzAwj/images/a5a420ab1668bcfe47a76a812eede7056c45fe31_350.webp"],
    ["Q1vvjJYV","bsl-shaders","BSL Shaders","Shaderpack for Minecraft: Java Edition. It's bright, colorful, and distinct.","CaptTatsu","https://cdn.modrinth.com/data/Q1vvjJYV/2a611a3cb434fb52fb81fa5dace13c5d8b67e55d_96.webp",32009714,6386,["bloom","cartoon","low"],"2026-09-21T12:25:19.510082+00:00",[],["1.8.4","1.8.5","1.8.6","1.8.7","1.8.8","1.8.9","1.9","1.9.1","1.9.2","1.9.3","1.9.4","26.1","26.1.1","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/Q1vvjJYV/images/40b899ae09647c98722d67bb2288f790ae28b4fc_350.webp"],
    ["lLqFfGNs","photon-shader","Photon Shaders","A gameplay-focused shader pack with a semi-realistic style","sixthsurge","https://cdn.modrinth.com/data/lLqFfGNs/39cb5f12e7dcc68d6cb666f225fcb2b801dd70fb_96.webp",29408610,4465,["atmosphere","colored-lighting","semi-realistic"],"2026-10-19T12:27:39.404163+00:00",[],["1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/lLqFfGNs/images/a7205115d731077733ab5cdcc639e5531f2dee12_350.webp"],
    ["EpQFjzrQ","solas-shader","Solas Shader","A modern fantasy stylized shaderpack with colored lighting and stunning visuals","Septonious","https://cdn.modrinth.com/data/EpQFjzrQ/e3efc6ba7a63f9e1cf473a794d0224a6daf243c7_96.webp",18880821,3593,["colored-lighting","fantasy","pbr"],"2026-11-02T09:00:57.667889+00:00",[],["1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/EpQFjzrQ/images/b87a4f77d7858c6b8fb9ecc40301f9d189a52c44_350.webp"],
    ["ZvMtQlho","bliss-shader","Bliss Shaders","A well performing fantasy styled shaderpack with emphasis on scene variation and customization.","Xonk","https://cdn.modrinth.com/data/ZvMtQlho/90145c971ea24387775108fc86c89bed9bd2c8f1_96.webp",15881896,3028,["atmosphere","fantasy","medium"],"2025-11-23T03:14:45.101966+00:00",[],["1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/ZvMtQlho/images/7ceb3b0fcd9ccdbd5fc4bdc80ba7ee766509c69f_350.webp"],
    ["izsIPI7a","makeup-ultra-fast-shaders","MakeUp - Ultra Fast","MakeUp aims to provide the best quality / performance ratio, building a shader that can be adapted to anyone's resources.","KDXavier","https://cdn.modrinth.com/data/izsIPI7a/a08432baa86b8ffd58c08f4b3a001ef976ff764d_96.webp",14366647,2469,["potato","semi-realistic","shadows"],"2026-10-19T23:41:29.685004+00:00",[],["1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/izsIPI7a/images/97776ad4f19f734243dbb301feaf81c327bae96b_350.webp"],
    ["kmwfVOoi","rethinking-voxels","Rethinking Voxels","[WIP] A gameplay shaderpack based on complementary reimagined that has coloured block light with sharp shadows","gri573","https://cdn.modrinth.com/data/kmwfVOoi/fc89eadad417dd376b14c3b31e1a2b87acaca034_96.webp",13817934,4438,["colored-lighting","shadows"],"2025-06-19T23:16:12.421835+00:00",[],["1.20.2","1.20.3","1.20.4","1.20.5","1.20.6","1.21","1.21.1","1.21.10","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9"],"https://cdn.modrinth.com/data/kmwfVOoi/images/c2de214a7981a9b0235b46209507eb9c0b225ddc_350.webp"],
    ["LMIZZNxZ","super-duper-vanilla","Super Duper Vanilla","A shader pack created to convey the style of the cancelled Super Duper Graphics Pack and other popular Minecraft titles.","Eldeston","https://cdn.modrinth.com/data/LMIZZNxZ/5d09a380b6da014dcbca683879cdfb4a94603cf8_96.webp",8362025,2672,["low","pbr","vanilla-like"],"2025-07-08T20:37:24.669928+00:00",[],["1.20","1.20.1","1.20.2","1.20.3","1.20.4","1.20.5","1.20.6","1.21","1.21.1","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8"],"https://cdn.modrinth.com/data/LMIZZNxZ/images/a1b45a0d10ff893cb4247979ced0ff0b9ce182a9_350.webp"],
    ["BUxf36AP","mellow","Mellow","Shaderpack with a painterly aesthetic made for people who want to actually play the game. It's easy on your eyes and on your computer!","TheCMK","https://cdn.modrinth.com/data/BUxf36AP/b2cc2e9b97e5e0c4c7fcd89b7e295f29a29b9c6d_96.webp",8208279,1442,["atmosphere","fantasy","potato"],"2026-10-31T08:27:21.822324+00:00",[],["1.8.4","1.8.5","1.8.6","1.8.7","1.8.8","1.8.9","1.9","1.9.1","1.9.2","1.9.3","1.9.4","26.1","26.1.1","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/BUxf36AP/images/184d65af1f3f222be773ec0c742932ecc2639116_350.webp"],
    ["EQWX2WiO","insanity-shader","Insanity Shader","A stylized, horror themed Iris shaderpack with high customizability and performance.","ElocinDev","https://cdn.modrinth.com/data/EQWX2WiO/cc7a7e0bb758af1ed4208d297ab14c92e695c999_96.webp",8089571,1285,["atmosphere","fantasy","low"],"2024-06-13T18:19:15.211644+00:00",[],["1.7.9","1.8","1.8.1","1.8.2","1.8.3","1.8.4","1.8.5","1.8.6","1.8.7","1.8.8","1.8.9","1.9","1.9.1","1.9.2","1.9.3","1.9.4"],"https://cdn.modrinth.com/data/EQWX2WiO/images/c6f41d1eef4bcd4b43619f59e0c3a74b079ad283_350.webp"],
    ["RphJSnEs","astralex","AstraLex Shaders","Shaderpack with very high customization. If you like effects, this shaderpack is made for you!","LexBoosT","https://cdn.modrinth.com/data/RphJSnEs/3e25ea407447bf2ff8ffa8926cd2db295307cf68_96.webp",5768047,1222,["atmosphere","cartoon","fantasy"],"2024-06-16T14:35:34.881422+00:00",[],["1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/RphJSnEs/images/a8a1137931740b5e6d59a12ce3bfb103c3d9397b_350.webp"],
    ["BkTdFBUU","pastel-shaders","Pastel Shaders","An aesthetic, performant pastel-colored shaderpack with multiple color presets.","ElocinDev","https://cdn.modrinth.com/data/BkTdFBUU/4db932c7cf82784b517f138b3c0f184522777d12.png",5210897,502,[],"2024-06-13T18:19:42.056074+00:00",[],["1.7.10","1.8","1.8.1","1.8.2","1.8.3","1.8.4","1.8.5","1.8.6","1.8.7","1.8.8","1.8.9","1.9","1.9.1","1.9.2","1.9.3","1.9.4"],"https://cdn.modrinth.com/data/BkTdFBUU/images/4631f747b8165e9b5c789d761f98dd2a59c9e144_350.webp"],
    ["UaS8ROxa","miniature-shader","Miniature Shader","Extremely lightweight with shadows and reflections","ukrech","https://cdn.modrinth.com/data/UaS8ROxa/85f373314addaf840d9c8667c797da6e0f7e7034_96.webp",5210817,1918,["potato","reflections","shadows"],"2026-07-29T02:24:44.126491+00:00",[],["1.8.4","1.8.5","1.8.6","1.8.7","1.8.8","1.8.9","1.9","1.9.1","1.9.2","1.9.3","1.9.4","26.1","26.1.1","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/UaS8ROxa/images/47126cd6cc7ab7083c14fce162d185aa7e9953f4_350.webp"],
    ["xEItlMn3","nostalgia-shader","Nostalgia Shader","Capturing the essence of old shaderpacks to create a stylized and modern Minecraft-look.","RRe36","https://cdn.modrinth.com/data/xEItlMn3/49ba53348dd4902ad2a3ae49cc643550ead201bc.png",4586406,1165,["fantasy","medium","vanilla-like"],"2025-02-28T15:37:14.802678+00:00",[],["1.19.1","1.19.2","1.19.3","1.19.4","1.20","1.20.1","1.20.2","1.20.3","1.20.4","1.20.5","1.20.6","1.21","1.21.1","1.21.2","1.21.3","1.21.4"],"https://cdn.modrinth.com/data/xEItlMn3/images/8945ee8a7214f7ba6284705b6c71bccc85a93457_350.webp"],
    ["iHC8BZn4","hysteria-shaders","Hysteria Shaders","Atmospheric, highly customizable horror shaderpack, successor of Insanity Shader.","ElocinDev","https://cdn.modrinth.com/data/iHC8BZn4/51440f1ed2fc1472aa3e5edcdd32d547058d8649_96.webp",3713070,647,["atmosphere","fantasy","potato"],"2024-08-02T06:47:22.675228+00:00",[],["1.7.10","1.8","1.8.1","1.8.2","1.8.3","1.8.4","1.8.5","1.8.6","1.8.7","1.8.8","1.8.9","1.9","1.9.1","1.9.2","1.9.3","1.9.4"],"https://cdn.modrinth.com/data/iHC8BZn4/images/d94d6e9dbf7c1f5b8099784cfd47167ecfcf789f_350.webp"],
    ["W3QK7DQz","vanillaa","VanillAA","Vanilla rendering, but with TAA","vriska","https://cdn.modrinth.com/data/W3QK7DQz/678a321328dceea1bbc3e91b0ecdbd6bb5cd275f.png",3448009,265,["potato","vanilla-like"],"2023-08-31T16:06:43.356899+00:00",[],["1.18.2","1.19.2","1.19.3","1.20.1"],"https://cdn.modrinth.com/data/W3QK7DQz/images/36a6880e44889f45b63e733f6e42a09f0584edde_350.webp"],
    ["Y8161YLz","kappa-shader","Kappa Shader","A high-quality realistic, yet also somewhat stylized shaderpack.","RRe36","https://cdn.modrinth.com/data/Y8161YLz/d3f1efa4f96391ccb139b34264a58c51988384aa_96.webp",3429541,1342,["atmosphere","colored-lighting","pbr"],"2025-02-28T15:26:58.913768+00:00",[],["1.19.1","1.19.2","1.19.3","1.19.4","1.20","1.20.1","1.20.2","1.20.3","1.20.4","1.20.5","1.20.6","1.21","1.21.1","1.21.2","1.21.3","1.21.4"],"https://cdn.modrinth.com/data/Y8161YLz/images/3ed9c691e908da42205867608bf98118a6d060cb_350.webp"],
    ["WX4iF5Cj","potato-shaders","Potato Shaders","A very lightweight shaderpack that is still fancy in its own way.","RRe36","https://cdn.modrinth.com/data/WX4iF5Cj/9debf0377e80ac9bb34bdefab6cf77272c1a6830_96.webp",3374610,574,["bloom","fantasy","potato"],"2023-06-13T11:44:15.757781+00:00",[],["1.16.2","1.16.3","1.16.4","1.16.5","1.17","1.17.1","1.18","1.18.1","1.18.2","1.19","1.19.1","1.19.2","1.19.3","1.19.4","1.20","1.20.1"],"https://cdn.modrinth.com/data/WX4iF5Cj/images/9fcb0f0058da04e738692f1bd36aa144a510cca7_350.webp"],
    ["6uJCfiCH","spooklementary","Spooklementary","A Spooky, very moody and atmospheric Complementary Shaders Edit","SpacEagle17","https://cdn.modrinth.com/data/6uJCfiCH/d99992fa45df7ab13ec3b20e357fe1930c10f381_96.webp",3367696,877,["atmosphere","fantasy","reflections"],"2025-12-05T10:01:51.347861+00:00",[],["1.8.4","1.8.5","1.8.6","1.8.7","1.8.8","1.8.9","1.9","1.9.1","1.9.2","1.9.3","1.9.4","26.1","26.1.1","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/6uJCfiCH/images/4207cac0d317adb4877531e6fd7641d016798524_350.webp"],
    ["DoODk4HD","i-like-vanilla","I Like Vanilla","A shader that improves minecraft's style instead of replacing it","What42","https://cdn.modrinth.com/data/DoODk4HD/5b4af5f29752b405d5e2244d3757551ef323cdbd_96.webp",2989823,580,["fantasy","low","vanilla-like"],"2026-10-07T03:48:43.579574+00:00",[],["1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/DoODk4HD/images/e4e94994f4e50891e25fb1147e1768cd9d751a1d_350.webp"],
    ["EPsIYDj1","vanilla-plus-shader","Vanilla Plus Shader","A shaderpack that gives Minecraft a modern visual overhaul while staying faithful to its original look.","RRe36","https://cdn.modrinth.com/data/EPsIYDj1/ebc9166345b79c602c18df0dc9f7c4c68d28e998_96.webp",2803304,505,["low","shadows","vanilla-like"],"2025-02-28T15:44:20.029200+00:00",[],["1.19.1","1.19.2","1.19.3","1.19.4","1.20","1.20.1","1.20.2","1.20.3","1.20.4","1.20.5","1.20.6","1.21","1.21.1","1.21.2","1.21.3","1.21.4"],"https://cdn.modrinth.com/data/EPsIYDj1/images/cb618c53c7418b38d9b7b0f2aab5ba88b3ab9bff_350.webp"],
    ["l6Uqs2fS","visual-vibrance","Visual Vibrance","An attempt at recreating the new 'Vibrant Visuals' for Iris.","jbritain","https://cdn.modrinth.com/data/l6Uqs2fS/db90a1867834eef23eeb026ce9d62a7dd1f07b67_96.webp",2659222,635,["reflections","shadows","vanilla-like"],"2026-02-01T01:00:52.568887+00:00",[],["1.20.6","1.21","1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2"],"https://cdn.modrinth.com/data/l6Uqs2fS/images/73270763c8f37e5e3619c11e6d44a384f721ed14_350.webp"],
    ["sclYVqbt","noble","Noble Shaders","Using clever lighting techniques and powerful customization to create clean, immersive, and enjoyable visuals.","BelmuTM","https://cdn.modrinth.com/data/sclYVqbt/e8d8244abbad99de033b013a046d9fa4f7a084fc_96.webp",2481946,777,["fantasy","pbr","realistic"],"2026-09-28T19:52:42.006219+00:00",[],["1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/sclYVqbt/images/0cc0cbadcfb699811bcefc3121b3ce6907796f85_350.webp"],
  ],
  datapack: [
    ["OhduvhIc","veinminer","VeinMiner","Mine the whole vein on mining a single ore/block. Make the tedious mining experience to something satisfying and fun! FTB Ultimine alternative","Miraculixx","https://cdn.modrinth.com/data/OhduvhIc/5ea1f538e66ee4d4e5e571ad952cba0e06e0bd5c.png",104525869,7074,["bukkit","equipment","folia","game-mechanics"],"2026-11-14T13:41:15.308531+00:00",["fabric","forge","neoforge","quilt"],["1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/OhduvhIc/images/5ed63b5c5bfffadc782bde4a140ec8674f2d49a4.png"],
    ["8oi3bsk5","terralith","Terralith","Explore almost 100 new biomes consisting of both realism and light fantasy, using just Vanilla blocks. Complete with several immersive structures to compliment ","Starmute","https://cdn.modrinth.com/data/8oi3bsk5/1959d924a1088944bbf07a06ba523726112d7e7a_96.webp",24910277,9104,["worldgen"],"2026-09-27T20:51:12.661098+00:00",["fabric","forge","neoforge","quilt"],["1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/8oi3bsk5/images/c4168f5d280c85e0e3d050bb8f3bc776fd0762d4_350.webp"],
    ["tpehi7ww","dungeons-and-taverns","Dungeons and Taverns","A Structure Datapack adding dungeons, taverns and other structures to find while you explore the world.","NovaWostra","https://cdn.modrinth.com/data/tpehi7ww/429ba22d212868940cdd82465df949ac51c9791e_96.webp",22302392,9200,["adventure","worldgen"],"2026-10-31T04:01:57.759218+00:00",["fabric","forge","neoforge"],["1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/tpehi7ww/images/93dc2790ee15a172f5e7a9100790dedde9ea6b35_350.webp"],
    ["DjLobEOy","towns-and-towers","Towns and Towers","Spice up your world with new villages, pillager outposts, and even new ships!","Biban_Auriu","https://cdn.modrinth.com/data/DjLobEOy/f7f552ec019c9ad8b777c9ab5eecbb95da8707a0_96.webp",18893903,5207,["adventure","worldgen"],"2026-10-27T10:49:30.979138+00:00",["fabric","forge","neoforge","quilt"],["1.20.6","1.21","1.21.1","1.21.10","1.21.11","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","26.1","26.1.1","26.1.2","26.2","26.3"],null],
    ["4sP0LXxp","veinminer-enchantment","VeinMiner Enchantment","Veinminer Addon - Adds vineminer enchantment to enchanting tables. Only tools with the enchantment can veinmine","Miraculixx","https://cdn.modrinth.com/data/4sP0LXxp/1e37ba60062cf9455fc75d61c653a75d11825783.png",18367293,1360,["equipment","folia","game-mechanics","paper"],"2026-11-14T13:41:42.195937+00:00",["fabric","neoforge","quilt"],["1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/4sP0LXxp/images/911269ebdb51b9c306d63374d86355db23df5e01.webp"],
    ["lWDHr9jE","tectonic","Tectonic","Terrain shaping brought to new heights, grander and more varied than ever before!","Apollo","https://cdn.modrinth.com/data/lWDHr9jE/d8b3413f797479dcc0d8764756613e449a358a2e_96.webp",17768489,7599,["adventure","worldgen"],"2026-11-07T01:44:16.031453+00:00",["fabric","forge","neoforge","quilt"],["1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/lWDHr9jE/images/f58d0d6af34191ac2fc45e13d080f64696ea11ba_350.webp"],
    ["h2jngREY","trek","Trek","Bored of vanilla structure generation? This pack is for you!","hotsuop","https://cdn.modrinth.com/data/h2jngREY/e4d877248cf243e4e99cd71464417388ea332835_96.webp",12762105,1562,["adventure","worldgen"],"2026-10-24T07:39:33.876857+00:00",["fabric","forge","neoforge","quilt"],["1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/h2jngREY/images/ead97d38ff61a99fe5a93245edcfd9c682494798_350.webp"],
    ["hl5OLM95","geophilic","Geophilic","A subtle-ish overhaul of vanilla Overworld biomes! Reworked!","bebebea_loste","https://cdn.modrinth.com/data/hl5OLM95/6846fa80f84d2baa0dd07f8ee65b6f10bf223a84_96.webp",11294089,3950,["adventure","worldgen"],"2026-09-24T18:24:26.371199+00:00",["fabric","forge","neoforge","quilt"],["1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/hl5OLM95/images/db71b9690f91fa307c92ca986cdee17c3015d6b3_350.webp"],
    ["ZVzW5oNS","incendium","Incendium Legacy","A nether biome overhaul combined with challenging structures to conquer, unique weapons to obtain, and tricky mobs to defeat.","Starmute","https://cdn.modrinth.com/data/ZVzW5oNS/65c8dcaaf260e5b2182c228a1a442c792a7c4782.jpeg",10665284,3179,["adventure","worldgen"],"2026-10-12T15:47:37.693799+00:00",["fabric","forge","neoforge","quilt"],["1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],null],
    ["W2pr9jyL","cobblemon-additions","Cobblemon additions","A Mod that adds villages with Pokemon Village/City variants - Originally made for the Brocraft server.\n\nThis will spawn in a variety of structures within the vi","strikebyte","https://cdn.modrinth.com/data/W2pr9jyL/67d983f03a3dfdfc690ae1de158120124872d85f_96.webp",10572967,687,["adventure","decoration","worldgen"],"2026-03-19T03:49:34.383218+00:00",["fabric"],["1.20.1","1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9"],null],
    ["HSfsxuTo","explorify","Explorify","A simplistic, vanilla-friendly collection of new structures.","bebebea_loste","https://cdn.modrinth.com/data/HSfsxuTo/e036a417f857abd937326db5c131296ad88bad5b_96.webp",10074409,3277,["adventure","worldgen"],"2026-11-08T12:29:02.060553+00:00",["fabric","forge","neoforge","quilt"],["1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/HSfsxuTo/images/ca1549848b1aa4ecfdd8c2d750c7b25a762f6131_350.webp"],
    ["j3FONRYr","structory-towers","Structory: Towers","Adds immersive biome-themed towers to the world, as a standalone option or add-on to Structory","Starmute","https://cdn.modrinth.com/data/j3FONRYr/e7d6877a7b7a03680383fd1a1fdd3496604e372a_96.webp",10014396,960,["adventure","decoration","worldgen"],"2026-09-24T23:48:04.291358+00:00",["fabric","forge","neoforge","quilt"],["1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/j3FONRYr/images/b4f8eb693c6679fa4dc075028fff5b3b19c5fdb8_350.webp"],
    ["2V1Y86sc","navas-zamega","Navas ZA Megas","Adds All Megas from Pokemon Legends ZA into Cobblemon! (MSD Required)","natusue233","https://cdn.modrinth.com/data/2V1Y86sc/c0f10eeeb1a3e5824ecfedc39b9a78a32652572e_96.webp",9948355,239,["adventure"],"2026-10-13T04:28:10.156734+00:00",["fabric","neoforge"],["1.21.1"],null],
    ["aKCwCJlY","structory","Structory","A seasonally updated and atmospheric structure mod with light lore","Starmute","https://cdn.modrinth.com/data/aKCwCJlY/81c79a9d58c605ad79c4a8da15c865902bec8d42_96.webp",9390188,2003,["adventure","decoration","worldgen"],"2026-09-24T23:48:48.878838+00:00",["fabric","forge","neoforge","quilt"],["1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/aKCwCJlY/images/45b042b8b47a8884b54c5ae7a35b17773cbe44d8_350.webp"],
    ["7YjclEGc","dynamic-lights","Dynamic Lights","Supported entities and items such as torches, lanterns, or enchanted gear emit light! Server-side!","Tschipcraft","https://cdn.modrinth.com/data/7YjclEGc/0b491b5a8bfd478037f1392f1d3effc773758ef9.png",7995222,4427,["adventure","game-mechanics","utility"],"2026-06-24T15:41:32.731661+00:00",["fabric","forge","neoforge","quilt"],["1.21","1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2"],"https://cdn.modrinth.com/data/7YjclEGc/images/99af6c2eb0a131ad4336169fd420482792a2e26b_350.webp"],
    ["zrzYrlm0","spawn-animations","Spawn Animations","Hostile mobs dig out of the ground or poof into existence when they spawn!","Tschipcraft","https://cdn.modrinth.com/data/zrzYrlm0/f1d1fea6dd27a539d04c46fdd98d6efcfeb90b9a.png",7349328,3453,["adventure","game-mechanics","mobs"],"2026-09-29T12:45:18.115954+00:00",["fabric","forge","neoforge","quilt"],["1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/zrzYrlm0/images/24effdee5bcf30ad081b352d7de9aa02ecf4c427_350.webp"],
    ["XCIMrYn0","hearths","Hearths","A handful of additions to vanilla Nether biomes","bebebea_loste","https://cdn.modrinth.com/data/XCIMrYn0/92b9b8dc8ba77c1c92c47b7364a31544a7326633_96.webp",6667069,788,["adventure","worldgen"],"2025-10-14T14:54:17.225030+00:00",["fabric","forge","neoforge","quilt"],["1.20.2","1.20.3","1.20.4","1.20.5","1.20.6","1.21","1.21.1","1.21.10","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9"],"https://cdn.modrinth.com/data/XCIMrYn0/images/2fffc0c0590bc6645f534da2c240e91619d4b94d_350.webp"],
    ["MCnBYP0b","true-ending","True Ending - Ender Dragon Overhaul","An Ender Dragon overhaul with progressing difficulty, new attacks, and elegant particle animation.","limesplatus","https://cdn.modrinth.com/data/MCnBYP0b/7c5a3e36e2509d4de48eabd29824d53ef4fb3158_96.webp",6616137,1941,["magic","mobs"],"2025-10-19T22:39:52.682291+00:00",["fabric","forge","neoforge","quilt"],["1.20.6","1.21","1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2"],"https://cdn.modrinth.com/data/MCnBYP0b/images/ea3a32fdb577f54a944e050302006098ec5b14a4_350.webp"],
    ["jbbBrQVa","missingmons-cobblemon","MissingMons [cobblemon]","MissingMons adds textures, models, animations and spawn for cobblemon that's curently not in the game yet but the catch is you guys get to vote for what i will ","RedRibbonz","https://cdn.modrinth.com/data/jbbBrQVa/a926df3952f62c1d289cf1b15a89b5a750a10de2.png",6378504,470,["adventure","mobs"],"2026-07-27T22:31:36.651361+00:00",["fabric","forge","neoforge","quilt"],["1.19","1.19.1","1.19.2","1.19.3","1.20","1.20.1","1.20.2","1.20.3","1.20.4","1.20.5","1.20.6","1.21","1.21.1"],"https://cdn.modrinth.com/data/jbbBrQVa/images/b67dc51cfd119b5cbb3dbaefe562d1893d3e434e_350.webp"],
    ["p1WH6sHr","from-the-fog","From The Fog","Enter a world of fear and mystery with From The Fog, a Minecraft mod that brings the legendary Herobrine to life in a spooky and immersive way true to the legen","Bret06","https://cdn.modrinth.com/data/p1WH6sHr/bb4b839b9cd0f1dc51ee5ac08081fb76df42ebe1_96.webp",5994691,2842,["adventure","cursed","worldgen"],"2026-11-13T22:00:32.359861+00:00",["fabric","forge","neoforge"],["1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],"https://cdn.modrinth.com/data/p1WH6sHr/images/18dcbb957d7063e4ee8a437f1e51609ba9aa3661_350.webp"],
    ["TiFXQSAQ","mysticmons","MysticMons","This pack includes models and animations for Pokemon currently not available in the base mod. Also enables Legendaries to spawn in the wild","iMystxc-dev","https://cdn.modrinth.com/data/TiFXQSAQ/84cde575bb15f9a7b98668dacbba49bee773e4f6_96.webp",5982990,323,["mobs"],"2025-02-16T02:04:25.339384+00:00",[],["1.19","1.19.1","1.19.2","1.19.3","1.20.1","1.21.1"],"https://cdn.modrinth.com/data/TiFXQSAQ/images/39945d92a810d1ed884b87cc9eb60ac3247a076f_350.webp"],
    ["LPjGiSO4","nullscape","Nullscape","Transforms the boring Vanilla end into an alien dimension with the most surreal terrain imaginable. Topped with a couple of new biomes to add to the experience,","Starmute","https://cdn.modrinth.com/data/LPjGiSO4/30249e0548b8643b1559889eab585683cb397f3a_96.webp",5963203,2821,["worldgen"],"2026-09-28T17:28:35.304383+00:00",["fabric","forge","neoforge","quilt"],["1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9","26.1","26.1.1","26.1.2","26.2","26.3"],null],
    ["lIDAJAby","cobblemotion","CobbleMotion - Animation Resource Pack","A resource pack that adds simple idle animations to battle animations for Cobblemon models that do not have any.","Lenkagari","https://cdn.modrinth.com/data/lIDAJAby/cc9e4863f6465fa2de72757c16f80c556ee90886_96.webp",5777417,299,["decoration","entities"],"2026-11-07T20:14:23.350249+00:00",[],["1.21","1.21.1"],"https://cdn.modrinth.com/data/lIDAJAby/images/3a92a1790b2c2804d85d79e73f7d8b05f38ab1d9.gif"],
    ["8Lw09aLb","lukis-grand-capitals","Luki's Grand Capitals","Rebuilt vanilla villages and illager structures to breathe new life into your world!","lukidonu","https://cdn.modrinth.com/data/8Lw09aLb/3a40a5289738375174b0bab530858dc3f128ab82_96.webp",5693981,1918,["adventure","decoration","worldgen"],"2026-01-13T23:07:39.527541+00:00",["fabric","forge","neoforge","quilt"],["1.20.3","1.20.4","1.20.5","1.20.6","1.21","1.21.1","1.21.10","1.21.11","1.21.2","1.21.3","1.21.4","1.21.5","1.21.6","1.21.7","1.21.8","1.21.9"],"https://cdn.modrinth.com/data/8Lw09aLb/images/b68ba863816a0443b7bb43d89958171b2283046e_350.webp"],
  ],
  cats: {
    mod: ["adventure","cursed","decoration","economy","equipment","food","game-mechanics","library","magic","management","minigame","mobs","optimization","social","storage","technology","transportation","utility","worldgen"],
    modpack: ["adventure","challenging","combat","kitchen-sink","lightweight","magic","multiplayer","optimization","quests","technology"],
    shader: ["cartoon","cursed","fantasy","realistic","semi-realistic","vanilla-like"],
    resourcepack: ["combat","cursed","decoration","modded","realistic","simplistic","themed","tweaks","utility","vanilla-like"],
  },
  sodium: {"body":"**This mod is the result of thousands of hours of development, and is made possible thanks to players like you.** If you would like to show a token of your appreciation for my work, and help support the development of Sodium in the process, then consider [buying me a coffee](https://caffeinemc.net/donate).\n\n[![Buy me a coffee](https://cdn.modrinth.com/data/cached_images/b888841adf2a7d4d76c5274d634c205ee88e9e20.png)](https://caffeinemc.net/donate)\n[![Join us on Discord](https://cdn.modrinth.com/data/cached_images/de7f2f606702569cd98fc1f6a0b29dbf817dd870.png)](https://caffeinemc.net/discord)\n\n---\n\n<center>\n <img src=\"https://cdn.modrinth.com/data/AANobbMI/images/5ca2e8f6c72f3d543dd3dc95b706964c5678d80e.png\" alt=\"Sodium 0.4 Comparison\"></img>\n <p>\n   <!-- This paragraph is load bearing, and ensures a margin is added before the following Markdown -->\n </p>\n</center>\n\nSodium is a powerful optimization mod for the Minecraft client, which greatly improves frame rates and micro-stutter, while fixing many graphical issues in Minecraft.\n\nUnlike other rendering-focused mods, it boasts wide compatibility with the wider modding ecosystem. And it does so without compromising on how the game looks, giving you that authentic block game feel.\n\n[![Available on Fabric](https://cdn.modrinth.com/data/cached_images/513035d1231a86dff137c74e04a5e64633593f10.png)](https://modrinth.com/mod/sodium/versions?l=fabric)\n[![Available on Quilt](https://cdn.modrinth.com/data/cached_images/a9ee492fd1a5fcbcc14d4105aa27be63f2518529.png)](https://modrinth.com/mod/sodium/versions?l=quilt)\n[![Available on NeoForge](https://cdn.modrinth.com/data/cached_images/b9ae07fbc26c08220b4856cb244f86904d0c172c.png)](https://modrinth.com/mod/sodium/versions?l=neoforge)\n\n<h1 id=\"installation\">📥 Installation Guide</h1>\n\nSodium is available for multiple mod loaders, but we recommend using [Fabric Loader](https://fabricmc.net/use) for the most simple and lightweight experience. If you are using a third-party launcher, it probably has built-in functionality to automatically install mod loaders. Once you have installed your mod loader, you can simply place Sodium into your _mods folder_ like anything else.\n\n**Not sure if you installed the mod correctly?** Check your _Video Settings_ screen in Minecraft, which should show our new and improved user interface for changing settings.\n\n**Not sure how to configure the mod?** Don't worry, you probably don't need to. By default, Sodium will enable all optimizations which are supported on your system, giving you the best experience possible. You should generally only change video settings related to performance and other advanced features if you are experiencing issues.\n\n**Need even more performance?** By design, Sodium only optimizes the rendering code of Minecraft. You should also install our other mods, such as [Lithium](https://modrinth.com/mod/lithium) (for MC 1.15+) and [Phosphor](https://modrinth.com/mod/phosphor) (for MC <1.19), to optimize the other parts of your game. This is done so that players can pick and choose which mods they want to use, but we generally recommend using [our entire collection](https://modrinth.com/user/jellysquid3).\n\n<h1 id=\"hardware-compatibility\">✅ Hardware Compatibility</h1>\n\n**Android devices (and some Windows-on-ARM devices) which use OpenGL translation layers (such as GL4ES, ANGLE, GLonD3D12 etc) are not supported and will have severe performance issues.**\n\nWe only provide official support for desktop graphics cards which have up-to-date drivers compatible with OpenGL 4.5 or newer. Most graphics cards released in the past 12 years will meet these requirements, including the following:\n\n- INTEL HD Graphics 500 Series (Skylake) or newer\n- NVIDIA GeForce 400 Series (Fermi) or newer\n- AMD Radeon HD 7000 Series (GCN 1) or newer\n\n**Nearly all desktop graphics cards that are already compatible with Minecraft (which requires OpenGL 3.3) should also work with Sodium.** But our team cannot ensure compatibility or provide support for older graphics cards, and they may not work with future versions of Sodium.\n\n**If you are running into problems, you should [make sure that your graphics drivers are up-to-date](https://github.com/CaffeineMC/sodium/wiki/Driver-Compatibility).** Out-of-date graphics drivers are often the reason for most crashes, rendering bugs, and performance issues.\n\n# 🐛 How to Report Issues\n\nPlease use the [issue tracker](https://github.com/CaffeineMC/sodium/issues) linked at the top of the page to report bugs, crashes, and other issues. Make sure you include information about the mods you are using, and attach any crash/log files you have.\n\n---\n\n_**Note:** The level of performance you see while using the Sodium mod will vary depending on exact hardware and software configuration. For all performance comparisons provided on this page, we used a computer with integrated graphics which we believe to be representative of the casual player._\n\n<sup>_**Hardware configuration:** Intel Core i7-1165G7 (4c/8t, up to 4.70 GHz) with Intel Xe Graphics (96 EUs, up to 1.30 GHz), 2x16 GB DDR4-3200._</sup>\n<sup>_**Software configuration:** Fedora 41, Linux 6.12.4, Mesa 24.3.4, Prism Launcher 9.1, OpenJDK 21.0.7 runtime (as packaged by distribution), Fabric Loader 0.16.10._</sup>\n\n---\n\n<img src=\"https://cdn.modrinth.com/data/cached_images/e40ae9edc74c6d5b07fd33b61aeeec4b2defd6b9_0.webp\" height=\"42\"></img>","gallery":[{"url":"https://cdn.modrinth.com/data/AANobbMI/images/d84313e6f57dc9e7896961dbd2dfc2689d482758_350.webp","title":"Underwater Lighting Improvements","description":"Sodium fixes many graphical issues with smooth lighting while underwater.","featured":false},{"url":"https://cdn.modrinth.com/data/AANobbMI/images/6b0e58705156ba67a6d97a74b9f9ac05da69f502_350.webp","title":"Biome Blending Improvements","description":"Sodium improves biome blending to use gradients across each block, making the effect look much smoother.","featured":false},{"url":"https://cdn.modrinth.com/data/AANobbMI/images/b681a9e87daa53a0e85336a894db70427007149b_350.webp","title":"Fluid Rendering Improvements","description":"Sodium implements smooth lighting for all fluids, fixing a long-standing issue in Minecraft.","featured":false},{"url":"https://cdn.modrinth.com/data/AANobbMI/images/56c4599efcb529a19aed0e118caad4178d7fd540.webp","title":"Block Shading Improvements","description":"Sodium greatly improves the shading of blocks, fixing a number of bugs while making block shadows look more smooth and consistent.","featured":false},{"url":"https://cdn.modrinth.com/data/AANobbMI/images/5ca2e8f6c72f3d543dd3dc95b706964c5678d80e_350.webp","title":"Sodium 0.5.2","description":"Sodium greatly optimizes the game's renderer to be faster and more efficient, which can often result in FPS improvements of 300% or more.","featured":false},{"url":"https://cdn.modrinth.com/data/AANobbMI/images/c39debea7fc623306e9c45148084585399fc59ee.webp","title":"Sodium 0.4.1","description":"Sodium greatly optimizes the game's renderer to be faster and more efficient, which can often result in FPS improvements of 300% or more.","featured":false}],"links":{"website":null,"source":"https://github.com/CaffeineMC/sodium","issues":"https://github.com/CaffeineMC/sodium/issues","wiki":"https://github.com/CaffeineMC/sodium/wiki","discord":"https://caffeinemc.net/discord"},"license":"LicenseRef-Polyform-Shield-1.0.0","published":"2021-01-03T00:53:34.185936Z"},
  sodiumVersions: [
    ["CT6qQx01","Sodium 0.9.3-beta.5 for NeoForge 26.3","mc26.3-0.9.3-beta.5-neoforge",["26.3"],["neoforge"],"beta","2026-11-12T01:12:30.162066Z",91777,"sodium-neoforge-0.9.3-beta.5+mc26.3.jar",1211839,"Sodium 0.9.3-beta.5 implements a number of bug fixes and minor improvements.\n\n- Show macOS fullscreen menu visibility option on the Sodium options screen\n- Fix Fluid Culling For Non-Full Blocks With Unusual Shapes ([#3916](https://github.com/CaffeineMC/sodium/pull/3916))\n- Use SDL message box instead of TFD ([#3923](https://github.com/CaffeineMC/sodium/pull/3923))\n- Optimization for shelf mushroom"],
    ["v7Lw0h1m","Sodium 0.9.3-beta.5 for Fabric 26.3","mc26.3-0.9.3-beta.5-fabric",["26.3"],["fabric"],"beta","2026-11-12T01:12:30.154674Z",187680,"sodium-fabric-0.9.3-beta.5+mc26.3.jar",1914521,"Sodium 0.9.3-beta.5 implements a number of bug fixes and minor improvements.\n\n- Show macOS fullscreen menu visibility option on the Sodium options screen\n- Fix Fluid Culling For Non-Full Blocks With Unusual Shapes ([#3916](https://github.com/CaffeineMC/sodium/pull/3916))\n- Use SDL message box instead of TFD ([#3923](https://github.com/CaffeineMC/sodium/pull/3923))\n- Optimization for shelf mushroom"],
    ["zqgcaQxE","Sodium 0.9.3-beta.4 for NeoForge 26.3","mc26.3-0.9.3-beta.4-neoforge",["26.3"],["neoforge"],"beta","2026-11-08T03:54:24.510506Z",94510,"sodium-neoforge-0.9.3-beta.4+mc26.3.jar",1210614,"Sodium 0.9.3-beta.4 implements a number of bug fixes and minor improvements.\n\n- Show macOS fullscreen menu visibility option on the Sodium options screen\n- Fix Fluid Culling For Non-Full Blocks With Unusual Shapes ([#3916](https://github.com/CaffeineMC/sodium/pull/3916))\n- Use SDL message box instead of TFD ([#3923](https://github.com/CaffeineMC/sodium/pull/3923))\n- Optimization for shelf mushroom"],
    ["2MZWfUts","Sodium 0.9.3-beta.4 for Fabric 26.3","mc26.3-0.9.3-beta.4-fabric",["26.3"],["fabric"],"beta","2026-11-08T03:54:24.496862Z",158774,"sodium-fabric-0.9.3-beta.4+mc26.3.jar",1913034,"Sodium 0.9.3-beta.4 implements a number of bug fixes and minor improvements.\n\n- Show macOS fullscreen menu visibility option on the Sodium options screen\n- Fix Fluid Culling For Non-Full Blocks With Unusual Shapes ([#3916](https://github.com/CaffeineMC/sodium/pull/3916))\n- Use SDL message box instead of TFD ([#3923](https://github.com/CaffeineMC/sodium/pull/3923))\n- Optimization for shelf mushroom"],
    ["aFVpk3tG","Sodium 0.9.3-beta.3 for Fabric 26.3","mc26.3-0.9.3-beta.3-fabric",["26.3"],["fabric"],"beta","2026-11-07T02:07:28.269034Z",118698,"sodium-fabric-0.9.3-beta.3+mc26.3.jar",1913009,"Sodium 0.9.3-beta.3 implements a number of bug fixes and minor improvements.\n\n- Show macOS fullscreen menu visibility option on the Sodium options screen\n- Fix Fluid Culling For Non-Full Blocks With Unusual Shapes ([#3916](https://github.com/CaffeineMC/sodium/pull/3916))\n- Use SDL message box instead of TFD ([#3923](https://github.com/CaffeineMC/sodium/pull/3923))\n- Optimization for shelf mushroom"],
    ["Sx1xfT5Y","Sodium 0.9.3-beta.3 for NeoForge 26.3","mc26.3-0.9.3-beta.3-neoforge",["26.3"],["neoforge"],"beta","2026-11-07T02:07:28.204186Z",8168,"sodium-neoforge-0.9.3-beta.3+mc26.3.jar",1210060,"Sodium 0.9.3-beta.3 implements a number of bug fixes and minor improvements.\n\n- Show macOS fullscreen menu visibility option on the Sodium options screen\n- Fix Fluid Culling For Non-Full Blocks With Unusual Shapes ([#3916](https://github.com/CaffeineMC/sodium/pull/3916))\n- Use SDL message box instead of TFD ([#3923](https://github.com/CaffeineMC/sodium/pull/3923))\n- Optimization for shelf mushroom"],
    ["RlRgB5qP","Sodium 0.9.3-beta.2 for Fabric 26.3","mc26.3-0.9.3-beta.2-fabric",["26.3"],["fabric"],"beta","2026-11-07T01:34:13.438886Z",8746,"sodium-fabric-0.9.3-beta.2+mc26.3.jar",1912995,"Sodium 0.9.3-beta.2 implements a number of bug fixes and minor improvements.\n\n- Show macOS fullscreen menu visibility option on the Sodium options screen\n- Fix Fluid Culling For Non-Full Blocks With Unusual Shapes ([#3916](https://github.com/CaffeineMC/sodium/pull/3916))\n- Use SDL message box instead of TFD ([#3923](https://github.com/CaffeineMC/sodium/pull/3923))\n- Optimization for shelf mushroom"],
    ["V4VWv3Mk","Sodium 0.9.3-beta.2 for NeoForge 26.3","mc26.3-0.9.3-beta.2-neoforge",["26.3"],["neoforge"],"beta","2026-11-07T01:34:13.436565Z",1130,"sodium-neoforge-0.9.3-beta.2+mc26.3.jar",1210041,"Sodium 0.9.3-beta.2 implements a number of bug fixes and minor improvements.\n\n- Show macOS fullscreen menu visibility option on the Sodium options screen\n- Fix Fluid Culling For Non-Full Blocks With Unusual Shapes ([#3916](https://github.com/CaffeineMC/sodium/pull/3916))\n- Use SDL message box instead of TFD ([#3923](https://github.com/CaffeineMC/sodium/pull/3923))\n- Optimization for shelf mushroom"],
    ["g6ju16VJ","Sodium 0.9.3-beta.1 for Fabric 26.3","mc26.3-0.9.3-beta.1-fabric",["26.3"],["fabric"],"beta","2026-10-15T17:51:44.107526Z",1044894,"sodium-fabric-0.9.3-beta.1+mc26.3.jar",1912496,"Sodium 0.9.3-beta.1 implements a number of bug fixes and minor improvements.\n\n- Show macOS fullscreen menu visibility option on the Sodium options screen\n- Fix Fluid Culling For Non-Full Blocks With Unusual Shapes ([#3916](https://github.com/CaffeineMC/sodium/pull/3916))\n- Use SDL message box instead of TFD ([#3923](https://github.com/CaffeineMC/sodium/pull/3923))\n- Optimization for shelf mushroom"],
    ["SS023RVV","Sodium 0.9.3-beta.1 for NeoForge 26.3","mc26.3-0.9.3-beta.1-neoforge",["26.3"],["neoforge"],"beta","2026-10-15T17:51:44.019537Z",96164,"sodium-neoforge-0.9.3-beta.1+mc26.3.jar",1209577,"Sodium 0.9.3-beta.1 implements a number of bug fixes and minor improvements.\n\n- Show macOS fullscreen menu visibility option on the Sodium options screen\n- Fix Fluid Culling For Non-Full Blocks With Unusual Shapes ([#3916](https://github.com/CaffeineMC/sodium/pull/3916))\n- Use SDL message box instead of TFD ([#3923](https://github.com/CaffeineMC/sodium/pull/3923))\n- Optimization for shelf mushroom"],
    ["NM9w06Kr","Sodium 0.9.3-alpha.1 for NeoForge 26.3","mc26.3-0.9.3-alpha.1-neoforge",["26.3"],["neoforge"],"alpha","2026-09-20T21:27:09.277251Z",135060,"sodium-neoforge-0.9.3-alpha.1+mc26.3.jar",1211416,"Sodium 0.9.3-alpha.1 fixes graphical glitches on Intel iGPUs, fluid culling for unusual blocks, and adds the macOS fullscreen menu visibility option.\n\n- Fix graphical glitches on some Intel iGPUs\n- Show macOS fullscreen menu visibility option on the Video Settings screen\n- Fix Fluid Culling For Non-Full Blocks With Unusual Shapes ([#3916](https://github.com/CaffeineMC/sodium/pull/3916))"],
    ["v4PSXean","Sodium 0.9.3-alpha.1 for Fabric 26.3","mc26.3-0.9.3-alpha.1-fabric",["26.3"],["fabric"],"alpha","2026-09-20T21:27:07.494280Z",1015444,"sodium-fabric-0.9.3-alpha.1+mc26.3.jar",1911459,"Sodium 0.9.3-alpha.1 fixes graphical glitches on Intel iGPUs, fluid culling for unusual blocks, and adds the macOS fullscreen menu visibility option.\n\n- Fix graphical glitches on some Intel iGPUs\n- Show macOS fullscreen menu visibility option on the Video Settings screen\n- Fix Fluid Culling For Non-Full Blocks With Unusual Shapes ([#3916](https://github.com/CaffeineMC/sodium/pull/3916))"],
    ["sVLtC9EW","Sodium 0.8.15-beta.1 for NeoForge 1.21.11","mc1.21.11-0.8.15-beta.1-neoforge",["1.21.11"],["neoforge"],"beta","2026-09-20T21:25:58.517468Z",73428,"sodium-neoforge-0.8.15-beta.1+mc1.21.11.jar",1143429,"Sodium 0.8.15-beta.1 adds optimized pitcher plant models, and fixes two bugs.\n\n- Optimize pitcher plant models ([#3881](https://github.com/CaffeineMC/sodium/pull/3881))\n- Correctly handle vertexIndex state when discarding invalid translucent quads\n- Fix Fluid Culling For Non-Full Blocks With Unusual Shapes ([#3916](https://github.com/CaffeineMC/sodium/pull/3916))"],
    ["RB7CDjTS","Sodium 0.8.15-beta.1 for Fabric 1.21.11","mc1.21.11-0.8.15-beta.1-fabric",["1.21.11"],["fabric"],"beta","2026-09-20T21:25:58.390320Z",962129,"sodium-fabric-0.8.15-beta.1+mc1.21.11.jar",1914874,"Sodium 0.8.15-beta.1 adds optimized pitcher plant models, and fixes two bugs.\n\n- Optimize pitcher plant models ([#3881](https://github.com/CaffeineMC/sodium/pull/3881))\n- Correctly handle vertexIndex state when discarding invalid translucent quads\n- Fix Fluid Culling For Non-Full Blocks With Unusual Shapes ([#3916](https://github.com/CaffeineMC/sodium/pull/3916))"],
    ["VHtnT9Q4","Sodium 0.9.2 for NeoForge 26.3","mc26.3-0.9.2-neoforge",["26.3"],["neoforge"],"release","2026-09-15T16:04:10.867760Z",184276,"sodium-neoforge-0.9.2+mc26.3.jar",1208169,"Sodium 0.9.2 is a release for Minecraft 26.3. It's based on the recently released Sodium 0.9.2.\n\nIris is not yet compatible. If you want to use Iris, don't update Sodium until Iris receives an update.\n\n- Port to 26.3 ([#3902](https://github.com/CaffeineMC/sodium/pull/3902))\n- Re-enable \"Fullscreen Resolution\" control on Linux ([#3843](https://github.com/CaffeineMC/sodium/pull/3843))\n- Fix a memory"],
    ["bAZQdGpg","Sodium 0.9.2 for Fabric 26.3","mc26.3-0.9.2-fabric",["26.3"],["fabric"],"release","2026-09-15T15:57:23.369305Z",5288310,"sodium-fabric-0.9.2+mc26.3.jar",1908068,"Sodium 0.9.2 is a release for Minecraft 26.3. It's based on the recently released Sodium 0.9.2.\n\n- Port to 26.3 ([#3902](https://github.com/CaffeineMC/sodium/pull/3902))\n- Re-enable \"Fullscreen Resolution\" control on Linux ([#3843](https://github.com/CaffeineMC/sodium/pull/3843))\n- Fix a memory leak caused by recreating resources in the F3 display\n- Fix issues with falling blocks"],
    ["FqtXxXy2","Sodium 0.9.2-beta.2 for Fabric 26.3-rc-1","mc26.3r1-0.9.2-beta.2-fabric",[],["fabric"],"beta","2026-09-12T22:49:42.621484Z",22474,"sodium-fabric-0.9.2-beta.2+mc26.3r1.jar",1907112,"Sodium 0.9.2-beta.2 is a release for Minecraft 26.3-rc-2. It's based on the recently released Sodium 0.9.2.\n\nIris is not yet compatible. If you want to use Iris, don't update Sodium until Iris receives an update.\n\n- Port to 26.3 ([#3902](https://github.com/CaffeineMC/sodium/pull/3902))\n- Re-enable \"Fullscreen Resolution\" control on Linux ([#3843](https://github.com/CaffeineMC/sodium/pull/3843))\n- "],
    ["3rIu1i7C","Sodium 0.9.2-beta.2 for NeoForge 26.3-rc-1","mc26.3r1-0.9.2-beta.2-neoforge",[],["neoforge"],"beta","2026-09-12T22:49:42.566245Z",8177,"sodium-neoforge-0.9.2-beta.2+mc26.3r1.jar",1207890,"Sodium 0.9.2-beta.2 is a release for Minecraft 26.3-rc-2. It's based on the recently released Sodium 0.9.2.\n\nIris is not yet compatible. If you want to use Iris, don't update Sodium until Iris receives an update.\n\n- Port to 26.3 ([#3902](https://github.com/CaffeineMC/sodium/pull/3902))\n- Re-enable \"Fullscreen Resolution\" control on Linux ([#3843](https://github.com/CaffeineMC/sodium/pull/3843))\n- "],
    ["obOyy5BN","Sodium 0.9.2-beta.1 for Fabric 26.3-rc-1","mc26.3r1-0.9.2-beta.1-fabric",[],["fabric"],"beta","2026-09-12T02:41:27.619084Z",4775,"sodium-fabric-0.9.2-beta.1+mc26.3r1.jar",1906760,"Sodium 0.9.2-beta.1 is a release for Minecraft 26.3-rc-2. It's based on the recently released Sodium 0.9.2.\n\nIris is not yet compatible. If you want to use Iris, don't update Sodium until Iris receives an update.\n\n- Port to 26.3 ([#3902](https://github.com/CaffeineMC/sodium/pull/3902))\n- Re-enable \"Fullscreen Resolution\" control on Linux ([#3843](https://github.com/CaffeineMC/sodium/pull/3843))"],
    ["tZQ3jqnf","Sodium 0.9.2 for Fabric 26.1.2","mc26.1.2-0.9.2-fabric",["26.1.2"],["fabric"],"release","2026-09-11T18:18:37.089767Z",788636,"sodium-fabric-0.9.2+mc26.1.2.jar",1940135,"Sodium 0.9.2 includes a new terrain buffer allocation system designed to reduce the number of buffers that get allocated and resized as chunks are loaded and unloaded. Other changes include improvements to our item meshing, optimizations for item rendering, and numerous bug fixes. This release also adds support for FRAPI on NeoForge.\n\nThank you to all the contributors who added to this release!\n\n-"],
    ["zg4YQ9EL","Sodium 0.9.2 for NeoForge 26.1.2","mc26.1.2-0.9.2-neoforge",["26.1.2"],["neoforge"],"release","2026-09-11T18:18:37.088803Z",70983,"sodium-neoforge-0.9.2+mc26.1.2.jar",1260562,"Sodium 0.9.2 includes a new terrain buffer allocation system designed to reduce the number of buffers that get allocated and resized as chunks are loaded and unloaded. Other changes include improvements to our item meshing, optimizations for item rendering, and numerous bug fixes. This release also adds support for FRAPI on NeoForge.\n\nThank you to all the contributors who added to this release!\n\n-"],
    ["DmnNKsfS","Sodium 0.9.2 for NeoForge 26.2","mc26.2-0.9.2-neoforge",["26.2"],["neoforge"],"release","2026-09-11T18:08:29.713803Z",159108,"sodium-neoforge-0.9.2+mc26.2.jar",1209565,"Sodium 0.9.2 includes a new terrain buffer allocation system designed to reduce the number of buffers that get allocated and resized as chunks are loaded and unloaded. Other changes include improvements to our item meshing, optimizations for item rendering, and numerous bug fixes. This release also adds support for FRAPI on NeoForge.\n\nThank you to all the contributors who added to this release!\n\n-"],
    ["xJZxADzI","Sodium 0.9.2 for Fabric 26.2","mc26.2-0.9.2-fabric",["26.2"],["fabric"],"release","2026-09-11T18:08:28.513893Z",3206232,"sodium-fabric-0.9.2+mc26.2.jar",1885572,"Sodium 0.9.2 includes a new terrain buffer allocation system designed to reduce the number of buffers that get allocated and resized as chunks are loaded and unloaded. Other changes include improvements to our item meshing, optimizations for item rendering, and numerous bug fixes. This release also adds support for FRAPI on NeoForge.\n\nThank you to all the contributors who added to this release!\n\n-"],
    ["gQDMcWww","Sodium 0.9.2-beta.1 for NeoForge 26.2","mc26.2-0.9.2-beta.1-neoforge",["26.2"],["neoforge"],"beta","2026-09-02T16:13:20.653230Z",72682,"sodium-neoforge-0.9.2-beta.1+mc26.2.jar",1209586,"Sodium 0.9.2-beta.1 includes a new terrain buffer allocation system designed to reduce the number of buffers that get allocated and resized as chunks are loaded and unloaded. Please help us by testing this version in various scenarios, comparing frame rate stability, and reporting any issues that may arise. Feedback and testing results are welcome in the testing channel on [our discord server](htt"],
  ],
};

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const EXTRA_MC = ["1.21.11", "1.21.10", "1.21.1", "1.20.1"];
const SUFFIX = ["", " Plus", " Extended", " Lite", " Reforged", " Tweaks", " Additions", " Redux"];

function rowToHit(r: Row, type: ProjectType, source: Source, k: number): ProjectHit {
  const versions = [...new Set([...r[11], ...EXTRA_MC.slice(0, 2 + (k % 3))])];
  return {
    source,
    id: (source === "curseforge" ? "cf-" : "") + r[0] + (k ? `-${k}` : ""),
    slug: r[1] + (k ? `-${k}` : ""),
    title: r[2] + SUFFIX[k],
    description: r[3],
    author: r[4],
    icon_url: r[5],
    downloads: Math.round(r[6] / (k + 1) ** 1.6),
    follows: Math.round(r[7] / (k + 1) ** 1.4),
    categories: r[8],
    project_type: type,
    updated: new Date(Date.parse(r[9]) - k * 86400_000 * 9).toISOString(),
    game_versions: versions,
    loaders: type === "mod" || type === "modpack" ? (r[10].length ? r[10] : ["fabric"]) : type === "shader" ? ["iris", "optifine"] : [],
  };
}

const TYPES: ProjectType[] = ["mod", "modpack", "resourcepack", "shader", "datapack"];
const all: Record<Source, Record<ProjectType, ProjectHit[]>> = { modrinth: {} as never, curseforge: {} as never };
for (const source of ["modrinth", "curseforge"] as Source[])
  for (const t of TYPES) {
    const rows = DATA[t];
    const copies = t === "mod" ? 8 : t === "datapack" ? 1 : 3;
    const list: ProjectHit[] = [];
    for (let k = 0; k < copies; k++) for (const r of rows) list.push(rowToHit(r, t, source, k));
    all[source][t] = list;
  }
const findHit = (source: Source, id: string) => {
  for (const t of TYPES) {
    const h = all[source][t].find((x) => x.id === id || x.slug === id);
    if (h) return h;
  }
  return null;
};
const featured = (id: string) => {
  const base = id.replace(/^cf-/, "").replace(/-\d+$/, "");
  for (const t of TYPES) {
    const r = DATA[t].find((x) => x[0] === base);
    if (r) return r[12];
  }
  return null;
};

function search(q: SearchQuery) {
  let list = all[q.source][q.project_type] ?? [];
  const needle = q.query.trim().toLowerCase();
  if (needle) list = list.filter((h) => h.title.toLowerCase().includes(needle) || h.description.toLowerCase().includes(needle) || h.author.toLowerCase().includes(needle));
  if (q.categories.length) list = list.filter((h) => q.categories.every((c) => h.categories.includes(c)));
  if (q.loader) list = list.filter((h) => h.loaders.includes(q.loader!) || (q.loader === "quilt" && h.loaders.includes("fabric")));
  if (q.game_version) list = list.filter((h) => h.game_versions.includes(q.game_version!));
  const sorted = [...list];
  if (q.sort === "downloads") sorted.sort((a, b) => b.downloads - a.downloads);
  else if (q.sort === "follows") sorted.sort((a, b) => b.follows - a.follows);
  else if (q.sort === "updated" || q.sort === "newest") sorted.sort((a, b) => Date.parse(b.updated ?? "") - Date.parse(a.updated ?? ""));
  return { hits: sorted.slice(q.offset, q.offset + q.limit), total: sorted.length, offset: q.offset, limit: q.limit };
}

function details(h: ProjectHit): ProjectDetails {
  const isSodium = h.slug === "sodium" || h.slug.startsWith("sodium-");
  const feat = featured(h.id);
  const body = isSodium
    ? DATA.sodium.body
    : `## ${h.title}\n\n${h.description}\n\n${feat ? `![Vorschau](${feat})\n\n` : ""}### Features\n\n- Läuft mit **${h.loaders.join(", ") || "Vanilla"}**\n- Getestet mit Minecraft ${h.game_versions.slice(-3).join(", ")}\n- Konfigurierbar über \`config/${h.slug}.json\`\n\n> Hinweis: Dies ist eine simulierte Beschreibung für die Entwicklung.\n\n| Version | Status |\n|---|---|\n| ${h.game_versions.at(-1)} | ✅ |\n| ${h.game_versions[0]} | ✅ |\n\n<iframe width="560" height="315" src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>\n\n<script>alert('xss')</script><img src="x" onerror="alert(1)">\n\n[Mehr auf GitHub](https://github.com) · [Relativer Link](/foo)`;
  const gallery: GalleryImage[] = isSodium
    ? DATA.sodium.gallery
    : feat
      ? [{ url: feat, title: "Vorschau", description: h.description, featured: true }, ...DATA.sodium.gallery.slice(0, 3)]
      : [];
  return {
    ...h,
    body,
    body_format: h.source === "curseforge" ? "markdown" : "markdown",
    gallery,
    links: isSodium ? DATA.sodium.links : { website: null, source: "https://github.com/example/" + h.slug, issues: "https://github.com/example/" + h.slug + "/issues", wiki: null, discord: "https://discord.gg/example" },
    license: isSodium ? DATA.sodium.license : "MIT",
    published: isSodium ? DATA.sodium.published : "2023-04-01T10:00:00Z",
    page_url: h.source === "modrinth" ? `https://modrinth.com/${h.project_type}/${h.slug}` : `https://www.curseforge.com/minecraft/mc-mods/${h.slug}`,
  };
}

function versionsFor(h: ProjectHit): ProjectVersion[] {
  if (h.slug === "sodium") {
    return DATA.sodiumVersions.map((v) => ({
      source: h.source,
      id: v[0],
      project_id: h.id,
      name: v[1],
      version_number: v[2],
      game_versions: v[3],
      loaders: v[4],
      release_type: v[5] as ProjectVersion["release_type"],
      date: v[6],
      downloads: v[7],
      files: [{ url: "https://cdn.modrinth.com/x", filename: v[8], size: v[9], sha1: null, primary: true }],
      dependencies: [],
      changelog: v[10],
    }));
  }
  const out: ProjectVersion[] = [];
  const mcs = [...h.game_versions].reverse();
  const loaders = h.loaders.length ? h.loaders.filter((l) => l !== "optifine") : [];
  let n = 0;
  for (const mc of mcs)
    for (const l of loaders.length ? loaders : [null]) {
      const major = Math.max(1, 6 - Math.floor(n / 8));
      const num = `${major}.${(n * 7) % 10}.${n % 4}`;
      const rt: ProjectVersion["release_type"] = n % 9 === 4 ? "beta" : n % 17 === 8 ? "alpha" : "release";
      out.push({
        source: h.source,
        id: `${h.id}-v${n}`,
        project_id: h.id,
        name: `${h.title} ${num}${l ? ` (${l})` : ""}`,
        version_number: `${num}+${mc}`,
        game_versions: [mc],
        loaders: l ? [l] : h.project_type === "resourcepack" ? ["minecraft"] : ["datapack"],
        release_type: rt,
        date: new Date(Date.now() - n * 86400_000 * 11).toISOString(),
        downloads: Math.round(h.downloads / (n + 3)),
        files: [{ url: "https://cdn.example/x", filename: `${h.slug}-${num}.${h.project_type === "mod" ? "jar" : "zip"}`, size: 120_000 + n * 9_731, sha1: null, primary: true }],
        dependencies: n % 3 === 0 && h.project_type === "mod" ? [{ project_id: "P7dR8mSH", version_id: null, kind: "required" }] : [],
        changelog: n % 5 === 2 ? "" : `### Änderungen\n\n- Fehler beim Laden behoben (#${100 + n})\n- Leistung verbessert\n- Übersetzungen aktualisiert`,
      });
      n++;
    }
  return out;
}

// ------------------------------------------------------------------ Inhalte je Instanz

const lists = new Map<string, ContentItem[]>();
const listKey = (id: string, kind: ContentKind) => `${id}|${kind}`;
const kindOf = (t: ProjectType): ContentKind => (t === "resourcepack" ? "resourcepack" : t === "shader" ? "shader" : "mod");

function itemFromHit(h: ProjectHit, kind: ContentKind, i: number, enabled = true): ContentItem {
  const ext = kind === "mod" ? "jar" : "zip";
  const ver = `${1 + (i % 5)}.${(i * 3) % 10}.${i % 7}`;
  const file = `${h.slug}-${ver}.${ext}`;
  return {
    file_name: enabled ? file : `${file}.disabled`,
    kind,
    enabled,
    name: h.title,
    version: ver,
    description: h.description,
    authors: [h.author, ...(i % 4 === 0 ? ["Contributors"] : [])],
    icon: h.icon_url,
    source: i % 9 === 3 ? null : i % 5 === 1 ? "curseforge" : "modrinth",
    project_id: i % 9 === 3 ? null : h.id,
    version_id: null,
    size: 50_000 + ((i * 7919) % 900_000),
    modified: Date.now() - i * 3600_000,
  };
}

function seed(id: string, kind: ContentKind): ContentItem[] {
  const k = listKey(id, kind);
  if (lists.has(k)) return lists.get(k)!;
  let items: ContentItem[] = [];
  const inst = instances.get(id);
  const vanilla = inst?.loader.kind === "vanilla";
  if (kind === "mod" && !vanilla && id !== "hh-armors") {
    const n = id === "survival" ? 312 : id === "all-the-mods" ? 140 : 18;
    // Nur ein Teil der Suchtreffer ist installiert (Rest: lokale Varianten ohne Projekt-ID)
    const src = all.modrinth.mod.slice(0, 40);
    for (let i = 0; i < n; i++) {
      const h = src[i % src.length];
      const variant = i >= src.length;
      const it = itemFromHit({ ...h, title: variant ? `${h.title} ${Math.floor(i / src.length) + 1}` : h.title, slug: `${h.slug}-${i}` }, "mod", i, i % 11 !== 5);
      if (variant && i % 3 === 0) (it.project_id = null), (it.source = null);
      else if (variant) it.project_id = `${h.id}-x${i}`;
      items.push(it);
    }
  } else if (kind === "resourcepack") items = all.modrinth.resourcepack.slice(0, id === "vanilla" ? 0 : 9).map((h, i) => itemFromHit(h, "resourcepack", i, i % 4 !== 2));
  else if (kind === "shader") items = all.modrinth.shader.slice(0, id === "survival" ? 3 : 0).map((h, i) => itemFromHit(h, "shader", i));
  lists.set(k, items);
  return items;
}

const changed = (id: string) => mockEmit("content://changed", { instance_id: id });

const updatesFor = new Map<string, Set<string>>();
function updatesOf(id: string): ContentUpdate[] {
  const mods = seed(id, "mod");
  if (!updatesFor.has(id)) updatesFor.set(id, new Set(mods.filter((_, i) => i % 37 === 7 && mods[i].source).map((m) => m.file_name.replace(/\.disabled$/, ""))));
  const set = updatesFor.get(id)!;
  return mods
    .filter((m) => set.has(m.file_name.replace(/\.disabled$/, "")) && m.source && m.project_id)
    .map((m) => ({
      file_name: m.file_name,
      kind: "mod" as const,
      source: m.source!,
      project_id: m.project_id!,
      current_version: m.version,
      new_version: {
        source: m.source!,
        id: m.project_id + "-new",
        project_id: m.project_id!,
        name: `${m.name} ${m.version}-neu`,
        version_number: `${m.version?.split(".")[0] ?? "1"}.9.0`,
        game_versions: ["1.21.4"],
        loaders: ["fabric"],
        release_type: "release" as const,
        date: new Date().toISOString(),
        downloads: 1000,
        files: [],
        dependencies: [],
        changelog: null,
      },
    }));
}

const missingDismissed = new Set<string>();
function missingOf(id: string): MissingDownload[] {
  if (id !== "all-the-mods" && id !== "survival") return [];
  if (missingDismissed.has(id)) return [];
  return [
    { file_name: "OptiFine_1.21.1_HD_U_J1.jar", project_name: "OptiFine", page_url: "https://www.curseforge.com/minecraft/mc-mods/optifine", kind: "mod" },
    { file_name: "journeymap-1.21.1-6.0.0.jar", project_name: "JourneyMap", page_url: "https://www.curseforge.com/minecraft/mc-mods/journeymap", kind: "mod" },
    { file_name: "Xaeros_Minimap_24.5.0.jar", project_name: "Xaero's Minimap", page_url: "https://www.curseforge.com/minecraft/mc-mods/xaeros-minimap", kind: "mod" },
  ];
}

function newInstance(name: string, mc: string, kind: Instance["loader"]["kind"], ver: string | null, source: Instance["source"]): Instance {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "instanz";
  let id = base;
  for (let i = 2; instances.has(id); i++) id = `${base}-${i}`;
  const inst: Instance = {
    id,
    name,
    icon: null,
    accent: null,
    group: null,
    mc_version: mc,
    loader: { kind, version: ver },
    java: { path: null, min_memory_mb: null, max_memory_mb: null, jvm_args: null, env: {} },
    window: { width: null, height: null, fullscreen: null },
    source,
    install_state: "not_installed",
    version_id: null,
    created_at: Date.now(),
    last_played: null,
    play_time_secs: 0,
    notes: null,
  };
  instances.set(id, inst);
  mockEmit("instance://changed", inst);
  return inst;
}

// ------------------------------------------------------------------ Accounts

const uuid = () => "xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx".replace(/[xy]/g, (c) => ((Math.random() * 16) | (c === "x" ? 0 : 8)).toString(16));
const emptyAccounts = (() => {
  try {
    return localStorage.getItem("mock.accounts") === "empty";
  } catch {
    return false;
  }
})();
let accounts: Account[] = emptyAccounts
  ? []
  : [
      { id: "a1", kind: "microsoft", username: "Henny", uuid: "069a79f444e94726a5befca90e38aaf5", skin_url: null, active: true, expires_at: Date.now() + 18 * 3600_000, needs_relogin: false },
      { id: "a2", kind: "microsoft", username: "Steve_Builder", uuid: "853c80ef3c3749fdaa49938b674adae6", skin_url: null, active: false, expires_at: Date.now() - 86400_000 * 3, needs_relogin: true },
    ];
const emitAccounts = () => mockEmit("accounts://changed", accounts.map((a) => ({ ...a })));
let msa: { cancelled: boolean } | null = null;

const flag = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};

// ------------------------------------------------------------------ Handler

const handlers: Handlers = {
  curseforge_available: () => (core.system_info({}) as { curseforge_available: boolean }).curseforge_available,
  content_search: async ({ query }) => {
    const q = query as SearchQuery;
    await delay(q.offset ? 350 : 220);
    if (q.query.toLowerCase() === "fehler") throw { kind: "network", message: "Modrinth ist gerade nicht erreichbar. Prüfe deine Internetverbindung." };
    return search(q);
  },
  content_categories: ({ source, projectType }) => {
    const t = projectType as string;
    const names = DATA.cats[t === "datapack" ? "mod" : t] ?? [];
    void source;
    return names.map((n) => ({ id: n, name: n.replace(/-/g, " "), icon: null }));
  },
  content_project: async ({ source, id }) => {
    await delay(150);
    const h = findHit(source as Source, id as string);
    if (!h) throw { kind: "not_found", message: "Projekt nicht gefunden" };
    return details(h);
  },
  content_versions: async ({ source, id, gameVersion, loader }) => {
    await delay(180);
    const h = findHit(source as Source, id as string);
    if (!h) throw { kind: "not_found", message: "Projekt nicht gefunden" };
    return versionsFor(h).filter(
      (v) => (!gameVersion || v.game_versions.includes(gameVersion as string)) && (!loader || v.loaders.includes(loader as string) || (loader === "quilt" && v.loaders.includes("fabric"))),
    );
  },
  content_install: ({ instanceId, source, projectId }) => {
    const h = findHit(source as Source, projectId as string);
    const iid = instanceId as string;
    if (!h) throw { kind: "not_found", message: "Projekt nicht gefunden" };
    const fail = h.title.includes("Redux") ? "Download fehlgeschlagen: Prüfsumme stimmt nicht (Mock)" : undefined;
    return fakeTask("content_install", `${h.title} installieren`, iid, 2200, () => {
      const kind = kindOf(h.project_type);
      const list = seed(iid, kind).filter((c) => c.project_id !== h.id);
      list.push(itemFromHit(h, kind, list.length));
      lists.set(listKey(iid, kind), list);
      changed(iid);
    }, fail);
  },
  content_list: async ({ instanceId, kind }) => {
    await delay(120);
    if (!instances.has(instanceId as string)) throw { kind: "not_found", message: "Instanz nicht gefunden" };
    return seed(instanceId as string, kind as ContentKind).map((c) => ({ ...c }));
  },
  content_set_enabled: async ({ instanceId, kind, fileName, enabled }) => {
    await delay(60);
    const list = seed(instanceId as string, kind as ContentKind);
    const i = list.findIndex((c) => c.file_name === fileName);
    if (i === -1) throw { kind: "not_found", message: `Datei ${fileName} nicht gefunden` };
    const base = list[i].file_name.replace(/\.disabled$/, "");
    list[i] = { ...list[i], enabled: !!enabled, file_name: enabled ? base : `${base}.disabled` };
    changed(instanceId as string);
    return { ...list[i] };
  },
  content_remove: ({ instanceId, kind, fileNames }) => {
    const set = new Set(fileNames as string[]);
    const k = listKey(instanceId as string, kind as ContentKind);
    lists.set(k, seed(instanceId as string, kind as ContentKind).filter((c) => !set.has(c.file_name)));
    changed(instanceId as string);
  },
  content_add_files: ({ instanceId, kind, paths }) => {
    const list = seed(instanceId as string, kind as ContentKind);
    const added = (paths as string[]).map((p, i) => {
      const file = p.split(/[\\/]/).pop()!;
      return { ...itemFromHit({ ...all.modrinth.mod[0], title: file.replace(/\.(jar|zip)$/, ""), slug: file, icon_url: null }, kind as ContentKind, i), file_name: file, source: null, project_id: null };
    });
    list.push(...added);
    changed(instanceId as string);
    return added;
  },
  content_check_updates: async ({ instanceId }) => {
    await delay(900);
    return updatesOf(instanceId as string);
  },
  content_update: ({ instanceId, fileNames }) => {
    const id = instanceId as string;
    return fakeTask("content_update", `${(fileNames as string[]).length} Mod(s) aktualisieren`, id, 2500, () => {
      const set = updatesFor.get(id);
      for (const f of fileNames as string[]) set?.delete(f.replace(/\.disabled$/, ""));
      const list = seed(id, "mod");
      for (const c of list) if ((fileNames as string[]).includes(c.file_name)) c.version = `${c.version?.split(".")[0] ?? "1"}.9.0`;
      changed(id);
    });
  },
  content_missing: ({ instanceId }) => missingOf(instanceId as string),
  content_missing_dismiss: ({ instanceId }) => {
    missingDismissed.add(instanceId as string);
  },
  modpack_install: ({ source, projectId }) => {
    const h = findHit(source as Source, projectId as string);
    if (!h) throw { kind: "not_found", message: "Modpack nicht gefunden" };
    const inst = newInstance(h.title, h.game_versions.at(-1) ?? "1.21.1", (h.loaders[0] as Instance["loader"]["kind"]) ?? "fabric", "0.16.9", {
      kind: h.source,
      project_id: h.id,
      version_id: null,
      name: h.title,
      version_name: "1.0.0",
    });
    return fakeTask("modpack_install", `${h.title} installieren`, inst.id, 3500);
  },
  import_preview: async ({ path }) => {
    await delay(400);
    const p = String(path);
    if (/kaputt|broken/i.test(p)) throw { kind: "zip", message: "Die Datei ist kein gültiges Modpack (modrinth.index.json fehlt)." };
    const name = p.split(/[\\/]/).pop()!.replace(/\.(mrpack|zip|vlpack)$/i, "");
    const ext = p.split(".").pop()!.toLowerCase();
    return {
      format: ext === "mrpack" ? "mrpack" : ext === "vlpack" ? "vlpack" : "curseforge",
      name: name.replace(/[-_]/g, " "),
      version_name: "2.4.1",
      mc_version: "1.21.1",
      loader: { kind: "fabric", version: "0.16.9" },
      file_count: 187,
      icon: "https://cdn.modrinth.com/data/1KVo5zza/icon.png",
      author: "Vibe Craft Studios",
    };
  },
  import_pack: ({ path, name }) => {
    const n = (name as string) || String(path).split(/[\\/]/).pop()!;
    const inst = newInstance(n, "1.21.1", "fabric", "0.16.9", { kind: "modrinth", project_id: null, version_id: null, name: n, version_name: "2.4.1" });
    return fakeTask("import_pack", `${n} importieren`, inst.id, 3000);
  },
  export_entries: async ({ instanceId }) => {
    await delay(200);
    const mods = seed(instanceId as string, "mod");
    const entries: ExportEntry[] = [
      { path: "mods", is_dir: true, size: 0, default_selected: true },
      ...mods.slice(0, 60).map((m) => ({ path: `mods/${m.file_name}`, is_dir: false, size: m.size, default_selected: true })),
      { path: "config", is_dir: true, size: 0, default_selected: true },
      ...["sodium-options.json", "iris.properties", "modmenu.json", "jei/jei-client.ini", "jei/jei-debug.ini", "xaero/minimap.txt"].map((f, i) => ({
        path: `config/${f}`,
        is_dir: false,
        size: 800 + i * 431,
        default_selected: true,
      })),
      { path: "resourcepacks", is_dir: true, size: 0, default_selected: true },
      { path: "resourcepacks/Faithful 32x.zip", is_dir: false, size: 24_500_000, default_selected: true },
      { path: "shaderpacks", is_dir: true, size: 0, default_selected: false },
      { path: "shaderpacks/ComplementaryReimagined_r5.4.zip", is_dir: false, size: 1_400_000, default_selected: false },
      { path: "saves", is_dir: true, size: 312_000_000, default_selected: false },
      { path: "screenshots", is_dir: true, size: 41_000_000, default_selected: false },
      { path: "options.txt", is_dir: false, size: 5_400, default_selected: true },
      { path: "servers.dat", is_dir: false, size: 900, default_selected: false },
    ];
    return entries;
  },
  export_instance: ({ instanceId, options }) => fakeTask("export_instance", `Export ${(options as { name: string }).name}`, instanceId as string, 2500),

  accounts_list: () => accounts.map((a) => ({ ...a })),
  account_remove: ({ id }) => {
    const wasActive = accounts.find((a) => a.id === id)?.active;
    accounts = accounts.filter((a) => a.id !== id);
    if (wasActive && accounts[0]) accounts[0].active = true;
    emitAccounts();
  },
  account_set_active: ({ id }) => {
    accounts = accounts.map((a) => ({ ...a, active: a.id === id }));
    emitAccounts();
  },
  account_refresh: async ({ id }) => {
    await delay(800);
    const a = accounts.find((x) => x.id === id);
    if (!a) throw { kind: "not_found", message: "Account nicht gefunden" };
    if (a.needs_relogin) throw { kind: "auth", message: "Die Microsoft-Anmeldung ist abgelaufen. Bitte melde dich erneut an." };
    a.expires_at = Date.now() + 24 * 3600_000;
    emitAccounts();
    return { ...a };
  },
  auth_msa_available: () => flag("mock.msa") !== "off",
  auth_msa_begin: async () => {
    await delay(500);
    msa = { cancelled: false };
    return { user_code: "VBX7-K2QP", verification_uri: "https://www.microsoft.com/link", expires_in: 900, interval: 5, message: "" };
  },
  auth_msa_wait: async () => {
    const me = msa;
    for (let i = 0; i < 50; i++) {
      await delay(100);
      if (!me || me.cancelled) throw { kind: "cancelled", message: "Abgebrochen" };
    }
    if (flag("mock.msa") === "fail") throw { kind: "auth", message: "Dieses Microsoft-Konto besitzt kein Minecraft: Java Edition." };
    const acc: Account = { id: "a" + Date.now(), kind: "microsoft", username: "Alex_" + Math.floor(Math.random() * 90 + 10), uuid: uuid(), skin_url: null, active: true, expires_at: Date.now() + 24 * 3600_000, needs_relogin: false };
    accounts = [...accounts.map((a) => ({ ...a, active: false })), acc];
    emitAccounts();
    return acc;
  },
  auth_msa_cancel: () => {
    if (msa) msa.cancelled = true;
  },

  // Datei-Dialoge (Plugin) – liefern plausible Pfade
  "plugin:dialog|open": ({ options }) => {
    const o = (options ?? {}) as { multiple?: boolean; filters?: { extensions: string[] }[] };
    const ext = o.filters?.[0]?.extensions ?? [];
    if (ext.includes("mrpack")) return "C:\\Users\\steve\\Downloads\\Fabulously-Optimized-6.4.0.mrpack";
    if (ext.includes("jar")) return o.multiple ? ["C:\\Users\\steve\\Downloads\\appleskin-fabric-3.0.6.jar", "C:\\Users\\steve\\Downloads\\jade-15.8.jar"] : "C:\\Users\\steve\\Downloads\\appleskin-fabric-3.0.6.jar";
    if (ext.includes("zip")) return o.multiple ? ["C:\\Users\\steve\\Downloads\\Stay-True-1.21.zip"] : "C:\\Users\\steve\\Downloads\\Stay-True-1.21.zip";
    if (ext.some((e) => ["png", "jpg", "jpeg", "gif", "webp"].includes(e))) return "C:\\Users\\steve\\Pictures\\icon.png";
    return null;
  },
  "plugin:dialog|save": ({ options }) => {
    const o = (options ?? {}) as { defaultPath?: string };
    return `C:\\Users\\steve\\Documents\\${o.defaultPath ?? "export.zip"}`;
  },
};

// Für Tests: Drag & Drop simulieren – window.__mockDrag("enter"|"over"|"drop"|"leave", paths, x, y)
(window as unknown as { __mockDrag: unknown }).__mockDrag = async (type: string, paths: string[] = [], x = 600, y = 400) => {
  const { emit } = await import("@tauri-apps/api/event");
  const dpr = window.devicePixelRatio || 1;
  const position = { x: x * dpr, y: y * dpr };
  const ev = { enter: "tauri://drag-enter", over: "tauri://drag-over", drop: "tauri://drag-drop", leave: "tauri://drag-leave" }[type]!;
  await emit(ev, type === "leave" ? {} : { paths, position });
};

export default handlers;
