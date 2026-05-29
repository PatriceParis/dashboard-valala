"use client";

import { useMemo, useState } from "react";
import type { Creative, CreativeAnalytics } from "@/lib/types";
import { formatCurrency, formatNumber, formatPercentage } from "@/lib/utils";

interface Props {
  creatives: Creative[];
  creativeAnalytics: CreativeAnalytics[];
  currency: string;
  /** Filter creatives by campaigns that are visible given current filters */
  visibleCampaignIds: Set<string>;
}

type SortKey = "ctr" | "impressions" | "clicks" | "leads" | "spend";

/**
 * Creatives gallery — LinkedIn-post-style cards with CTR badge.
 * Aggregates analytics over the full data window (≈ 90 j) because creatives
 * don't have a daily breakdown by design (cf. skill § Pipeline § creatives 90j).
 */
export function CreativesGallery({
  creatives,
  creativeAnalytics,
  currency,
  visibleCampaignIds,
}: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("ctr");
  const [sortAsc, setSortAsc] = useState(false);

  const rows = useMemo(() => {
    const statsById = new Map<string, CreativeAnalytics>(
      creativeAnalytics.map((a) => [a.creativeId, a]),
    );
    return creatives
      .filter((c) => visibleCampaignIds.size === 0 || visibleCampaignIds.has(c.campaignId))
      .map((c) => {
        const s = statsById.get(c.id) ?? {
          creativeId: c.id,
          impressions: 0,
          clicks: 0,
          costInLocalCurrency: 0,
          oneClickLeads: 0,
          totalEngagements: 0,
        };
        const ctr = s.impressions > 0 ? s.clicks / s.impressions : 0;
        return {
          creative: c,
          ctr,
          impressions: s.impressions,
          clicks: s.clicks,
          leads: s.oneClickLeads,
          spend: s.costInLocalCurrency,
          videoViews: s.videoViews ?? 0,
        };
      })
      .filter((r) => r.impressions > 0)
      .sort((a, b) => {
        const av = a[sortKey];
        const bv = b[sortKey];
        return sortAsc ? av - bv : bv - av;
      });
  }, [creatives, creativeAnalytics, visibleCampaignIds, sortKey, sortAsc]);

  const setSort = (k: SortKey) => {
    if (k === sortKey) setSortAsc((v) => !v);
    else {
      setSortKey(k);
      setSortAsc(false);
    }
  };

  if (rows.length === 0) {
    return (
      <div className="card-elev p-6 text-sm muted text-center">
        Aucune créative avec des impressions sur cette période.
      </div>
    );
  }

  return (
    <div className="card-elev p-4">
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <h3 className="text-sm font-semibold">Créatives</h3>
        <div className="flex items-center gap-2 text-xs">
          <span className="muted">Trier par :</span>
          {(["ctr", "impressions", "clicks", "leads", "spend"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setSort(k)}
              className={`px-2 py-0.5 rounded ${
                sortKey === k ? "bg-white/10" : "bg-transparent hover:bg-white/5"
              }`}
            >
              {labelFor(k)} {sortKey === k ? (sortAsc ? "↑" : "↓") : ""}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {rows.slice(0, 60).map((r) => (
          <CreativeCard key={r.creative.id} row={r} currency={currency} />
        ))}
      </div>
      {rows.length > 60 && (
        <div className="text-xs muted mt-3 text-center">
          {rows.length - 60} autres créatives non affichées (limit 60).
        </div>
      )}
    </div>
  );
}

function labelFor(k: SortKey): string {
  switch (k) {
    case "ctr":
      return "CTR";
    case "impressions":
      return "Imp.";
    case "clicks":
      return "Clics";
    case "leads":
      return "Leads";
    case "spend":
      return "Dépense";
  }
}

interface RowVM {
  creative: Creative;
  ctr: number;
  impressions: number;
  clicks: number;
  leads: number;
  spend: number;
  videoViews: number;
}

function CreativeCard({ row, currency }: { row: RowVM; currency: string }) {
  const { creative, ctr, impressions, clicks, leads, spend } = row;
  const ctrBadgeColor =
    ctr >= 0.012
      ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
      : ctr >= 0.006
        ? "bg-amber-500/20 text-amber-300 border-amber-500/30"
        : "bg-rose-500/20 text-rose-300 border-rose-500/30";

  return (
    <article className="card-elev p-3 flex flex-col gap-2">
      <header className="flex items-start gap-2">
        <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-xs font-semibold">
          {(creative.authorName ?? creative.campaignName ?? "?").slice(0, 2).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium truncate">
            {creative.authorName ?? creative.campaignName ?? `Creative ${creative.id}`}
          </div>
          <div className="text-[10px] muted truncate">
            {creative.campaignGroupName ?? "—"} · {creative.type ?? creative.status}
          </div>
        </div>
        <span
          className={`text-[10px] px-2 py-0.5 rounded border ${ctrBadgeColor}`}
          title="CTR sur la période fetched (≈ 90 j)"
        >
          {formatPercentage(ctr)}
        </span>
      </header>

      {creative.text && (
        <p className="text-xs leading-snug line-clamp-3 muted">{creative.text}</p>
      )}

      {creative.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={creative.imageUrl}
          alt={creative.text ?? "creative"}
          className="rounded w-full aspect-[1.91/1] object-cover"
        />
      )}

      <dl className="grid grid-cols-4 gap-1 text-[10px]">
        <Stat label="Imp." value={formatNumber(impressions)} />
        <Stat label="Clics" value={formatNumber(clicks)} />
        <Stat label="Leads" value={formatNumber(leads)} />
        <Stat label="Dépense" value={formatCurrency(spend, currency)} />
      </dl>

      {creative.postUrl && (
        <a
          href={creative.postUrl}
          target="_blank"
          rel="noreferrer"
          className="text-[10px] underline muted hover:opacity-80"
        >
          Voir le post
        </a>
      )}
    </article>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="muted">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
