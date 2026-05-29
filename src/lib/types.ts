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
  /** Conversions site externe (Insight Tag). NE PAS confondre avec leads Lead Gen Form. */
  externalWebsiteConversions: number;
  landingPageClicks: number;
  totalEngagements: number;
  /** Leads collectés via Lead Gen Forms LinkedIn (CSV col "Prospects"). VRAI KPI Leads. */
  oneClickLeads: number;
  /** Ouvertures du formulaire Lead Gen Form (avant submit). */
  oneClickLeadFormOpens: number;
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
  /** Leads Lead Gen Form journaliers. */
  oneClickLeads: number;
  videoFirstQuartileCompletions?: number;
  videoMidpointCompletions?: number;
}

export interface AccountOrg {
  orgId: string;
  name: string;
  vanityName?: string;
  followerCount: number;
}

export interface Creative {
  id: string;
  campaignId: string;
  campaignName?: string;
  campaignGroupName?: string;
  status: string;
  type?: string;
  /** post URN if Sponsored Update, ghost share URN otherwise */
  reference?: string;
  /** preview text/headline if available */
  text?: string;
  /** thumbnail URL (image creative or video thumbnail) */
  imageUrl?: string;
  /** linkedin permalink of the post (when resolvable) */
  postUrl?: string;
  /** author display name (TLA) */
  authorName?: string;
}

export interface CreativeAnalytics {
  creativeId: string;
  impressions: number;
  clicks: number;
  costInLocalCurrency: number;
  oneClickLeads: number;
  totalEngagements: number;
  videoViews?: number;
  videoFirstQuartileCompletions?: number;
  videoMidpointCompletions?: number;
}

export interface CompanyEntry {
  /** organization URN id (numeric) */
  orgId: string;
  name: string;
  vanityName?: string;
  impressions: number;
  clicks: number;
  spend: number;
}

export interface CompanyAnalytics {
  /** per-window aggregation: 7d / 30d / 90d */
  window: "7d" | "30d" | "90d";
  entries: CompanyEntry[];
}

export interface DashboardData {
  campaignGroups: CampaignGroup[];
  campaigns: Campaign[];
  analytics: CampaignAnalytics[];
  dailyAnalytics: DailyAnalytics[];
  creatives: Creative[];
  creativeAnalytics: CreativeAnalytics[];
  companyAnalyticsWindows: CompanyAnalytics[];
  accountOrg?: AccountOrg;
  lastUpdated: string;
  dataPeriod?: {
    start: string;
    end: string;
  };
  currency: string;
  outbound?: OutboundData;
  abx?: ABXData;
}

// ============================================================
// V2 — Outbound (lemlist)
// ============================================================

export interface LemlistCampaign {
  id: string;
  name: string;
  status: string;
  /** stats aggregated from lemlist activities */
  emailsSent: number;
  emailsOpened: number;
  emailsReplied: number;
  linkedinSent: number;
  linkedinAccepted: number;
  linkedinReplied: number;
  leadsTotal: number;
  /** ABX field counts from lemlist custom fields when present */
  mqlCount: number;
  sqlCount: number;
  dealCount: number;
}

export interface OutboundDailyActivity {
  date: string;
  emailsSent: number;
  emailsOpened: number;
  emailsReplied: number;
  linkedinSent: number;
  linkedinAccepted: number;
}

export interface OutboundData {
  campaigns: LemlistCampaign[];
  dailyActivity: OutboundDailyActivity[];
  lastUpdated: string;
}

// ============================================================
// V3 — ABX matching (HubSpot ↔ LinkedIn + lemlist)
// ============================================================

export interface ABXCompanyMatch {
  /** canonical company id (built from domain or LinkedIn slug) */
  id: string;
  name: string;
  domain?: string;
  linkedinSlug?: string;
  /** sources that touched the company */
  sources: Array<"paid" | "outbound">;
  /** match confidence: domain=1.0, slug=0.9, fuzzy=score */
  confidence: number;
  matchKind: "domain" | "slug" | "fuzzy";
  /** funnel position */
  reached: boolean;
  inCRM: boolean;
  quoted: boolean;
  won: boolean;
  /** amounts */
  pipelineEUR?: number;
  revenueEUR?: number;
  /** first CRM entry date (used for paid-influenced filter) */
  firstCRMDate?: string;
}

export interface ABXFunnel {
  reached: number;
  inCRM: number;
  quoted: number;
  won: number;
  pipelineEUR: number;
  revenueEUR: number;
  /** total spend that maps to influenced companies (paid only) */
  spendEUR: number;
}

export interface ABXData {
  matches: ABXCompanyMatch[];
  funnel: ABXFunnel;
  lastUpdated: string;
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
