import type { DiscoveryCategory, DiscoveryInput, DiscoveryServer, DiscoverySubmission, FeedEventType, FeedPage, FeedPreferences, Screenshot, ScreenshotList, ScreenshotReport, ScreenshotVisibility } from "../types";
import { VibePacksClient } from "./packs";
import { enc } from "./http";

export class VibeMediaClient extends VibePacksClient {
  uploadScreenshot(file: Blob, visibility: ScreenshotVisibility = "private") {
    const form = new FormData();
    form.set("visibility", visibility);
    form.set("file", file);
    return this.request<Screenshot>("POST", "/api/v1/screenshots", { form });
  }

  listScreenshots(query?: { limit?: number; offset?: number }) {
    return this.request<ScreenshotList>("GET", "/api/v1/screenshots", { query });
  }

  setScreenshotVisibility(id: string, visibility: ScreenshotVisibility) {
    return this.request<Screenshot>("PATCH", `/api/v1/screenshots/${enc(id)}`, { body: { visibility } });
  }

  downloadScreenshot(id: string, key?: string) {
    return this.request<Blob>("GET", `/api/v1/screenshots/${enc(id)}/image`, { query: { key }, auth: key ? "optional" : true, binary: true });
  }

  reportScreenshot(id: string, body: ScreenshotReport) {
    return this.request<void>("POST", `/api/v1/screenshots/${enc(id)}/report`, { body });
  }

  deleteScreenshot(id: string) {
    return this.request<void>("DELETE", `/api/v1/screenshots/${enc(id)}`);
  }

  feedPreferences() {
    return this.request<FeedPreferences>("GET", "/api/v1/feed/preferences");
  }

  setFeedPreferences(enabled: boolean) {
    return this.request<FeedPreferences>("PUT", "/api/v1/feed/preferences", { body: { enabled } });
  }

  publishFeedEvent(type: FeedEventType) {
    return this.request<void>("POST", "/api/v1/feed/events", { body: { type } });
  }

  feed(query?: { limit?: number; before?: string }) {
    return this.request<FeedPage>("GET", "/api/v1/feed", { query });
  }

  discoverServers(query?: { category?: DiscoveryCategory; limit?: number; offset?: number }) {
    return this.request<{ servers: DiscoveryServer[] }>("GET", "/api/v1/discovery/servers", { auth: false, query });
  }

  submitServer(body: DiscoveryInput) {
    return this.request<DiscoverySubmission>("POST", "/api/v1/discovery/submissions", { body });
  }

  listServerSubmissions(query?: { limit?: number; offset?: number }) {
    return this.request<{ submissions: DiscoverySubmission[] }>("GET", "/api/v1/discovery/submissions", { query });
  }
}
