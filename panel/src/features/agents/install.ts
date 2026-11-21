export type InstallOs = "linux" | "windows" | "docker";

export const INSTALL_COMMANDS: Record<InstallOs, string> = {
  linux: "curl -fsSL https://vibe.axolite.app/agent/install.sh | sh",
  windows: "irm https://vibe.axolite.app/agent/install.ps1 | iex",
  docker: "docker run -d --name vibe-agent --restart unless-stopped -p 25580:25580 -p 25565:25565 -v vibe-agent-data:/data -v vibe-agent-config:/config ghcr.io/vibec-studios/vibe-agent:latest",
};
