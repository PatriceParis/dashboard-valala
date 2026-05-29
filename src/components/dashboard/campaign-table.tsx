"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { Campaign, DailyAnalytics } from "@/lib/types";
import { formatCurrency, formatNumber, formatPercentage } from "@/lib/utils";

interface CampaignTableProps {
  campaigns: Campaign[];
  dailyAnalytics: DailyAnalytics[];
  start: string; // YYYY-MM-DD
  end: string;
  currency: string;
}

type SortKey =
  | "name"
  | "impressions"
  | "clicks"
  | "ctr"
  | "spend"
  | "cpm"
  | "leads"
  | "cpl";

interface Row {
  id: string;
  name: string;
  groupName: string;
  impressions: number;
  clicks: number;
  ctr: number;
  spend: number;
  cpm: number;
  leads: number;
  cpl: number;
}

export function CampaignTable({
  campaigns,
  dailyAnalytics,
  start,
  end,
  currency,
}: CampaignTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("spend");
  const [sortAsc, setSortAsc] = useState(false);

  const rows: Row[] = useMemo(() => {
    const byCampaign = new Map<string, { impressions: number; clicks: number; spend: number; leads: number }>();
    for (const d of dailyAnalytics) {
      if (d.date < start || d.date > end) continue;
      const cur = byCampaign.get(d.campaignId) ?? { impressions: 0, clicks: 0, spend: 0, leads: 0 };
      cur.impressions += d.impressions;
      cur.clicks += d.clicks;
      cur.spend += d.costInLocalCurrency;
      // LinkedIn Lead Gen Forms → oneClickLeads (CSV "Prospects"). Cf. dashboard-shell.
      cur.leads += d.oneClickLeads ?? 0;
      byCampaign.set(d.campaignId, cur);
    }
    return campaigns.map((c) => {
      const agg = byCampaign.get(c.id) ?? { impressions: 0, clicks: 0, spend: 0, leads: 0 };
      const ctr = agg.impressions > 0 ? agg.clicks / agg.impressions : 0;
      const cpm = agg.impressions > 0 ? (agg.spend / agg.impressions) * 1000 : 0;
      const cpl = agg.leads > 0 ? agg.spend / agg.leads : 0;
      return {
        id: c.id,
        name: c.name,
        groupName: c.campaignGroupName ?? "—",
        impressions: agg.impressions,
        clicks: agg.clicks,
        ctr,
        spend: agg.spend,
        cpm,
        leads: agg.leads,
        cpl,
      };
    });
  }, [campaigns, dailyAnalytics, start, end]);

  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "string" && typeof bv === "string") {
        return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const aN = av as number;
      const bN = bv as number;
      return sortAsc ? aN - bN : bN - aN;
    });
    return arr;
  }, [rows, sortKey, sortAsc]);

  const handleSort = (k: SortKey) => {
    if (k === sortKey) setSortAsc(!sortAsc);
    else {
      setSortKey(k);
      setSortAsc(false);
    }
  };

  const header = (k: SortKey, label: string, align: "left" | "right" = "right") => (
    <th
      key={k}
      onClick={() => handleSort(k)}
      className={`px-3 py-2 text-xs uppercase tracking-wider muted cursor-pointer select-none ${
        align === "right" ? "text-right" : "text-left"
      } hover:text-white`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sortKey === k && (sortAsc ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </span>
    </th>
  );

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-[color:var(--border)]">
          <tr>
            {header("name", "Campagne", "left")}
            {header("impressions", "Impressions")}
            {header("clicks", "Clics")}
            {header("ctr", "CTR")}
            {header("spend", "Dépenses")}
            {header("cpm", "CPM")}
            {header("leads", "Leads")}
            {header("cpl", "CPL")}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.id} className="border-b border-[color:var(--border)] last:border-0 hover:bg-white/[0.02]">
              <td className="px-3 py-2">
                <div className="font-medium">{r.name}</div>
                <div className="text-xs muted">{r.groupName}</div>
              </td>
              <td className="px-3 py-2 text-right">{formatNumber(r.impressions)}</td>
              <td className="px-3 py-2 text-right">{formatNumber(r.clicks)}</td>
              <td className="px-3 py-2 text-right">{formatPercentage(r.ctr)}</td>
              <td className="px-3 py-2 text-right">{formatCurrency(r.spend, currency)}</td>
              <td className="px-3 py-2 text-right">{formatCurrency(r.cpm, currency)}</td>
              <td className="px-3 py-2 text-right">{formatNumber(r.leads)}</td>
              <td className="px-3 py-2 text-right">{r.leads > 0 ? formatCurrency(r.cpl, currency) : "—"}</td>
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={8} className="px-3 py-8 text-center muted">
                Aucune campagne sur cette période.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
