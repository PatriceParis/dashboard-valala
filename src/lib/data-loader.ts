// =============================================================
// Build-time JSON loader.
// All reads happen at SSG/build time, never at runtime.
// =============================================================

import fs from "node:fs";
import path from "node:path";
import type {
  ABXData,
  AccountOrg,
  Campaign,
  CampaignAnalytics,
  CampaignGroup,
  CompanyAnalytics,
  Creative,
  CreativeAnalytics,
  DailyAnalytics,
  DashboardData,
  OutboundData,
} from "./types";

const DATA_DIR = path.join(process.cwd(), "data");

function readJsonSafe<T>(filename: string, fallback: T): T {
  const file = path.join(DATA_DIR, filename);
  if (!fs.existsSync(file)) return fallback;
  try {
    const raw = fs.readFileSync(file, "utf-8");
    return JSON.parse(raw) as T;
  } catch (err) {
    console.warn(`[data-loader] failed to read ${filename}:`, err);
    return fallback;
  }
}

export function loadDashboardData(): DashboardData {
  const campaignGroups = readJsonSafe<CampaignGroup[]>("campaign-groups.json", []);
  const campaigns = readJsonSafe<Campaign[]>("campaigns.json", []);
  const analytics = readJsonSafe<CampaignAnalytics[]>("analytics.json", []);
  const dailyAnalytics = readJsonSafe<DailyAnalytics[]>("daily-analytics.json", []);
  const creativesRaw = readJsonSafe<Creative[]>("creatives.json", []);
  const creativeAnalytics = readJsonSafe<CreativeAnalytics[]>("creative-analytics.json", []);
  const companyAnalyticsWindows = readJsonSafe<CompanyAnalytics[]>("company-analytics.json", []);
  const accountOrg = readJsonSafe<AccountOrg | null>("account-org.json", null);
  const outbound = readJsonSafe<OutboundData | null>("outbound.json", null);
  const abx = readJsonSafe<ABXData | null>("abx.json", null);
  const meta = readJsonSafe<{ lastUpdated?: string; currency?: string; dataPeriod?: { start: string; end: string } }>(
    "meta.json",
    {},
  );

  // Enrich campaigns with their group name (lookup)
  const groupById = new Map(campaignGroups.map((g) => [g.id, g.name]));
  const enrichedCampaigns = campaigns.map((c) => ({
    ...c,
    campaignGroupName: c.campaignGroupName ?? groupById.get(c.campaignGroupId),
  }));

  // Enrich creatives with their campaign + group name
  const campaignById = new Map(enrichedCampaigns.map((c) => [c.id, c]));
  const creatives = creativesRaw.map((cr) => {
    const c = campaignById.get(cr.campaignId);
    return {
      ...cr,
      campaignName: c?.name,
      campaignGroupName: c?.campaignGroupName,
    };
  });

  return {
    campaignGroups,
    campaigns: enrichedCampaigns,
    analytics,
    dailyAnalytics,
    creatives,
    creativeAnalytics,
    companyAnalyticsWindows,
    accountOrg: accountOrg ?? undefined,
    outbound: outbound ?? undefined,
    abx: abx ?? undefined,
    lastUpdated: meta.lastUpdated ?? new Date().toISOString(),
    dataPeriod: meta.dataPeriod,
    currency: meta.currency ?? "EUR",
  };
}
