"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { CLIENT_SUBTITLE, CLIENT_TITLE, KPI_CONFIG, DEFAULT_LOOKBACK_DAYS } from "@/lib/constants";
import type {
  Campaign,
  ComputedKPIsWithDelta,
  DailyAnalytics,
  DashboardData,
  KPIWithDelta,
} from "@/lib/types";
import { addDays, computeDelta, formatDate, toISODate } from "@/lib/utils";
import { CampaignTable } from "./campaign-table";
import { DateSelector } from "./date-selector";
import { KpiGrid } from "./kpi-grid";
import { PerformanceChart } from "./performance-chart";

interface DashboardShellProps {
  data: DashboardData;
}

const ALL_GROUPS = "__all__";

const emptyKpi = (current: number, previous: number): KPIWithDelta => ({
  current,
  previous,
  deltaPct: computeDelta(current, previous),
});

interface Aggregate {
  impressions: number;
  clicks: number;
  spend: number;
  leads: number;
  engagements: number;
}

function aggregate(
  daily: DailyAnalytics[],
  campaignIds: Set<string>,
  start: string,
  end: string,
): Aggregate {
  const agg: Aggregate = { impressions: 0, clicks: 0, spend: 0, leads: 0, engagements: 0 };
  for (const d of daily) {
    if (!campaignIds.has(d.campaignId)) continue;
    if (d.date < start || d.date > end) continue;
    agg.impressions += d.impressions;
    agg.clicks += d.clicks;
    agg.spend += d.costInLocalCurrency;
    agg.leads += d.externalWebsiteConversions;
    agg.engagements += d.totalEngagements;
  }
  return agg;
}

function buildKpis(current: Aggregate, previous: Aggregate): ComputedKPIsWithDelta {
  const ctrCur = current.impressions > 0 ? current.clicks / current.impressions : 0;
  const ctrPrev = previous.impressions > 0 ? previous.clicks / previous.impressions : 0;
  const cpmCur = current.impressions > 0 ? (current.spend / current.impressions) * 1000 : 0;
  const cpmPrev = previous.impressions > 0 ? (previous.spend / previous.impressions) * 1000 : 0;
  const cplCur = current.leads > 0 ? current.spend / current.leads : 0;
  const cplPrev = previous.leads > 0 ? previous.spend / previous.leads : 0;

  return {
    budget: emptyKpi(current.spend, previous.spend),
    impressions: emptyKpi(current.impressions, previous.impressions),
    cpm: emptyKpi(cpmCur, cpmPrev),
    ctr: emptyKpi(ctrCur, ctrPrev),
    clicks: emptyKpi(current.clicks, previous.clicks),
    cpl: emptyKpi(cplCur, cplPrev),
    leads: emptyKpi(current.leads, previous.leads),
    totalEngagements: emptyKpi(current.engagements, previous.engagements),
  };
}

export function DashboardShell({ data }: DashboardShellProps) {
  const availableDates = useMemo(() => {
    const set = new Set<string>();
    for (const d of data.dailyAnalytics) set.add(d.date);
    return Array.from(set).sort();
  }, [data.dailyAnalytics]);

  const maxDate = availableDates[availableDates.length - 1] ?? data.dataPeriod?.end ?? toISODate(new Date());
  const minDate = availableDates[0] ?? data.dataPeriod?.start ?? toISODate(addDays(new Date(), -90));

  const defaultEnd = maxDate;
  const defaultStart = useMemo(() => {
    const endDate = new Date(defaultEnd);
    return toISODate(addDays(endDate, -(DEFAULT_LOOKBACK_DAYS - 1)));
  }, [defaultEnd]);

  const [range, setRange] = useState<{ start: string; end: string }>({
    start: defaultStart < minDate ? minDate : defaultStart,
    end: defaultEnd,
  });
  const [groupFilter, setGroupFilter] = useState<string>(ALL_GROUPS);

  // Filter campaigns by selected group
  const filteredCampaigns: Campaign[] = useMemo(
    () =>
      groupFilter === ALL_GROUPS
        ? data.campaigns
        : data.campaigns.filter((c) => c.campaignGroupId === groupFilter),
    [data.campaigns, groupFilter],
  );

  const campaignIdSet = useMemo(
    () => new Set(filteredCampaigns.map((c) => c.id)),
    [filteredCampaigns],
  );

  // Compute previous period of same length, immediately before
  const { previousStart, previousEnd } = useMemo(() => {
    const startD = new Date(range.start);
    const endD = new Date(range.end);
    const span = Math.max(1, Math.round((endD.getTime() - startD.getTime()) / 86400000) + 1);
    const prevEnd = addDays(startD, -1);
    const prevStart = addDays(prevEnd, -(span - 1));
    return { previousStart: toISODate(prevStart), previousEnd: toISODate(prevEnd) };
  }, [range]);

  const kpis = useMemo(() => {
    const cur = aggregate(data.dailyAnalytics, campaignIdSet, range.start, range.end);
    const prev = aggregate(data.dailyAnalytics, campaignIdSet, previousStart, previousEnd);
    return buildKpis(cur, prev);
  }, [data.dailyAnalytics, campaignIdSet, range, previousStart, previousEnd]);

  const dailyForChart = useMemo(
    () => data.dailyAnalytics.filter((d) => campaignIdSet.has(d.campaignId)),
    [data.dailyAnalytics, campaignIdSet],
  );

  return (
    <div className="min-h-screen px-6 py-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <Image src="/logo.svg" alt="Valala" width={40} height={40} className="rounded-full" />
          <div>
            <h1 className="text-xl font-semibold">{CLIENT_TITLE}</h1>
            <p className="text-xs muted">{CLIENT_SUBTITLE}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs muted">
            MAJ {formatDate(data.lastUpdated)}
          </span>
        </div>
      </header>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="card-elev px-3 py-2 flex items-center gap-2 text-sm">
          <span className="muted text-xs uppercase tracking-wider">Groupe de campagnes</span>
          <select
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
            className="bg-transparent text-sm focus:outline-none"
          >
            <option value={ALL_GROUPS} className="bg-[#11141d]">Tous</option>
            {data.campaignGroups.map((g) => (
              <option key={g.id} value={g.id} className="bg-[#11141d]">
                {g.name}
              </option>
            ))}
          </select>
        </div>
        <DateSelector
          start={range.start}
          end={range.end}
          min={minDate}
          max={maxDate}
          onChange={setRange}
        />
        <span className="text-xs muted">
          Comparé à {formatDate(previousStart)} → {formatDate(previousEnd)}
        </span>
      </div>

      {/* KPIs */}
      <KpiGrid kpis={kpis} currency={data.currency} />

      {/* Chart + table */}
      <div className="mt-6 grid grid-cols-1 gap-4">
        <PerformanceChart
          dailyAnalytics={dailyForChart}
          start={range.start}
          end={range.end}
        />
        <CampaignTable
          campaigns={filteredCampaigns}
          dailyAnalytics={data.dailyAnalytics}
          start={range.start}
          end={range.end}
          currency={data.currency}
        />
      </div>

      {/* TODO V2: <OutboundSection /> — lemlist KPIs, sequence performance */}
      {/* TODO V3: <ABXSection /> — cross-source matching, influence funnel, pipeline */}

      <footer className="mt-10 text-xs muted text-center">
        Valala · Dashboard généré le {formatDate(data.lastUpdated)} · Données LinkedIn Ads
        {/* Acknowledge unused exports while V1 only renders a subset */}
        <span className="hidden">{KPI_CONFIG.length}</span>
      </footer>
    </div>
  );
}
