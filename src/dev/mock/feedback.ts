// Mock: Feedback/Fehlerberichte (commands/feedback.rs, docs/FEEDBACK.md). Es wird nichts gesendet.
// Screenshots: localStorage vl.mock.feedback = "offline" | "ratelimit" | "toolarge" | "server" -> Senden schlägt
// entsprechend fehl; sonst Erfolg mit Ticket VB-1042.
import type { FeedbackDraft, FeedbackImage, FeedbackLogPreview, FeedbackPreview, FeedbackSendResult } from "@/lib/types";
import type { Handlers } from "./util";
import { instances } from "./core";

function flag(): string | null {
  try {
    return localStorage.getItem("vl.mock.feedback");
  } catch {
    return null;
  }
}

/** Platzhalterbild (im Browser gibt es keinen Fenster-Screenshot). */
function fakeShot(name: string, hue: number): FeedbackImage {
  const c = document.createElement("canvas");
  c.width = 480;
  c.height = 300;
  const g = c.getContext("2d")!;
  g.fillStyle = `hsl(${hue} 18% 9%)`;
  g.fillRect(0, 0, 480, 300);
  g.fillStyle = `hsl(${hue} 15% 13%)`;
  g.fillRect(0, 0, 56, 300);
  g.fillRect(56, 0, 424, 26);
  g.fillStyle = `hsl(${hue} 14% 16%)`;
  for (let i = 0; i < 6; i++) g.fillRect(76 + (i % 3) * 132, 50 + Math.floor(i / 3) * 110, 118, 96);
  g.fillStyle = `hsl(${hue} 80% 65%)`;
  g.fillRect(14, 12, 28, 28);
  g.fillStyle = "rgba(255,90,90,.85)";
  g.fillRect(56, 26, 424, 22);
  return { id: Math.random().toString(36).slice(2), name, mime: "image/png", bytes: 412_334, width: 1280, height: 800, thumb: c.toDataURL("image/jpeg", 0.8) };
}

const LAUNCHER = `2026-11-19T10:41:02Z  INFO vibe_launcher: Vibe Launcher 1.0.0-beta.4 startet (Daten: C:\\Users\\<user>\\AppData\\Roaming\\VibeLauncher)
2026-11-19T10:41:03Z  INFO vibe_launcher::auth: Account Steve aktiv, Token gültig bis 11:41 (accessToken=<redacted>)
2026-11-19T10:42:17Z  INFO vibe_launcher::minecraft::launch: Starte „Fabric 1.21.1“ (fabric-loader-0.16.9-1.21.1)
2026-11-19T10:42:18Z  INFO vibe_launcher::minecraft::launch: Java 21.0.5 (Microsoft, x64): C:\\Users\\<user>\\AppData\\Roaming\\VibeLauncher\\java\\java-runtime-delta\\bin\\javaw.exe
2026-11-19T10:42:18Z  INFO vibe_launcher::minecraft::launch: Startbefehl: javaw -Xmx6G … --username Steve --accessToken <redacted> --xuid <redacted>
2026-11-19T10:43:05Z  WARN vibe_launcher::minecraft::process: Spiel beendet mit Code -1 (Crash-Report gefunden)
`;

const LATEST = `[10:42:21] [main/INFO]: Loading Minecraft 1.21.1 with Fabric Loader 0.16.9
[10:42:21] [main/INFO]: Loading 87 mods:
	- fabric-api 0.110.0+1.21.1
	- sodium 0.6.0
	- iris 1.8.1
[10:42:30] [Render thread/INFO]: Setting user: Steve
[10:42:31] [Render thread/INFO]: Backend library: LWJGL version 3.3.3-snapshot
[10:42:44] [Render thread/WARN]: Mod 'examplemod' uses deprecated API
[10:42:58] [Server Connector #1/INFO]: Connecting to <ip>, 25565
[10:43:04] [Render thread/ERROR]: Reported exception thrown!
java.lang.NoSuchMethodError: 'void net.minecraft.class_310.method_1507(net.minecraft.class_437)'
	at com.example.mod.ClientInit.onTick(ClientInit.java:42)
	at net.fabricmc.fabric.impl.client.event.lifecycle.ClientTickEvents.lambda$static$0(ClientTickEvents.java:31)
`;

