import type { AccessInvite, AccessInvitePreview, AccessInviteQuota, CreatedPlayLink, CreatePlayLinkBody, FollowPackBody, HostingLimits, HostPanel, HostSession, HostSessionEvent, KickPlayerBody, Pack, PackDiff, PackDownload, PackFollow, PackVersion, PackVisibility, PlayLinkInfo, SetHostMemberBody, UpdateHostPolicyBody, UpdateHostSessionBody, UpdatePackBody, VlpackManifest } from "../types";
import { VibeSocialClient } from "./social";
import { VibeError } from "./errors";
import { enc, packForm } from "./http";

export class VibePacksClient extends VibeSocialClient {
  // ---------------- Geteilte Modpacks ----------------

  readonly packs = {
    mine: () => this.get<Pack[]>("/api/v1/packs/mine"),
    browse: (o: { q?: string; mcVersion?: string; loader?: string; sort?: "downloads" | "updated"; limit?: number; offset?: number } = {}) =>
      this.request<Pack[]>("GET", "/api/v1/packs", { query: o, auth: false }),
    /** Pack per Share-Code (auch ohne Anmeldung für öffentliche/nicht gelistete Packs) */
    get: async (code: string) => this.request<Pack>("GET", `/api/v1/packs/${enc(code)}`, { auth: await this.isLoggedIn() }),
    versions: async (code: string) => this.request<PackVersion[]>("GET", `/api/v1/packs/${enc(code)}/versions`, { auth: await this.isLoggedIn() }),
    /** Manifest zum Installieren (zählt den Download) */
    download: async (code: string, versionId?: string) =>
      this.request<PackDownload>("GET", `/api/v1/packs/${enc(code)}/download`, { query: { version: versionId }, auth: await this.isLoggedIn() }),
    /** Teilen: vlpack.json + optional Overrides-ZIP und Icon */
    create: (o: { manifest: VlpackManifest; overrides?: Blob; icon?: Blob; visibility?: PackVisibility; description?: string; changelog?: string }) =>
      this.request<Pack>("POST", "/api/v1/packs", { form: packForm(o) }),
    publishVersion: (code: string, o: { manifest: VlpackManifest; overrides?: Blob; icon?: Blob; changelog?: string }) =>
      this.request<Pack>("POST", `/api/v1/packs/${enc(code)}/versions`, { form: packForm(o) }),
    update: (code: string, body: UpdatePackBody) => this.patch<Pack>(`/api/v1/packs/${enc(code)}`, body),
    delete: (code: string) => this.del(`/api/v1/packs/${enc(code)}`),
    follow: (code: string, body: FollowPackBody = {}) => this.put<PackFollow>(`/api/v1/packs/${enc(code)}/follow`, body),
    unfollow: (code: string) => this.del(`/api/v1/packs/${enc(code)}/follow`),
    following: () => this.get<PackFollow[]>("/api/v1/packs/following"),
    followState: (code: string) => this.get<PackFollow>(`/api/v1/packs/${enc(code)}/follow`),
    diff: async (code: string, from: string, to?: string) =>
      this.request<PackDiff>("GET", `/api/v1/packs/${enc(code)}/diff`, { query: { from, to }, auth: await this.isLoggedIn() }),
    /** Overrides-ZIP als Blob laden */
    overrides: async (url: string) => {
      const token = await this.accessToken();
      const res = await this.fetchImpl(url, { headers: token ? { authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new VibeError(res.status, "download_failed", `Download fehlgeschlagen (${res.status})`);
      return res.blob();
    },
  };

  // ---------------- Hosting ----------------

  readonly hosting = {
    mine: () => this.get<HostSession[]>("/api/v1/hosting/sessions"),
    friends: () => this.get<HostSession[]>("/api/v1/hosting/friends"),
    limits: () => this.get<HostingLimits>("/api/v1/hosting/limits"),
    update: (id: string, body: UpdateHostSessionBody) => this.patch<HostSession>(`/api/v1/hosting/sessions/${enc(id)}`, body),
    panel: (id: string) => this.get<HostPanel>(`/api/v1/hosting/sessions/${enc(id)}/panel`),
    setPolicy: (id: string, body: UpdateHostPolicyBody) => this.patch<HostPanel>(`/api/v1/hosting/sessions/${enc(id)}/policy`, body),
    setMember: (id: string, player: string, body: SetHostMemberBody) => this.put<HostPanel>(`/api/v1/hosting/sessions/${enc(id)}/members/${enc(player)}`, body),
    removeMember: (id: string, player: string) => this.request<HostPanel>("DELETE", `/api/v1/hosting/sessions/${enc(id)}/members/${enc(player)}`),
    kick: (id: string, body: KickPlayerBody) => this.post<HostPanel>(`/api/v1/hosting/sessions/${enc(id)}/kick`, body),
    unkick: (id: string, player: string) => this.request<HostPanel>("DELETE", `/api/v1/hosting/sessions/${enc(id)}/kicks/${enc(player)}`),
    events: (id: string, o: { limit?: number; before?: string } = {}) => this.get<{ events: HostSessionEvent[] }>(`/api/v1/hosting/sessions/${enc(id)}/events`, o),
  };

  // ---------------- Spiel-Links / Beta-Einladungen ----------------

  readonly playLinks = {
    create: (body: CreatePlayLinkBody) => this.post<CreatedPlayLink>("/api/v1/play-links", body),
    get: (code: string) => this.request<PlayLinkInfo>("GET", `/api/v1/play-links/${enc(code)}`, { auth: false }),
    remove: (code: string) => this.del(`/api/v1/play-links/${enc(code)}`),
  };

  readonly accessInvites = {
    list: () => this.get<AccessInviteQuota>("/api/v1/access-invites"),
    create: (body: { name?: string } = {}) => this.post<AccessInvite>("/api/v1/access-invites", body),
    revoke: (id: string) => this.del(`/api/v1/access-invites/${enc(id)}`),
    preview: (code: string) => this.request<AccessInvitePreview>("GET", `/api/v1/access/invites/${enc(code)}`, { auth: false }),
    redeem: (code: string) => this.request<unknown>("POST", "/api/v1/access/redeem", { body: { code } }),
  };

  /** Links zu einem Pack */
  packLinks(code: string) {
    return { url: `${this.baseUrl}/p/${code}`, deepLink: `vibelauncher://pack/${code}` };
  }
}
