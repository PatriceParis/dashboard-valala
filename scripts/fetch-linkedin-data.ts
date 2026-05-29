// =============================================================
// Build-time pipeline — fetches LinkedIn Ads data and writes JSON
// to data/ for SSG consumption.
//
// V1 steps:
//   1.  Resolve ad account
//   1b. Org info
//   2.  Campaign groups
//   3.  Campaigns
//   4.  Analytics (pivot=CAMPAIGN, granularity=ALL, dataPeriod)
//   5.  Daily analytics (pivot=CAMPAIGN, granularity=DAILY, 90j)
//
// TODO V2: step 6 — creatives (image/video/TLA workflow)
// TODO V2: step 6b — creative analytics (CTR by creative, 90j)
// TODO V2: step 7 — company analytics (MEMBER_COMPANY pivot)
// =============================================================

import * as dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";

// Load .env.local first (highest precedence), then .env as fallback
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });

import {
  LinkedInClient,
  LinkedInApiError,
  chunk,
  toLinkedInDateParts,
} from "./api-client";
import { addDays, toISODate } from "../src/lib/utils";

const DATA_DIR = path.join(process.cwd(), "data");

// Match shape expected by data-loader / types.ts
interface CampaignGroup {
  id: string;
  name: string;
  status: string;
}
interface Campaign {
  id: string;
  name: string;
  status: string;
  campaignGroupId: string;
  dailyBudget?: number;
  totalBudget?: number;
  costType?: string;
  currency?: string;
  type?: string;
}
interface CampaignAnalytics {
  campaignId: string;
  impressions: number;
  clicks: number;
  costInLocalCurrency: number;
  externalWebsiteConversions: number;
  landingPageClicks: number;
  totalEngagements: number;
  videoFirstQuartileCompletions?: number;
  videoMidpointCompletions?: number;
  dateRange?: { start: string; end: string };
}
interface DailyAnalytics {
  campaignId: string;
  date: string;
  impressions: number;
  clicks: number;
  costInLocalCurrency: number;
  externalWebsiteConversions: number;
  totalEngagements: number;
  videoFirstQuartileCompletions?: number;
  videoMidpointCompletions?: number;
}

interface RawElement {
  pivotValues?: string[];
  dateRange?: {
    start: { year: number; month: number; day: number };
    end: { year: number; month: number; day: number };
  };
  impressions?: number | string;
  clicks?: number | string;
  costInLocalCurrency?: number | string;
  externalWebsiteConversions?: number | string;
  landingPageClicks?: number | string;
  totalEngagements?: number | string;
  videoFirstQuartileCompletions?: number | string;
  videoMidpointCompletions?: number | string;
}

const num = (v: unknown, fallback = 0): number => {
  if (v === null || v === undefined || v === "") return fallback;
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? n : fallback;
};

const writeJson = (filename: string, payload: unknown) => {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, filename), JSON.stringify(payload, null, 2));
  console.log(`  wrote data/${filename}`);
};

const extractCampaignIdFromUrn = (urn: string): string => {
  // urn:li:sponsoredCampaign:123456
  const parts = urn.split(":");
  return parts[parts.length - 1] ?? urn;
};

const formatLinkedInDate = (parts: { year: number; month: number; day: number }): string => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
};

