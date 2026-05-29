// =============================================================
// LinkedIn Ads — domain types (V1 socle)
// V2: add LemlistCampaign / OutboundActivity types here
// V3: add ABXMatch / CompanyEngagement types here
// =============================================================

export type CampaignStatus =
  | "ACTIVE"
  | "PAUSED"
  | "DRAFT"
  | "ARCHIVED"
  | "CANCELED"
  | "COMPLETED"
  | "PENDING_DELETION"
  | "REMOVED";

export interface CampaignGroup {
  id: string;
  name: string;
  status: CampaignStatus;
}

export interface Campaign {
  id: string;
  name: string;
  status: CampaignStatus;
  campaignGroupId: string;
  campaignGroupName?: string;
  dailyBudget?: number;
  totalBudget?: number;
  costType?: string;
  currency?: string;
  type?: string;
}

export interface CampaignAnalytics {
  campaignId: string;
  impressions: number;
  clicks: number;
  costInLocalCurrency: number;
  externalWebsiteConversions: number;
  landingPageClicks: number;
  totalEngagements: number;
  videoFirstQuartileCompletions?: number;
  videoMidpointCompletions?: number;
  dateRange?: {
    start: string;
    end: string;
  };
}

export interface DailyAnalytics {
  campaignId: string;
  date: string; // YYYY-MM-DD
  impressions: number;
  clicks: number;
  costInLocalCurrency: number;
  externalWebsiteConversions: number;
  totalEngagements: number;
  videoFirstQuartileCompletions?: number;
  videoMidpointCompletions?: number;
}

export interface AccountOrg {
  orgId: string;
  name: string;
  vanityName?: string;
  followerCount: number;
}

export interface DashboardData {
  campaignGroups: CampaignGroup[];
  campaigns: Campaign[];
  analytics: CampaignAnalytics[];
  dailyAnalytics: DailyAnalytics[];
  accountOrg?: AccountOrg;
  lastUpdated: string;
  dataPeriod?: {
    start: string;
    end: string;
  };
  currency: string;
  // TODO V2: outbound?: OutboundData
  // TODO V3: abx?: ABXData
}

export interface ComputedKPIs {
  budget: number;
  impressions: number;
  cpm: number;
  ctr: number;
  clicks: number;
  cpl: number;
  leads: number;
  totalEngagements: number;
}

export interface KPIWithDelta {
  current: number;
  previous: number;
  deltaPct: number | null;
}

export interface ComputedKPIsWithDelta {
  budget: KPIWithDelta;
  impressions: KPIWithDelta;
  cpm: KPIWithDelta;
  ctr: KPIWithDelta;
  clicks: KPIWithDelta;
  cpl: KPIWithDelta;
  leads: KPIWithDelta;
  totalEngagements: KPIWithDelta;
}
