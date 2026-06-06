"use client";

import { useMemo, useState } from "react";
import type { ABXData, DailyAnalytics } from "@/lib/types";
import { formatCurrency, formatNumber, formatPercentage } from "@/lib/utils";

interface Props {
  data?: ABXData;
  currency: string;
  /** Daily analytics filtered to currently visible campaigns (same filters as KPI grid). */
  dailyAnalytics: DailyAnalytics[];
  /** Start/end of the period selected in the header (YYYY-MM-DD). */
  start: string;
  end: string;
}

type SortKey = "name" | "confidence" | "pipelineEUR" | "revenueEUR";
type SourceFilter = "all" | "paid" | "outbound" | "both";
type PhaseFilter = "all" | "quoted" | "won" | "lost" | "noDeal";

/**
 * Impact CRM — matching cross-source (LinkedIn Ads + lemlist outbound) ↔ HubSpot.
 *
 * Le funnel est figé sur 90j (snapshot ABX) ; le ROAS et les dépenses utilisent
 * la période sélectionnée dans l'en-tête (= même valeur que le KPI Dépenses).
 */
export function ABXSection({ data, currency, dailyAnalytics, start, end }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("revenueEUR");
  const [sortAsc, setSortAsc] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [phaseFilter, setPhaseFilter] = useState<PhaseFilter>("all");

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
        <h3 className="text-base font-semibold mb-2">Impact CRM</h3>
        <p className="muted">
          Aucune donnée d&apos;impact CRM disponible. Configurer{" "}
          <code className="text-xs">HUBSPOT_ACCESS_TOKEN</code> dans les env vars Vercel
          puis relancer un déploiement.
        </p>
      </div>
    );
  }

  const { funnel, matches } = data;

  // Source counts (totaux non filtrés)
  const sourceCounts = useMemo(() => {
    let paid = 0,
      outbound = 0,
      both = 0;
    for (const m of matches) {
      if (m.sources.length === 2) both++;
      else if (m.sources[0] === "paid") paid++;
      else if (m.sources[0] === "outbound") outbound++;
    }
    return { paid, outbound, both, total: matches.length };
  }, [matches]);

  // Filtered rows (sort + source filter + phase filter)
  const filteredMatches = useMemo(() => {
    return matches.filter((m) => {
      // Source filter
      if (sourceFilter !== "all") {
        if (sourceFilter === "both" && m.sources.length !== 2) return false;
        if (sourceFilter === "paid" && !(m.sources.length === 1 && m.sources[0] === "paid")) return false;
        if (sourceFilter === "outbound" && !(m.sources.length === 1 && m.sources[0] === "outbound")) return false;
      }
      // Phase filter
      if (phaseFilter !== "all") {
        if (phaseFilter === "quoted" && !m.quoted) return false;
        if (phaseFilter === "won" && !m.won) return false;
        if (phaseFilter === "lost" && !(m.dealsLost && m.dealsLost > 0)) return false;
        if (phaseFilter === "noDeal" && (m.quoted || m.won || (m.dealsLost ?? 0) > 0)) return false;
      }
      return true;
    });
  }, [matches, sourceFilter, phaseFilter]);

  const rows = useMemo(() => {
    return [...filteredMatches].sort((a, b) => {
      if (sortKey === "name") {
        return sortAsc ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
      }
      const av = (sortKey === "confidence" ? a.confidence : a[sortKey] ?? 0) as number;
      const bv = (sortKey === "confidence" ? b.confidence : b[sortKey] ?? 0) as number;
      return sortAsc ? av - bv : bv - av;
    });
  }, [filteredMatches, sortKey, sortAsc]);

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

  // Conversions step by step
  const reachToCrm = funnel.reached > 0 ? funnel.inCRM / funnel.reached : 0;
  const crmToQuoted = funnel.inCRM > 0 ? funnel.quoted / funnel.inCRM : 0;
  const quotedToWon = funnel.quoted > 0 ? funnel.won / funnel.quoted : 0;
  const roas = dynamicSpend > 0 ? funnel.revenueEUR / dynamicSpend : 0;
  const maxFunnel = Math.max(funnel.reached, 1);

  return (
    <div className="space-y-4">
      {/* ===== Bloc 1 — Funnel visuel ===== */}
      <div className="card-elev p-5">
        <div className="flex items-baseline justify-between mb-4 flex-wrap gap-2">
          <div>
            <h3 className="text-base font-semibold">Funnel d&apos;impact CRM</h3>
            <p className="text-[11px] muted mt-0.5">
              Périmètre : campagnes du groupe <span className="text-blue-300/90">[Up&apos;Scale Ads] - ABX</span> sur LinkedIn + lemlist outbound, croisés avec HubSpot.
            </p>
          </div>
          <div className="text-[11px] muted text-right">
            Snapshot 90 j · {formatNumber(funnel.reached)} entreprises<br />
            <span className="text-[10px]">Devis = deals ouverts, Won = closed-won (somme des commandes)</span>
          </div>
        </div>

        {/* Visual funnel — 4 bars decreasing */}
        <div className="space-y-2">
          <FunnelBar
            label="Touchées"
            sublabel="LinkedIn Ads ou lemlist outbound"
            count={funnel.reached}
            rate={1}
            width={1}
            color="from-blue-500/40 to-blue-500/10"
          />
          <FunnelBar
            label="Présentes en CRM"
            sublabel="Match HubSpot (domaine / slug / nom)"
            count={funnel.inCRM}
            rate={reachToCrm}
            width={funnel.inCRM / maxFunnel}
            color="from-indigo-500/40 to-indigo-500/10"
            rateLabel={`${formatPercentage(reachToCrm)} des touchées`}
          />
          <FunnelBar
            label="Devis ouvert"
            sublabel="Au moins un deal actif (non clôturé)"
            count={funnel.quoted}
            rate={crmToQuoted}
            width={funnel.quoted / maxFunnel}
            color="from-purple-500/40 to-purple-500/10"
            rateLabel={`${formatPercentage(crmToQuoted)} du CRM`}
          />
          <FunnelBar
            label="Gagnées"
            sublabel="Closed-won, somme de toutes les commandes"
            count={funnel.won}
            rate={quotedToWon}
            width={funnel.won / maxFunnel}
            color="from-emerald-500/40 to-emerald-500/10"
            rateLabel={`${formatPercentage(quotedToWon)} des devis`}
          />
        </div>
      </div>

      {/* ===== Bloc 2 — KPIs financiers ===== */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KpiCard
          label="Pipeline ouvert"
          value={formatCurrency(funnel.pipelineEUR, currency)}
          sub={`Somme des deals actifs · ${formatNumber(funnel.quoted)} entreprise${funnel.quoted > 1 ? "s" : ""}`}
          accent="indigo"
        />
        <KpiCard
          label="Revenue gagné"
          value={formatCurrency(funnel.revenueEUR, currency)}
          sub={`Somme de toutes les commandes closed-won · ${formatNumber(funnel.won)} entreprise${funnel.won > 1 ? "s" : ""}`}
          accent="emerald"
        />
        <KpiCard
          label="ROAS"
          value={dynamicSpend > 0 ? `${roas.toFixed(2)}×` : "—"}
          sub={`Dépenses ABX : ${formatCurrency(dynamicSpend, currency)} sur la période sélectionnée`}
          accent="orange"
        />
      </div>

      {/* ===== Bloc 3 — Répartition par source ===== */}
      <div className="card-elev p-4">
        <h3 className="text-sm font-semibold mb-3">Répartition par canal d&apos;origine</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <SourceCard
            label="LinkedIn Ads uniquement"
            count={sourceCounts.paid}
            total={sourceCounts.total}
            color="bg-blue-500/15 text-blue-300 border-blue-500/30"
            dot="bg-blue-500"
          />
          <SourceCard
            label="Outbound (lemlist) uniquement"
            count={sourceCounts.outbound}
            total={sourceCounts.total}
            color="bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
            dot="bg-emerald-500"
          />
          <SourceCard
            label="Multi-canal (Paid + Outbound)"
            count={sourceCounts.both}
            total={sourceCounts.total}
            color="bg-purple-500/15 text-purple-300 border-purple-500/30"
            dot="bg-gradient-to-r from-blue-500 to-emerald-500"
          />
        </div>
        <p className="text-[10px] muted mt-3">
          Une entreprise multi-canal a été à la fois touchée par les ads LinkedIn ET contactée via lemlist — signal d&apos;intérêt plus fort.
        </p>
      </div>

      {/* ===== Bloc 4 — Tableau entreprises matchées ===== */}
      <div className="card-elev p-4">
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <h3 className="text-sm font-semibold">
            Entreprises matchées <span className="muted font-normal text-xs">({rows.length} / {sourceCounts.total})</span>
          </h3>
          {/* Filters */}
          <div className="flex items-center gap-3 text-[11px] flex-wrap justify-end">
            <div className="flex items-center gap-1">
              <span className="muted mr-1">Canal :</span>
              {(
                [
                  { id: "all", label: "Tous" },
                  { id: "paid", label: "LinkedIn Ads" },
                  { id: "outbound", label: "Outbound" },
                  { id: "both", label: "Multi-canal" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setSourceFilter(opt.id)}
                  className={`px-2.5 py-1 rounded ${
                    sourceFilter === opt.id
                      ? "bg-white/10 text-white"
                      : "bg-transparent muted hover:bg-white/5 hover:text-white"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <span className="muted mr-1">Phase :</span>
              {(
                [
                  { id: "all", label: "Toutes" },
                  { id: "quoted", label: "Devis ouvert" },
                  { id: "won", label: "Gagnées" },
                  { id: "lost", label: "Perdues" },
                  { id: "noDeal", label: "Sans deal" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setPhaseFilter(opt.id)}
                  className={`px-2.5 py-1 rounded ${
                    phaseFilter === opt.id
                      ? "bg-white/10 text-white"
                      : "bg-transparent muted hover:bg-white/5 hover:text-white"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs muted">
              <tr>
                {header("name", "Entreprise", "left")}
                <th className="px-3 py-2 text-left">Canal</th>
                <th className="px-3 py-2 text-left">Match CRM</th>
                {header("confidence", "Confiance")}
                <th className="px-3 py-2 text-center">Deals (O / G / P)</th>
                {header("pipelineEUR", "Pipeline ouvert")}
                {header("revenueEUR", "Revenue gagné")}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 300).map((r) => (
                <tr key={r.id} className="border-t border-white/5 hover:bg-white/[0.02]">
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.name}</div>
                    {r.domain && <div className="text-[10px] muted mt-0.5">{r.domain}</div>}
                  </td>
                  <td className="px-3 py-2">
                    <SourceBadges sources={r.sources} />
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.inCRM ? (
                      <span className="text-emerald-300/80">{r.matchKind}</span>
                    ) : (
                      <span className="muted">non matchée</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-xs">
                    {r.confidence > 0 ? formatPercentage(r.confidence) : "—"}
                  </td>
                  <td className="px-3 py-2 text-center text-xs tabular-nums">
                    <DealCounts open={r.dealsOpen ?? 0} won={r.dealsWon ?? 0} lost={r.dealsLost ?? 0} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.pipelineEUR ? formatCurrency(r.pipelineEUR, currency) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.revenueEUR ? formatCurrency(r.revenueEUR, currency) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 300 && (
            <div className="text-xs muted mt-3 text-center">
              {rows.length - 300} entreprises supplémentaires non affichées (limite 300).
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Sub-components
// ============================================================

function FunnelBar({
  label,
  sublabel,
  count,
  rate,
  width,
  color,
  rateLabel,
}: {
  label: string;
  sublabel?: string;
  count: number;
  rate: number;
  width: number;
  color: string;
  rateLabel?: string;
}) {
  const pct = Math.max(0.02, Math.min(1, width)) * 100;
  return (
    <div className="relative">
      <div className="flex items-center justify-between gap-3 mb-1">
        <div>
          <span className="text-sm font-semibold">{label}</span>
          {sublabel && <span className="text-[10px] muted ml-2">{sublabel}</span>}
        </div>
        <div className="text-right">
          <span className="text-sm font-semibold tabular-nums">{formatNumber(count)}</span>
          {rateLabel && <span className="text-[10px] muted ml-2">{rateLabel}</span>}
        </div>
      </div>
      <div className="h-3 bg-white/[0.04] rounded-full overflow-hidden">
        <div
          className={`h-full bg-gradient-to-r ${color} rounded-full transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "indigo" | "emerald" | "orange";
}) {
  const accentClass =
    accent === "indigo"
      ? "border-l-indigo-500/60"
      : accent === "emerald"
        ? "border-l-emerald-500/60"
        : accent === "orange"
          ? "border-l-orange-500/60"
          : "border-l-white/20";
  return (
    <div className={`card-elev p-4 border-l-2 ${accentClass}`}>
      <div className="text-[10px] muted uppercase tracking-wider">{label}</div>
      <div className="text-xl font-semibold mt-1">{value}</div>
      {sub && <div className="text-[10px] muted mt-1">{sub}</div>}
    </div>
  );
}

function SourceCard({
  label,
  count,
  total,
  color,
  dot,
}: {
  label: string;
  count: number;
  total: number;
  color: string;
  dot: string;
}) {
  const pct = total > 0 ? count / total : 0;
  return (
    <div className={`p-3 rounded-lg border ${color}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className={`w-2 h-2 rounded-full ${dot}`} />
        <span className="text-[11px] font-medium">{label}</span>
      </div>
      <div className="text-lg font-semibold mt-1 tabular-nums">{formatNumber(count)}</div>
      <div className="text-[10px] muted mt-0.5">{formatPercentage(pct)} du total</div>
    </div>
  );
}

function DealCounts({ open, won, lost }: { open: number; won: number; lost: number }) {
  if (open === 0 && won === 0 && lost === 0) return <span className="muted">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span title="Deals ouverts" className={open > 0 ? "text-purple-300" : "muted"}>
        {open}
      </span>
      <span className="muted text-[10px]">/</span>
      <span title="Deals gagnés" className={won > 0 ? "text-emerald-300" : "muted"}>
        {won}
      </span>
      <span className="muted text-[10px]">/</span>
      <span title="Deals perdus" className={lost > 0 ? "text-red-300/80" : "muted"}>
        {lost}
      </span>
    </span>
  );
}

function SourceBadges({ sources }: { sources: Array<"paid" | "outbound"> }) {
  if (sources.length === 2) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/30">
        Multi-canal
      </span>
    );
  }
  if (sources[0] === "paid") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-blue-500/15 text-blue-300 border border-blue-500/30">
        LinkedIn Ads
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
      Outbound
    </span>
  );
}
