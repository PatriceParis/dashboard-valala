"use client";

import { useMemo, useState } from "react";
import type { ABXData, DailyAnalytics } from "@/lib/types";
import { formatCurrency, formatNumber, formatPercentage } from "@/lib/utils";

interface Props {
  data?: ABXData;
  currency: string;
  /** Daily analytics filtered to currently visible campaigns (mêmes filtres que KPI grid). */
  dailyAnalytics: DailyAnalytics[];
  /** Start/end of the period selected in the header (YYYY-MM-DD). */
  start: string;
  end: string;
}

type SortKey = "name" | "confidence" | "pipelineEUR" | "revenueEUR";

/**
 * ABX — matching cross-source + funnel d'influence.
 * NB : le matching paid↔CRM est calculé au build sur 90j (snapshot).
 * Le `spend` et le `ROAS` sont, eux, **dynamiques** : ils reflètent
 * la période sélectionnée dans l'en-tête du dashboard (= même valeur
 * que le KPI « Dépenses » de l'onglet Performance).
 */
export function ABXSection({ data, currency, dailyAnalytics, start, end }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("revenueEUR");
  const [sortAsc, setSortAsc] = useState(false);

  // Spend dynamique aligné sur la période sélectionnée (même calcul que KPI Dépenses).
  const dynamicSpend = useMemo(() => {
    let sum = 0;
    for (const d of dailyAnalytics) {
      if (d.date < start || d.date > end) continue;
      sum += d.costInLocalCurrency;
    }
    return sum;
  }, [dailyAnalytics, start, end]);

  if (!data || data.matches.length === 0) {
    return (
      <div className="card-elev p-6 text-sm">
        <h3 className="text-base font-semibold mb-2">ABX</h3>
        <p className="muted">
          Aucune donnée ABX. Configurer{" "}
          <code className="text-xs">HUBSPOT_ACCESS_TOKEN</code> dans les env vars Vercel
          puis relancer un déploiement.
        </p>
      </div>
    );
  }

  const { funnel } = data;
  const conversionRate = funnel.reached > 0 ? funnel.inCRM / funnel.reached : 0;
  const winRate = funnel.inCRM > 0 ? funnel.won / funnel.inCRM : 0;
  const roas = dynamicSpend > 0 ? funnel.revenueEUR / dynamicSpend : 0;

  const rows = useMemo(() => {
    return [...data.matches].sort((a, b) => {
      if (sortKey === "name") {
        return sortAsc ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
      }
      const av = (sortKey === "confidence" ? a.confidence : a[sortKey] ?? 0) as number;
      const bv = (sortKey === "confidence" ? b.confidence : b[sortKey] ?? 0) as number;
      return sortAsc ? av - bv : bv - av;
    });
  }, [data.matches, sortKey, sortAsc]);

  const setSort = (k: SortKey) => {
    if (k === sortKey) setSortAsc((v) => !v);
    else {
      setSortKey(k);
      setSortAsc(k === "name");
    }
  };

  const header = (k: SortKey, label: string, align: "left" | "right" = "right") => (
    <th
      onClick={() => setSort(k)}
      className={`px-3 py-2 cursor-pointer select-none ${align === "right" ? "text-right" : "text-left"}`}
    >
      {label} {sortKey === k ? (sortAsc ? "↑" : "↓") : ""}
    </th>
  );

  return (
    <div className="space-y-4">
      {/* Funnel */}
      <div className="card-elev p-4">
        <h3 className="text-sm font-semibold mb-3">Funnel d&apos;influence</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
          <FunnelStep label="Reached" value={funnel.reached} />
          <FunnelStep
            label="In CRM"
            value={funnel.inCRM}
            sub={formatPercentage(conversionRate)}
          />
          <FunnelStep label="Devis" value={funnel.quoted} />
          <FunnelStep
            label="Won"
            value={funnel.won}
            sub={funnel.inCRM > 0 ? formatPercentage(winRate) : undefined}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-white/5">
          <Money label="Pipeline" value={formatCurrency(funnel.pipelineEUR, currency)} />
          <Money label="Revenue won" value={formatCurrency(funnel.revenueEUR, currency)} />
          <Money
            label="ROAS"
            value={dynamicSpend > 0 ? `${roas.toFixed(2)}x` : "—"}
            sub={`Dépenses ${formatCurrency(dynamicSpend, currency)} (période sélectionnée)`}
          />
        </div>
        <p className="text-[10px] muted mt-2">
          Funnel calculé sur les entreprises atteintes en 90 j (snapshot ABX). Le
          ROAS et les dépenses utilisent la période sélectionnée dans l&apos;en-tête
          — cohérents avec le KPI « Dépenses ».
        </p>
      </div>

      {/* Companies table */}
      <div className="card-elev p-4">
        <h3 className="text-sm font-semibold mb-3">
          Entreprises matchées <span className="muted font-normal text-xs">({rows.length})</span>
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs muted">
              <tr>
                {header("name", "Entreprise", "left")}
                <th className="px-3 py-2 text-left">Source</th>
                <th className="px-3 py-2 text-left">Match</th>
                {header("confidence", "Confiance")}
                <th className="px-3 py-2 text-left">CRM</th>
                <th className="px-3 py-2 text-left">Devis</th>
                <th className="px-3 py-2 text-left">Won</th>
                {header("pipelineEUR", "Pipeline")}
                {header("revenueEUR", "Revenue")}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 300).map((r) => (
                <tr key={r.id} className="border-t border-white/5">
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="px-3 py-2 text-xs">
                    {r.sources.map((s) => (
                      <span
                        key={s}
                        className="text-[10px] mr-1 px-2 py-0.5 rounded bg-white/10"
                      >
                        {s}
                      </span>
                    ))}
                  </td>
                  <td className="px-3 py-2 text-xs muted">{r.matchKind}</td>
                  <td className="px-3 py-2 text-right text-xs">
                    {formatPercentage(r.confidence)}
                  </td>
                  <td className="px-3 py-2">{r.inCRM ? "✓" : "—"}</td>
                  <td className="px-3 py-2">{r.quoted ? "✓" : "—"}</td>
                  <td className="px-3 py-2">{r.won ? "✓" : "—"}</td>
                  <td className="px-3 py-2 text-right">
                    {r.pipelineEUR ? formatCurrency(r.pipelineEUR, currency) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {r.revenueEUR ? formatCurrency(r.revenueEUR, currency) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 300 && (
            <div className="text-xs muted mt-3 text-center">
              {rows.length - 300} entreprises supplémentaires non affichées (limit 300).
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FunnelStep({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="card-elev p-3">
      <div className="text-[10px] muted uppercase tracking-wider">{label}</div>
      <div className="text-base font-semibold mt-1">{formatNumber(value)}</div>
      {sub && <div className="text-[10px] muted mt-0.5">{sub}</div>}
    </div>
  );
}

function Money({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-[10px] muted uppercase tracking-wider">{label}</div>
      <div className="text-base font-semibold mt-1">{value}</div>
      {sub && <div className="text-[10px] muted mt-0.5">{sub}</div>}
    </div>
  );
}
