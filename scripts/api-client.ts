// =============================================================
// LinkedIn Marketing API client (V1)
// - Bearer auth, REST endpoints, version 202509
// - Retry on 429 with Retry-After
// - Batches analytics calls to stay under URL length / rate limits
// =============================================================

import * as dotenv from "dotenv";
import * as path from "node:path";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });

const LINKEDIN_BASE = "https://api.linkedin.com";
const DEFAULT_VERSION = process.env.LINKEDIN_API_VERSION ?? "202509";

interface FetchOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  body?: string;
  // Skip the LinkedIn-Version header (for /v2/ legacy endpoints)
  legacy?: boolean;
}

export class LinkedInApiError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string, message: string) {
    super(message);
    this.name = "LinkedInApiError";
    this.status = status;
    this.body = body;
  }
}

export class LinkedInClient {
  private token: string;
  private version: string;

  constructor(token?: string, version?: string) {
    const accessToken = token ?? process.env.LINKEDIN_ACCESS_TOKEN;
    if (!accessToken) {
      throw new Error("LINKEDIN_ACCESS_TOKEN missing in environment");
    }
    this.token = accessToken;
    this.version = version ?? DEFAULT_VERSION;
  }

  private buildHeaders(opts: FetchOptions): Record<string, string> {
    const base: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      "X-Restli-Protocol-Version": "2.0.0",
      Accept: "application/json",
    };
    if (!opts.legacy) {
      base["LinkedIn-Version"] = this.version;
    }
    if (opts.body) {
      base["Content-Type"] = "application/json";
    }
    return { ...base, ...(opts.headers ?? {}) };
  }

  async request<T>(pathOrUrl: string, opts: FetchOptions = {}): Promise<T> {
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${LINKEDIN_BASE}${pathOrUrl}`;
    const maxRetries = 5;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const res = await fetch(url, {
        method: opts.method ?? "GET",
        headers: this.buildHeaders(opts),
        body: opts.body,
      });

      if (res.status === 429 || res.status === 503) {
        const retryAfter = parseInt(res.headers.get("Retry-After") ?? "5", 10);
        const wait = Math.min(60, Number.isFinite(retryAfter) ? retryAfter : 5);
        console.warn(`[linkedin] rate limit ${res.status}, retrying in ${wait}s (attempt ${attempt + 1})`);
        await sleep(wait * 1000);
        continue;
      }

      if (!res.ok) {
        const body = await res.text();
        throw new LinkedInApiError(
          res.status,
          body,
          `LinkedIn ${opts.method ?? "GET"} ${url} -> ${res.status}: ${body.slice(0, 400)}`,
        );
      }

      // Some endpoints (DELETE) return no body
      const text = await res.text();
      if (!text) return {} as T;
      return JSON.parse(text) as T;
    }

    throw new Error(`LinkedIn request failed after ${maxRetries} retries: ${url}`);
  }

  // -------------------------------------------------------------
  // Resources
  // -------------------------------------------------------------

  async getAdAccounts(): Promise<unknown> {
    return this.request("/rest/adAccounts?q=search");
  }

  async getOrganization(orgId: string): Promise<unknown> {
    return this.request(`/rest/organizations/${orgId}`);
  }

  async getOrganizationFollowers(orgId: string): Promise<unknown> {
    // followerStatistics is the right endpoint for follower count
    const urn = encodeURIComponent(`urn:li:organization:${orgId}`);
    return this.request(`/rest/networkSizes/${urn}?edgeType=COMPANY_FOLLOWED_BY_MEMBER`);
  }

  async getCampaignGroups(accountId: string): Promise<unknown> {
    return this.request(`/rest/adAccounts/${accountId}/adCampaignGroups?q=search&count=100`);
  }

  async getCampaigns(accountId: string): Promise<unknown> {
    return this.request(`/rest/adAccounts/${accountId}/adCampaigns?q=search&count=200`);
  }

  // Analytics — pivot=CAMPAIGN, granularity=ALL
  async getCampaignAnalytics(
    campaignUrns: string[],
    start: { year: number; month: number; day: number },
    end: { year: number; month: number; day: number },
  ): Promise<unknown> {
    if (campaignUrns.length === 0) return { elements: [] };
    const fields = [
      "pivotValues",
      "dateRange",
      "impressions",
      "clicks",
      "costInLocalCurrency",
      "externalWebsiteConversions",
      "landingPageClicks",
      "totalEngagements",
      "oneClickLeads",
      "oneClickLeadFormOpens",
      "costPerQualifiedLead",
      "videoFirstQuartileCompletions",
      "videoMidpointCompletions",
    ].join(",");

    const campaignsParam = encodeListUrns(campaignUrns);
    const url =
      `/rest/adAnalytics?q=analytics` +
      `&pivot=CAMPAIGN` +
      `&timeGranularity=ALL` +
      `&dateRange=(start:(year:${start.year},month:${start.month},day:${start.day}),end:(year:${end.year},month:${end.month},day:${end.day}))` +
      `&campaigns=${campaignsParam}` +
      `&fields=${fields}`;
    return this.request(url);
  }

  // Analytics — pivot=CAMPAIGN, granularity=DAILY
  async getDailyCampaignAnalytics(
    campaignUrns: string[],
    start: { year: number; month: number; day: number },
    end: { year: number; month: number; day: number },
  ): Promise<unknown> {
    if (campaignUrns.length === 0) return { elements: [] };
    const fields = [
      "pivotValues",
      "dateRange",
      "impressions",
      "clicks",
      "costInLocalCurrency",
      "externalWebsiteConversions",
      "totalEngagements",
      "oneClickLeads",
      "videoFirstQuartileCompletions",
      "videoMidpointCompletions",
    ].join(",");

    const campaignsParam = encodeListUrns(campaignUrns);
    const url =
      `/rest/adAnalytics?q=analytics` +
      `&pivot=CAMPAIGN` +
      `&timeGranularity=DAILY` +
      `&dateRange=(start:(year:${start.year},month:${start.month},day:${start.day}),end:(year:${end.year},month:${end.month},day:${end.day}))` +
      `&campaigns=${campaignsParam}` +
      `&fields=${fields}`;
    return this.request(url);
  }
}

// -------------------------------------------------------------
// Helpers
// -------------------------------------------------------------

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function encodeListUrns(urns: string[]): string {
  // LinkedIn expects literal: List(urn:li:sponsoredCampaign:123,urn:li:sponsoredCampaign:456)
  // The URN colons must be URL-encoded (%3A), but the List(...) wrapper and commas stay literal.
  const encoded = urns.map((u) => u.replace(/:/g, "%3A")).join(",");
  return `List(${encoded})`;
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

export function toLinkedInDateParts(date: Date): { year: number; month: number; day: number } {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}
