// =============================================================
// Build-time JSON loader.
// All reads happen at SSG/build time, never at runtime.
// =============================================================

import fs from "node:fs";
import path from "node:path";
import type {
  AccountOrg,
  Campaign,
  CampaignAnalytics,
  CampaignGroup,
  DailyAnalytics,
  DashboardData,
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
  const accountOrg = readJsonSafe<AccountOrg | null>("account-org.json", null);
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

  return {
    campaignGroups,
    campaigns: enrichedCampaigns,
    analytics,
    dailyAnalytics,
    accountOrg: accountOrg ?? undefined,
    lastUpdated: meta.lastUpdated ?? new Date().toISOString(),
    dataPeriod: meta.dataPeriod,
    currency: meta.currency ?? "EUR",
  };
}

// TODO V2: loadOutboundData() — read lemlist-campaigns.json + activities
// TODO V3: loadABXData() — read abx-matches.json + company-engagements.json
