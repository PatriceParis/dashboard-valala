// =============================================================
// HubSpot CRM API client (V3 — ABX matching)
// - Bearer auth via Private App access token OR Service Key (pat-eu1-...)
// - REST, base https://api.hubapi.com
// =============================================================

import * as dotenv from "dotenv";
import * as path from "node:path";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });

const HUBSPOT_BASE = "https://api.hubapi.com";

export class HubSpotApiError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string, message: string) {
    super(message);
    this.name = "HubSpotApiError";
    this.status = status;
    this.body = body;
  }
}

export class HubSpotClient {
  private token: string;

  constructor(token?: string) {
    const t = token ?? process.env.HUBSPOT_ACCESS_TOKEN;
    if (!t) throw new Error("HUBSPOT_ACCESS_TOKEN missing in environment");
    this.token = t;
  }

  private async request<T>(p: string, method: "GET" | "POST" = "GET", body?: unknown): Promise<T> {
    const url = p.startsWith("http") ? p : `${HUBSPOT_BASE}${p}`;
    const maxRetries = 5;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.status === 429 || res.status === 503) {
        const retryAfter = parseInt(res.headers.get("Retry-After") ?? "5", 10);
        const wait = Math.min(60, Number.isFinite(retryAfter) ? retryAfter : 5);
        console.warn(`[hubspot] rate limit ${res.status}, retry in ${wait}s (#${attempt + 1})`);
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
      if (!res.ok) {
        const txt = await res.text();
        throw new HubSpotApiError(res.status, txt, `HubSpot ${method} ${url} -> ${res.status}: ${txt.slice(0, 400)}`);
      }
      const text = await res.text();
      if (!text) return {} as T;
      return JSON.parse(text) as T;
    }
    throw new Error(`HubSpot request failed after ${maxRetries}: ${url}`);
  }

  // POST /crm/v3/objects/companies/search — paginated search with after cursor
  async searchCompanies(body: {
    filterGroups?: unknown[];
    properties?: string[];
    sorts?: unknown[];
    limit?: number;
    after?: string;
  }): Promise<unknown> {
    return this.request(`/crm/v3/objects/companies/search`, "POST", body);
  }

  // POST /crm/v3/objects/deals/search
  // NB: `associations` is NOT reliably populated in search responses — use
  // `batchReadDealCompanyAssociations` afterwards for the real associations.
  async searchDeals(body: {
    filterGroups?: unknown[];
    properties?: string[];
    associations?: string[];
    limit?: number;
    after?: string;
  }): Promise<unknown> {
    return this.request(`/crm/v3/objects/deals/search`, "POST", body);
  }

  // POST /crm/v4/associations/deals/companies/batch/read
  // Returns `{results: [{from: {id}, to: [{toObjectId, associationTypes}]}]}`.
  // Up to 1000 inputs per call.
  async batchReadDealCompanyAssociations(dealIds: string[]): Promise<unknown> {
    if (dealIds.length === 0) return { results: [] };
    return this.request(`/crm/v4/associations/deals/companies/batch/read`, "POST", {
      inputs: dealIds.map((id) => ({ id })),
    });
  }

  // Generic page reader: yields all results across cursor pages.
  async paginate<TItem>(
    fetcher: (after?: string) => Promise<{ results?: TItem[]; paging?: { next?: { after?: string } } }>,
    maxPages = 50,
  ): Promise<TItem[]> {
    const out: TItem[] = [];
    let after: string | undefined;
    for (let i = 0; i < maxPages; i++) {
      const res = await fetcher(after);
      const items = res.results ?? [];
      out.push(...items);
      after = res.paging?.next?.after;
      if (!after || items.length === 0) break;
    }
    return out;
  }
}