const CRASH = `---- Minecraft Crash Report ----
// Who set us up the TNT?

Time: 2026-11-19 10:43:04
Description: Ticking screen

java.lang.NoSuchMethodError: 'void net.minecraft.class_310.method_1507(net.minecraft.class_437)'
	at com.example.mod.ClientInit.onTick(ClientInit.java:42)

-- System Details --
	Minecraft Version: 1.21.1
	Operating System: Windows 11 (amd64) version 10.0
	Java Version: 21.0.5, Microsoft
	Launched Version: fabric-loader-0.16.9-1.21.1
	Game Directory: C:\\Users\\<user>\\AppData\\Roaming\\VibeLauncher\\instances\\fabric-1-21\\minecraft
`;

function instanceMeta(id: string | null) {
  const i = id ? instances.get(id) : undefined;
  if (!i) return null;
  if (i.bedrock) return { mc_version: i.mc_version, loader: "bedrock", loader_version: null, mod_count: 0, java: null };
  const java = i.mc_version.startsWith("1.12") ? "Java 8.0.432 (Temurin, x64)" : "Java 21.0.5 (Microsoft, x64)";
  return { mc_version: i.mc_version, loader: i.loader.kind, loader_version: i.loader.version, mod_count: i.loader.kind === "vanilla" ? 0 : 87, java };
}

const handlers: Handlers = {
  feedback_capture: () => fakeShot("launcher.png", 255),
  feedback_pick_screenshots: () => ({ images: [fakeShot("screenshot.png", 190)], errors: [] }),
  feedback_discard: () => null,
  feedback_logs: ({ instanceId }) => [
    { name: "launcher.log", bytes: 48_211, kind: "launcher" },
    ...(instanceId
      ? [
          { name: "latest.log", bytes: 1_204_778, kind: "game" },
          { name: "crash-2026-11-19_10.43.04-client.txt", bytes: 9_812, kind: "crash" },
        ]
      : []),
  ],
  feedback_preview: ({ draft }) => {
    const d = draft as FeedbackDraft;
    const msg = d.message.trim();
    if (msg.length < 10) throw { kind: "invalid", message: "Ungültige Eingabe: Bitte beschreibe es etwas genauer (mindestens 10 Zeichen)." };
    const logs: FeedbackLogPreview[] = d.attach_logs
      ? [
          { name: "launcher.log", original_bytes: 48_211, bytes: LAUNCHER.length, truncated: false, redactions: 5, text: LAUNCHER },
          ...(d.instance_id
            ? [
                { name: "latest.log", original_bytes: 1_204_778, bytes: LATEST.length, truncated: true, redactions: 1, text: `[Vibe Launcher: Anfang gekürzt – nur die letzten 256 KB]\n${LATEST}` },
                { name: "crash-2026-11-19_10.43.04-client.txt", original_bytes: 9_812, bytes: CRASH.length, truncated: false, redactions: 1, text: CRASH },
              ]
            : []),
        ]
      : [];
    const shots = d.screenshots.map((id, i) => ({ ...fakeShot(i === 0 ? "launcher.png" : "screenshot.png", i === 0 ? 255 : 190), id }));
    const p: FeedbackPreview = {
      token: "mock-token",
      endpoint: "https://vibe.axolite.app/api/v1/feedback",
      meta: {
        kind: d.kind,
        message: msg,
        contact: d.contact,
        app: "launcher",
        version: "1.0.0-beta.4",
        channel: "release",
        os: "Windows 11 Pro",
        arch: "x86_64",
        locale: d.locale,
        page: d.page,
        instance: instanceMeta(d.instance_id),
      },
      logs,
      screenshots: shots,
      account: d.link_account ? "Henny" : null,
      total_bytes: 900 + logs.reduce((a, l) => a + l.bytes, 0) + shots.length * 412_334,
    };
    return p;
  },
  feedback_send: async (): Promise<FeedbackSendResult> => {
    await new Promise((r) => setTimeout(r, 700));
    switch (flag()) {
      case "offline":
        return { status: "offline", message: "error sending request" };
      case "ratelimit":
        return { status: "rate_limited", retry_after_secs: 600, message: "Zu viele Meldungen" };
      case "toolarge":
        return { status: "rejected", http: 413, code: "too_large", message: "Anhang zu groß" };
      case "server":
        return { status: "rejected", http: 502, code: null, message: null };
      default:
        return { status: "sent", id: "fb_01JD0X", ticket: "VB-1042" };
    }
  },
};

export default handlers;
