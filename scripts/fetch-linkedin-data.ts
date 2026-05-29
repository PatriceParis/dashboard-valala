// =============================================================
// Build-time pipeline — fetches LinkedIn Ads data and writes JSON
// to data/ for SSG consumption.
//
// V1 steps (socle complet — cf. skill dashboard-builder § Socle indispensable):
//   1.  Resolve ad account
//   1b. Org info
//   2.  Campaign groups
//   3.  Campaigns
//   4.  Analytics (pivot=CAMPAIGN, granularity=ALL, dataPeriod)
//   5.  Daily analytics (pivot=CAMPAIGN, granularity=DAILY, 90j)
//   6.  Creatives (per campaign) + TLA workflow (ghost post resolution)
//   6b. Creative analytics (pivot=CREATIVE, granularity=ALL, 90j → CTR per creative)
//   7.  Company analytics (pivot=MEMBER_COMPANY, granularity=ALL, 7/30/90j)
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
  oneClickLeads: number;
  oneClickLeadFormOpens: number;
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
  oneClickLeads: number;
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
  oneClickLeads?: number | string;
  oneClickLeadFormOpens?: number | string;
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
        oneClickLeads: num(el.oneClickLeads),
        oneClickLeadFormOpens: num(el.oneClickLeadFormOpens),
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
        oneClickLeads: num(el.oneClickLeads),
        videoFirstQuartileCompletions: num(el.videoFirstQuartileCompletions),
        videoMidpointCompletions: num(el.videoMidpointCompletions),
      });
    }
  }
  writeJson("daily-analytics.json", dailyAnalytics);
  console.log(`  ${dailyAnalytics.length} daily rows`);

  // -----------------------------------------------------------
  // Step 6 — creatives (per campaign)
  // -----------------------------------------------------------
  console.log("[6/8] creatives");
  let creatives: Array<{
    id: string;
    campaignId: string;
    status: string;
    type?: string;
    reference?: string;
    text?: string;
    imageUrl?: string;
    postUrl?: string;
    authorName?: string;
  }> = [];
  try {
    const cRaw = (await client.getCreatives(accountId)) as {
      elements?: Array<{
        id?: string;
        campaign?: string;
        intendedStatus?: string;
        content?: {
          reference?: string;
          textAd?: { headline?: string; description?: string };
          jobPosting?: { jobPosting?: string };
        };
        review?: { reviewStatus?: string };
        type?: string;
      }>;
    };
    creatives = (cRaw.elements ?? []).map((e) => {
      const cidFromUrn = e.id?.split(":").pop() ?? "";
      const campaignUrn = e.campaign ?? "";
      const campaignId = campaignUrn.split(":").pop() ?? "";
      return {
        id: cidFromUrn,
        campaignId,
        status: e.intendedStatus ?? "UNKNOWN",
        type: e.type,
        reference: e.content?.reference,
        text: e.content?.textAd?.headline,
      };
    });
    console.log(`  ${creatives.length} creatives`);
  } catch (err) {
    console.warn("  creatives fetch failed:", (err as Error).message);
  }

  // TLA workflow: for each creative with a share URN, attempt to resolve the post
  // and extract image + author. Persist resolved authors in tla-authors.json.
  const tlaAuthorsPath = path.join(process.cwd(), "tla-authors.json");
  const tlaAuthors: Record<string, string> = fs.existsSync(tlaAuthorsPath)
    ? JSON.parse(fs.readFileSync(tlaAuthorsPath, "utf-8"))
    : {};
  const imageUrnsToFetch = new Set<string>();
  for (const c of creatives) {
    if (!c.reference) continue;
    try {
      // Try direct getPost — works for non-ghost posts
      const post = (await client.getPost(c.reference)) as {
        author?: string;
        content?: { media?: { id?: string }; article?: { source?: string } };
        permalink?: string;
      };
      if (post.permalink) c.postUrl = post.permalink;
      if (post.content?.media?.id) imageUrnsToFetch.add(post.content.media.id);
    } catch {
      // Ghost post fallback: skip (TLA member URN extraction would need creative.variables)
      // Author name resolved manually via tla-authors.json (key = creativeId)
      if (tlaAuthors[c.id]) c.authorName = tlaAuthors[c.id];
    }
  }
  writeJson("creatives.json", creatives);

  // -----------------------------------------------------------
  // Step 6b — creative analytics (CTR by creative, dataPeriod)
  // -----------------------------------------------------------
  console.log("[7/8] creative analytics");
  const creativeAnalytics: Array<{
    creativeId: string;
    impressions: number;
    clicks: number;
    costInLocalCurrency: number;
    oneClickLeads: number;
    totalEngagements: number;
    videoViews?: number;
  }> = [];
  for (const [i, batch] of batches.entries()) {
    console.log(`  batch ${i + 1}/${batches.length} (${batch.length} campaigns)`);
    try {
      const res = (await client.getCreativeAnalytics(batch, startParts, endParts)) as {
        elements?: Array<RawElement & { videoViews?: number | string }>;
      };
      for (const el of res.elements ?? []) {
        const creativeUrn = el.pivotValues?.[0];
        if (!creativeUrn) continue;
        creativeAnalytics.push({
          creativeId: extractCampaignIdFromUrn(creativeUrn),
          impressions: num(el.impressions),
          clicks: num(el.clicks),
          costInLocalCurrency: num(el.costInLocalCurrency),
          oneClickLeads: num(el.oneClickLeads),
          totalEngagements: num(el.totalEngagements),
          videoViews: num(el.videoViews),
        });
      }
    } catch (err) {
      console.warn(`  creative analytics batch ${i + 1} failed:`, (err as Error).message);
    }
  }
  writeJson("creative-analytics.json", creativeAnalytics);
  console.log(`  ${creativeAnalytics.length} creative rows`);

  // -----------------------------------------------------------
  // Step 7 — company analytics (MEMBER_COMPANY pivot, 7/30/90 days)
  // -----------------------------------------------------------
  console.log("[8/8] company analytics");
  const companyWindows: Array<{
    window: "7d" | "30d" | "90d";
    entries: Array<{
      orgId: string;
      name: string;
      vanityName?: string;
      impressions: number;
      clicks: number;
      spend: number;
    }>;
  }> = [];

  const allOrgIds = new Set<string>();
  const rawByWindow: Record<string, Map<string, { impressions: number; clicks: number; spend: number }>> = {
    "7d": new Map(),
    "30d": new Map(),
    "90d": new Map(),
  };

  for (const w of ["7d", "30d", "90d"] as const) {
    const days = w === "7d" ? 7 : w === "30d" ? 30 : 90;
    const wStart = addDays(endDate, -(days - 1));
    const wStartParts = toLinkedInDateParts(wStart);
    for (const [i, batch] of batches.entries()) {
      try {
        const res = (await client.getCompanyAnalytics(batch, wStartParts, endParts)) as {
          elements?: Array<RawElement>;
        };
        for (const el of res.elements ?? []) {
          const orgUrn = el.pivotValues?.[0];
          if (!orgUrn) continue;
          const orgId = orgUrn.split(":").pop() ?? "";
          if (!orgId) continue;
          allOrgIds.add(orgId);
          const cur = rawByWindow[w].get(orgId) ?? { impressions: 0, clicks: 0, spend: 0 };
          cur.impressions += num(el.impressions);
          cur.clicks += num(el.clicks);
          cur.spend += num(el.costInLocalCurrency);
          rawByWindow[w].set(orgId, cur);
        }
      } catch (err) {
        console.warn(`  company analytics ${w} batch ${i + 1} failed:`, (err as Error).message);
      }
    }
  }

  // Resolve org names via organizationsLookup (batched in 50)
  const orgNames = new Map<string, { name: string; vanityName?: string }>();
  const orgIdsArr = Array.from(allOrgIds);
  for (const batch of chunk(orgIdsArr, 50)) {
    try {
      const lookup = (await client.organizationLookup(batch)) as {
        results?: Record<string, { localizedName?: string; vanityName?: string }>;
      };
      for (const [urn, info] of Object.entries(lookup.results ?? {})) {
        const id = urn.split(":").pop() ?? "";
        if (id) orgNames.set(id, { name: info.localizedName ?? id, vanityName: info.vanityName });
      }
    } catch (err) {
      console.warn(`  organizationLookup batch failed:`, (err as Error).message);
    }
  }

  for (const w of ["7d", "30d", "90d"] as const) {
    const entries = Array.from(rawByWindow[w].entries()).map(([orgId, agg]) => ({
      orgId,
      name: orgNames.get(orgId)?.name ?? orgId,
      vanityName: orgNames.get(orgId)?.vanityName,
      impressions: agg.impressions,
      clicks: agg.clicks,
      spend: agg.spend,
    }));
    entries.sort((a, b) => b.impressions - a.impressions);
    companyWindows.push({ window: w, entries });
  }
  writeJson("company-analytics.json", companyWindows);
  console.log(`  ${allOrgIds.size} distinct orgs`);

  // -----------------------------------------------------------
  // Meta
  // -----------------------------------------------------------
  writeJson("meta.json", {
    lastUpdated: new Date().toISOString(),
    currency,
    dataPeriod: { start: toISODate(startDate), end: toISODate(endDate) },
  });

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
