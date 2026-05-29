// =============================================================
// Dashboard constants (V1)
// Valala = France only, no regional segmentation.
// Replaced REGION_KEYWORDS by per-campaign-group filtering.
// =============================================================

import type { ComputedKPIs } from "./types";

export const CLIENT_NAME = "Valala";
export const CLIENT_TITLE = "Reporting Valala";
export const CLIENT_SUBTITLE = "ABX · LinkedIn Ads · Outbound · Pipeline";

export type KPIFormat = "currency" | "number" | "percentage";

export interface KPIDescriptor {
  key: keyof ComputedKPIs;
  label: string;
  format: KPIFormat;
  // Lower-is-better metrics: invert delta color (e.g. CPM)
  inverseDelta?: boolean;
}

export const KPI_CONFIG: readonly KPIDescriptor[] = [
  { key: "budget", label: "Dépenses", format: "currency" },
  { key: "impressions", label: "Impressions", format: "number" },
  { key: "cpm", label: "CPM", format: "currency", inverseDelta: true },
  { key: "ctr", label: "CTR", format: "percentage" },
  { key: "clicks", label: "Clics", format: "number" },
  { key: "totalEngagements", label: "Actions sociales", format: "number" },
  { key: "leads", label: "Leads", format: "number" },
] as const;

// Default lookback window when the dataset is loaded fresh
export const DEFAULT_LOOKBACK_DAYS = 15;

// Daily analytics window pulled from LinkedIn
export const DAILY_ANALYTICS_DAYS = 90;

// LinkedIn API
export const LINKEDIN_API_BASE = "https://api.linkedin.com";
export const LINKEDIN_DEFAULT_VERSION = "202509";
export const LINKEDIN_REST_HEADER = "2.0.0";

// TODO V2: lemlist constants (campaign types, MQL/SQL field patterns)
// TODO V3: HubSpot constants (pipeline stages, deal property mappings)
