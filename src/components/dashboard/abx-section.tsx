"use client";

import { useMemo, useState } from "react";
import type { ABXData } from "@/lib/types";
import { formatCurrency, formatDate, formatNumber, formatPercentage } from "@/lib/utils";

interface Props {
  data?: ABXData;
  currency: string;
}

type SortKey = "name" | "confidence" | "pipelineEUR" | "revenueEUR";
type SourceFilter = "all" | "paid" | "outbound" | "both";
type PhaseFilter = "all" | "quoted" | "won" | "lost" | "noDeal";
type InfluenceFilter = "all" | "influenced" | "preexisting";

/**
 * Impact CRM — matching cross-source (LinkedIn Ads ABX + lemlist outbound) ↔ HubSpot.
 *
 * Funnel & financier figés sur le snapshot 90j. Le ROAS = revenue INFLUENCÉ
 * (deals créés après le lancement ABX) / dépenses ABX 90j. Volontairement
 * INDÉPENDANT du sélecteur de période du header : diviser un revenue cumulé par
 * un spend de fenêtre courte donnerait un ROAS aberrant (cf. weekly 04/06).
 */
export function ABXSection({ data, currency }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("revenueEUR");
  const [sortAsc, setSortAsc] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [phaseFilter, setPhaseFilter] = useState<PhaseFilter>("all");
  const [influenceFilter, setInfluenceFilter] = useState<InfluenceFilter>("all");

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
      // Influence filter (post-ABX vs préexistant)
      if (influenceFilter === "influenced" && !m.influenced) return false;
      if (influenceFilter === "preexisting" && (m.influenced || !m.inCRM)) return false;
      return true;
    });
  }, [matches, sourceFilter, phaseFilter, influenceFilter]);

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

  // Lecture PRINCIPALE = comptes TOUCHÉS par l'ABX présents au CRM, pipeline et
  // revenue inclus (y compris comptes déjà clients ré-engagés — cœur de l'ABM/ABX).
  // L'influence STRICTE (entrées / deals créés post-lancement) est gardée en
  // sous-couche de transparence, jamais en valeur unique affichée (sinon un deal
  // sur un compte pré-existant comme Freelance Day disparaît → trompeur).
  const reachToCrm = funnel.reached > 0 ? funnel.inCRM / funnel.reached : 0;
  const crmToQuoted = funnel.inCRM > 0 ? funnel.quoted / funnel.inCRM : 0;
  const quotedToWon = funnel.quoted > 0 ? funnel.won / funnel.quoted : 0;
  const spendABX = funnel.spendEUR;
  // ROAS principal = revenue des comptes touchés / dépenses ABX (touch-attribution).
  // ROAS plancher = revenue strictement influencé post-ABX (conservateur).
  const roas = spendABX > 0 ? funnel.revenueEUR / spendABX : 0;
  const roasFloor = spendABX > 0 ? funnel.revenueInfluencedEUR / spendABX : 0;
  const preexistingInCRM = funnel.inCRM - funnel.inCRMInfluenced;
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
            <span className="text-[10px]">« dont post-ABX » = entrée CRM / deal créé après le {formatDate(funnel.abxLaunchDate)} (lancement ABX)</span>
          </div>
        </div>

        {/* Visual funnel — lecture = comptes touchés (total), « dont post-ABX » en contexte */}
        <div className="space-y-2">
          <FunnelBar
            label="Touchées"
            sublabel="LinkedIn Ads ABX ou lemlist outbound"
            count={funnel.reached}
            rate={1}
            width={1}
            color="from-blue-500/40 to-blue-500/10"
          />
          <FunnelBar
            label="Présentes en CRM"
            sublabel="Comptes touchés retrouvés dans HubSpot"
            count={funnel.inCRM}
            rate={reachToCrm}
            width={funnel.inCRM / maxFunnel}
            color="from-indigo-500/40 to-indigo-500/10"
            rateLabel={`${formatPercentage(reachToCrm)} des touchées · dont ${formatNumber(funnel.inCRMInfluenced)} post-ABX`}
          />
          <FunnelBar
            label="Avec deal actif"
            sublabel="Au moins un deal ouvert (non clôturé)"
            count={funnel.quoted}
            rate={crmToQuoted}
            width={funnel.quoted / maxFunnel}
            color="from-purple-500/40 to-purple-500/10"
            rateLabel={`${formatPercentage(crmToQuoted)} du CRM · dont ${formatNumber(funnel.quotedInfluenced)} post-ABX`}
          />
          <FunnelBar
            label="Gagnées"
            sublabel="Closed-won (somme des commandes)"
            count={funnel.won}
            rate={quotedToWon}
            width={funnel.won / maxFunnel}
            color="from-emerald-500/40 to-emerald-500/10"
            rateLabel={`${formatPercentage(quotedToWon)} des devis · dont ${formatNumber(funnel.wonInfluenced)} post-ABX`}
          />
        </div>
        {preexistingInCRM > 0 && (
          <p className="text-[10px] muted mt-3">
            Sur les {formatNumber(funnel.inCRM)} comptes en CRM, {formatNumber(preexistingInCRM)} {preexistingInCRM > 1 ? "étaient déjà clients" : "était déjà client"} avant l&apos;ABX (relation ré-engagée par les campagnes), {formatNumber(funnel.inCRMInfluenced)} {funnel.inCRMInfluenced > 1 ? "sont de nouvelles entrées" : "est une nouvelle entrée"} post-ABX. Les deux lectures sont affichées : montant total touché + « dont post-ABX » (influence strictement nouvelle).
          </p>
        )}
      </div>

      {/* ===== Bloc 2 — KPIs financiers : comptes touchés (total) + dont post-ABX ===== */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KpiCard
          label="Pipeline comptes touchés"
          value={formatCurrency(funnel.pipelineEUR, currency)}
          sub={`${formatNumber(funnel.quoted)} entreprise${funnel.quoted > 1 ? "s" : ""} · dont ${formatCurrency(funnel.pipelineInfluencedEUR, currency)} post-ABX`}
          accent="indigo"
        />
        <KpiCard
          label="Revenue comptes touchés"
          value={formatCurrency(funnel.revenueEUR, currency)}
          sub={`${formatNumber(funnel.won)} gagnée${funnel.won > 1 ? "s" : ""} · dont ${formatCurrency(funnel.revenueInfluencedEUR, currency)} post-ABX`}
          accent="emerald"
        />
        <KpiCard
          label="ROAS (90j)"
          value={spendABX > 0 && funnel.revenueEUR > 0 ? `${roas.toFixed(2)}×` : "—"}
          sub={
            spendABX > 0
              ? `Revenue touché / Dépenses ABX ${formatCurrency(spendABX, currency)} · plancher post-ABX ${funnel.revenueInfluencedEUR > 0 ? `${roasFloor.toFixed(2)}×` : "—"}`
              : "Dépenses ABX indisponibles"
          }
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
            <div className="flex items-center gap-1">
              <span className="muted mr-1">Influence :</span>
              {(
                [
                  { id: "all", label: "Toutes" },
                  { id: "influenced", label: "Post-ABX" },
                  { id: "preexisting", label: "Déjà clientes" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setInfluenceFilter(opt.id)}
                  className={`px-2.5 py-1 rounded ${
                    influenceFilter === opt.id
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
                <th className="px-3 py-2 text-left">Influence</th>
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
                  <td className="px-3 py-2">
                    <InfluenceBadge influenced={r.influenced} inCRM={r.inCRM} />
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

function InfluenceBadge({ influenced, inCRM }: { influenced?: boolean; inCRM: boolean }) {
  if (!inCRM) return <span className="muted text-[10px]">—</span>;
  if (influenced) {
    return (
      <span className="inline-flex items-center text-[10px] px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
        Post-ABX
      </span>
    );
  }
  return (
    <span className="inline-flex items-center text-[10px] px-2 py-0.5 rounded bg-white/5 muted border border-white/10">
      Déjà cliente
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