async function main() {
  console.log("=== LinkedIn data fetch (Valala) ===");
  const accountId = process.env.LINKEDIN_AD_ACCOUNT_ID;
  const orgId = process.env.LINKEDIN_ORG_ID;
  if (!accountId) throw new Error("LINKEDIN_AD_ACCOUNT_ID missing");

  const client = new LinkedInClient();

  // Date window: end = yesterday (D-1), start = 90 days back (covers KPI defaults + chart)
  const today = new Date();
  const endDate = addDays(today, -1);
  const startDate = addDays(endDate, -90);
  const startParts = toLinkedInDateParts(startDate);
  const endParts = toLinkedInDateParts(endDate);
  console.log(`Window: ${toISODate(startDate)} -> ${toISODate(endDate)}`);

  // -----------------------------------------------------------
  // Step 1bis — organization info
  // -----------------------------------------------------------
  let accountOrg: { orgId: string; name: string; vanityName?: string; followerCount: number } | null = null;
  if (orgId) {
    try {
      console.log("[1/5] organization info");
      const org = (await client.getOrganization(orgId)) as {
        localizedName?: string;
        vanityName?: string;
        name?: { localized?: Record<string, string> };
      };
      let followerCount = 0;
      try {
        const followers = (await client.getOrganizationFollowers(orgId)) as { firstDegreeSize?: number };
        followerCount = followers.firstDegreeSize ?? 0;
      } catch (err) {
        console.warn("  followers fetch skipped:", (err as Error).message);
      }
      accountOrg = {
        orgId,
        name: org.localizedName ?? Object.values(org.name?.localized ?? {})[0] ?? "Organisation",
        vanityName: org.vanityName,
        followerCount,
      };
      writeJson("account-org.json", accountOrg);
    } catch (err) {
      console.warn("  organization fetch failed:", (err as Error).message);
    }
  }

  // -----------------------------------------------------------
  // Step 2 — campaign groups
  // -----------------------------------------------------------
  console.log("[2/5] campaign groups");
  const groupsRaw = (await client.getCampaignGroups(accountId)) as {
    elements?: Array<{ id: number | string; name: string; status: string }>;
  };
  const campaignGroups: CampaignGroup[] = (groupsRaw.elements ?? []).map((g) => ({
    id: String(g.id),
    name: g.name,
    status: g.status,
  }));
  writeJson("campaign-groups.json", campaignGroups);
  console.log(`  ${campaignGroups.length} groups`);

  // -----------------------------------------------------------
  // Step 3 — campaigns
  // -----------------------------------------------------------
  console.log("[3/5] campaigns");
  const campaignsRaw = (await client.getCampaigns(accountId)) as {
    elements?: Array<{
      id: number | string;
      name: string;
      status: string;
      campaignGroup?: string; // urn:li:sponsoredCampaignGroup:123
      dailyBudget?: { amount: string; currencyCode: string };
      totalBudget?: { amount: string; currencyCode: string };
      costType?: string;
      type?: string;
    }>;
  };
  const campaigns: Campaign[] = (campaignsRaw.elements ?? []).map((c) => ({
    id: String(c.id),
    name: c.name,
    status: c.status,
    campaignGroupId: c.campaignGroup ? c.campaignGroup.split(":").pop()! : "",
    dailyBudget: c.dailyBudget ? parseFloat(c.dailyBudget.amount) : undefined,
    totalBudget: c.totalBudget ? parseFloat(c.totalBudget.amount) : undefined,
    costType: c.costType,
    currency:
      c.dailyBudget?.currencyCode ?? c.totalBudget?.currencyCode ?? undefined,
    type: c.type,
  }));
  writeJson("campaigns.json", campaigns);
  console.log(`  ${campaigns.length} campaigns`);

  const campaignUrns = campaigns.map((c) => `urn:li:sponsoredCampaign:${c.id}`);
  const currency =
    campaigns.find((c) => c.currency)?.currency ?? "EUR";

  // -----------------------------------------------------------
  // Step 4 — analytics ALL (chunked batches of 20)
  // -----------------------------------------------------------
  console.log("[4/5] analytics (ALL)");
  const batches = chunk(campaignUrns, 20);
  const analytics: CampaignAnalytics[] = [];
  for (const [i, batch] of batches.entries()) {
    console.log(`  batch ${i + 1}/${batches.length} (${batch.length} campaigns)`);
    const res = (await client.getCampaignAnalytics(batch, startParts, endParts)) as {
      elements?: RawElement[];
    };
    for (const el of res.elements ?? []) {
      const campaignUrn = el.pivotValues?.[0];
      if (!campaignUrn) continue;
      analytics.push({
        campaignId: extractCampaignIdFromUrn(campaignUrn),
        impressions: num(el.impressions),
        clicks: num(el.clicks),
        costInLocalCurrency: num(el.costInLocalCurrency),
        externalWebsiteConversions: num(el.externalWebsiteConversions),
        landingPageClicks: num(el.landingPageClicks),
        totalEngagements: num(el.totalEngagements),
        videoFirstQuartileCompletions: num(el.videoFirstQuartileCompletions),
        videoMidpointCompletions: num(el.videoMidpointCompletions),
        dateRange: el.dateRange
          ? {
              start: formatLinkedInDate(el.dateRange.start),
              end: formatLinkedInDate(el.dateRange.end),
            }
          : undefined,
      });
    }
  }
  writeJson("analytics.json", analytics);
  console.log(`  ${analytics.length} analytics rows`);

  // -----------------------------------------------------------
  // Step 5 — daily analytics (90d)
  // -----------------------------------------------------------
  console.log("[5/5] daily analytics");
  const dailyAnalytics: DailyAnalytics[] = [];
  for (const [i, batch] of batches.entries()) {
    console.log(`  batch ${i + 1}/${batches.length} (${batch.length} campaigns)`);
    const res = (await client.getDailyCampaignAnalytics(batch, startParts, endParts)) as {
      elements?: RawElement[];
    };
    for (const el of res.elements ?? []) {
      const campaignUrn = el.pivotValues?.[0];
      if (!campaignUrn || !el.dateRange) continue;
      dailyAnalytics.push({
        campaignId: extractCampaignIdFromUrn(campaignUrn),
        date: formatLinkedInDate(el.dateRange.start),
        impressions: num(el.impressions),
        clicks: num(el.clicks),
        costInLocalCurrency: num(el.costInLocalCurrency),
        externalWebsiteConversions: num(el.externalWebsiteConversions),
        totalEngagements: num(el.totalEngagements),
        videoFirstQuartileCompletions: num(el.videoFirstQuartileCompletions),
        videoMidpointCompletions: num(el.videoMidpointCompletions),
      });
    }
  }
  writeJson("daily-analytics.json", dailyAnalytics);
  console.log(`  ${dailyAnalytics.length} daily rows`);

  // -----------------------------------------------------------
  // Meta
  // -----------------------------------------------------------
  writeJson("meta.json", {
    lastUpdated: new Date().toISOString(),
    currency,
    dataPeriod: { start: toISODate(startDate), end: toISODate(endDate) },
  });

  // TODO V2: step 6 — creatives (images, videos, TLA workflow)
  // TODO V2: step 6b — creative analytics (CTR by creative, 90d)
  // TODO V2: step 7 — company analytics (MEMBER_COMPANY pivot, 7/30/90d)

  console.log("=== done ===");
}

main().catch((err) => {
  if (err instanceof LinkedInApiError) {
    console.error(`LinkedIn API error ${err.status}:`, err.body);
  } else {
    console.error("Pipeline failed:", err);
  }
  process.exit(1);
});
