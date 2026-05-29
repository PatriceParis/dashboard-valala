// =============================================================
// lemlist API client (V2)
// - Basic auth (": <api_key>") — no token rotation needed.
// - REST, base https://api.lemlist.com/api
// =============================================================

import * as dotenv from "dotenv";
import * as path from "node:path";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });

const LEMLIST_BASE = "https://api.lemlist.com/api";

export class LemlistApiError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string, message: string) {
    super(message);
    this.name = "LemlistApiError";
    this.status = status;
    this.body = body;
  }
}

export class LemlistClient {
  private auth: string;

  constructor(apiKey?: string) {
    const key = apiKey ?? process.env.LEMLIST_API_KEY;
    if (!key) {
      throw new Error("LEMLIST_API_KEY missing in environment");
    }
    // Basic auth header: user is empty, password = API key
    this.auth = Buffer.from(`:${key}`).toString("base64");
  }

  private async request<T>(p: string): Promise<T> {
    const url = p.startsWith("http") ? p : `${LEMLIST_BASE}${p}`;
    const maxRetries = 5;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Basic ${this.auth}`,
          Accept: "application/json",
        },
      });

      if (res.status === 429 || res.status === 503) {
        const retryAfter = parseInt(res.headers.get("Retry-After") ?? "5", 10);
        const wait = Math.min(60, Number.isFinite(retryAfter) ? retryAfter : 5);
        console.warn(`[lemlist] rate limit ${res.status}, retry in ${wait}s (#${attempt + 1})`);
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }

      if (!res.ok) {
        const body = await res.text();
        throw new LemlistApiError(
          res.status,
          body,
          `lemlist GET ${url} -> ${res.status}: ${body.slice(0, 400)}`,
        );
      }
      const text = await res.text();
      if (!text) return {} as T;
      return JSON.parse(text) as T;
    }
    throw new Error(`lemlist request failed after ${maxRetries}: ${url}`);
  }

  // GET /campaigns — list all campaigns visible to the API key
  async getCampaigns(): Promise<unknown> {
    return this.request(`/campaigns?limit=200`);
  }

  // GET /campaigns/{id}/stats — aggregated stats (sent/open/click/reply/etc.)
  async getCampaignStats(campaignId: string): Promise<unknown> {
    return this.request(`/campaigns/${campaignId}/stats`);
  }

  // GET /activities?campaignId={id}&startDate={ISO}&endDate={ISO}&limit=100
  // Cursor pagination via lastId — caller loops with after=lastId.
  async getActivities(params: {
    campaignId?: string;
    startDate: string;
    endDate: string;
    limit?: number;
    after?: string;
  }): Promise<unknown> {
    const qs = new URLSearchParams();
    if (params.campaignId) qs.set("campaignId", params.campaignId);
    qs.set("startDate", params.startDate);
    qs.set("endDate", params.endDate);
    qs.set("limit", String(params.limit ?? 100));
    if (params.after) qs.set("after", params.after);
    return this.request(`/activities?${qs}`);
  }

  // GET /team — team info (to grab user-set custom field schema if needed)
  async getTeam(): Promise<unknown> {
    return this.request(`/team`);
  }
}
