import { API_URL } from "@/lib/domains";

export type InstallOs = "linux" | "windows" | "docker";

export const INSTALL_COMMANDS: Record<InstallOs, string[]> = {
  linux: [`curl -fsSL ${API_URL}/agent/install.sh | sh`],
  windows: [`irm ${API_URL}/agent/install.ps1 | iex`],
  docker: [
    "docker run -d --name vibe-agent --restart unless-stopped -p 25580:25580 -p 25565:25565 -v vibe-agent:/data ghcr.io/vibec-studios/vibe-agent:latest",
    "docker exec vibe-agent vibe-agent pair",
  ],
};

export function linkCommand(os: InstallOs, code: string): string {
  if (os === "docker") return `docker exec vibe-agent vibe-agent link ${code}`;
  if (os === "windows") return `& "$env:ProgramFiles\\Vibe Agent\\vibe-agent.exe" link ${code}`;
  return `sudo vibe-agent link ${code}`;
}

export function groupFingerprint(fp: string): string[] {
  return (fp.toUpperCase().match(/.{1,2}/g) ?? []).reduce<string[]>((acc, b, i) => {
    if (i % 8 === 0) acc.push(b);
    else acc[acc.length - 1] += `:${b}`;
    return acc;
  }, []);
}
