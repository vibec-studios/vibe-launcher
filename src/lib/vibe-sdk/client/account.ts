import type { AuthResult, ChallengeResult, ClientInfo, CloudSettings, DevicePoll, DeviceSession, DeviceStart, Me, Pack, ServerMeta, UpdateMeBody, UserWithRelationship } from "../types";
import { VibeClientCore } from "./core";
import { enc } from "./http";

export class VibeAccountClient extends VibeClientCore {
  startDevicePairing() {
    return this.request<DeviceStart>("POST", "/api/v1/auth/device/start", { auth: false });
  }

  approveDevicePairing(code: string) {
    return this.request<void>("POST", "/api/v1/auth/device/approve", { body: { code } });
  }

  async pollDevicePairing(deviceToken: string, signal?: AbortSignal) {
    const result = await this.request<DevicePoll>("POST", "/api/v1/auth/device/poll", { auth: false, body: { deviceToken }, signal });
    if (result.status === "authorized") await this.setTokens(this.toStored(result.tokens));
    return result;
  }

  getCloudSettings() {
    return this.request<CloudSettings>("GET", "/api/v1/cloud-settings");
  }

  putCloudSettings(body: CloudSettings) {
    return this.request<CloudSettings>("PUT", "/api/v1/cloud-settings", { body });
  }

  // ---------------- Auth ----------------

  readonly auth = {
    /** Schritt 1: serverId holen */
    challenge: () => this.post<ChallengeResult>("/api/v1/auth/challenge", {}, false),
    /** Schritt 3: nach Mojang-`join` bestätigen; speichert die Tokens */
    verify: async (name: string, serverId: string, client: ClientInfo) => {
      const r = await this.post<AuthResult>("/api/v1/auth/verify", { name, serverId, client }, false);
      await this.setTokens(this.toStored(r));
      return r;
    },
    /**
     * Kompletter Login. `joinServer` muss Mojangs `POST https://sessionserver.mojang.com/session/minecraft/join`
     * mit dem Minecraft-Access-Token aufrufen (`{ accessToken, selectedProfile: <uuid ohne Bindestriche>, serverId }`).
     * Das Minecraft-Token verlässt dabei nie den Client.
     */
    login: async (o: { name: string; client: ClientInfo; joinServer: (serverId: string) => Promise<void> }) => {
      const { serverId } = await this.auth.challenge();
      await o.joinServer(serverId);
      return this.auth.verify(o.name, serverId, o.client);
    },
    logout: async () => {
      try {
        await this.post<void>("/api/v1/auth/logout");
      } finally {
        await this.setTokens(null);
      }
    },
    sessions: () => this.get<DeviceSession[]>("/api/v1/auth/sessions"),
    revokeSession: (id: string) => this.del(`/api/v1/auth/sessions/${enc(id)}`),
  };

  // ---------------- Meta / Profil / Nutzer ----------------

  meta = () => this.get<ServerMeta>("/api/v1/meta", undefined, false);

  readonly me = {
    get: () => this.get<Me>("/api/v1/me"),
    update: (body: UpdateMeBody) => this.patch<Me>("/api/v1/me", body),
  };

  readonly users = {
    search: (q: string, limit?: number) => this.get<UserWithRelationship[]>("/api/v1/users/search", { q, limit }),
    get: (userId: string) => this.get<UserWithRelationship>(`/api/v1/users/${enc(userId)}`),
    packs: (userId: string) => this.get<Pack[]>(`/api/v1/users/${enc(userId)}/packs`),
  };
}
