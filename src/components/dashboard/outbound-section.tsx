"use client";

import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { OutboundData } from "@/lib/types";
import { formatNumber, formatPercentage, formatShortDate } from "@/lib/utils";

interface Props {
  data?: OutboundData;
}

type SortKey = "emailsSent" | "openRate" | "replyRate";

type TableFilter = "active" | "all";

/**
 * Outbound — lemlist KPIs + chart d'activité + tableau campagnes
 * (cf. skill § Périmètre / 2. Outbound, guide multi-source).
 */
export function OutboundSection({ data }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("emailsSent");
  const [sortAsc, setSortAsc] = useState(false);
  const [tableFilter, setTableFilter] = useState<TableFilter>("active");

  if (!data) {
    return (
      <div className="card-elev p-6 text-sm">
        <h3 className="text-base font-semibold mb-2">Outbound</h3>
        <p className="muted">
          Aucune donnée lemlist trouvée. Configurer{" "}
          <code className="text-xs">LEMLIST_API_KEY</code> dans les env vars Vercel
          puis relancer un déploiement.
        </p>
      </div>
    );
  }
  if (data.campaigns.length === 0) {
    return (
      <div className="card-elev p-6 text-sm">
        <h3 className="text-base font-semibold mb-2">Outbound</h3>
        <p className="muted">
          Connecté à lemlist (clé valide) mais 0 campagne avec stats sur la période.
          Vérifier les logs de build (`fetch-lemlist`) — appel `/campaigns/&#123;id&#125;/stats`
          probablement en erreur (paramètres date obligatoires).
        </p>
      </div>
    );
  }

  const totals = useMemo(() => {
    return data.campaigns.reduce(
      (acc, c) => ({
        emailsSent: acc.emailsSent + c.emailsSent,
        emailsOpened: acc.emailsOpened + c.emailsOpened,
        emailsReplied: acc.emailsReplied + c.emailsReplied,
        linkedinSent: acc.linkedinSent + c.linkedinSent,
        linkedinAccepted: acc.linkedinAccepted + c.linkedinAccepted,
        leadsTotal: acc.leadsTotal + c.leadsTotal,
        mqlCount: acc.mqlCount + c.mqlCount,
        sqlCount: acc.sqlCount + c.sqlCount,
        dealCount: acc.dealCount + c.dealCount,
      }),
      {
        emailsSent: 0,
        emailsOpened: 0,
        emailsReplied: 0,
        linkedinSent: 0,
        linkedinAccepted: 0,
        leadsTotal: 0,
        mqlCount: 0,
        sqlCount: 0,
        dealCount: 0,
      },
    );
  }, [data.campaigns]);

  // Enrichir avec les taux pour tri + affichage
  const enriched = useMemo(() => {
    return data.campaigns.map((c) => {
      const openRate = c.emailsSent > 0 ? c.emailsOpened / c.emailsSent : 0;
      const replyRate = c.emailsSent > 0 ? c.emailsReplied / c.emailsSent : 0;
      return { ...c, openRate, replyRate };
    });
  }, [data.campaigns]);

  // Filtre actives = avec au moins 1 envoi sur la période
  const filtered = useMemo(() => {
    return enriched.filter((c) => tableFilter === "all" || c.emailsSent > 0);
  }, [enriched, tableFilter]);

  const rows = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      return sortAsc ? av - bv : bv - av;
    });
  }, [filtered, sortKey, sortAsc]);

  const hiddenCount = enriched.length - filtered.length;

  const setSort = (k: SortKey) => {
    if (k === sortKey) setSortAsc((v) => !v);
    else {
      setSortKey(k);
      setSortAsc(false);
    }
  };

  const header = (k: SortKey, label: string) => (
    <th
      onClick={() => setSort(k)}
      className="px-3 py-2 text-right cursor-pointer select-none"
    >
      {label} {sortKey === k ? (sortAsc ? "↑" : "↓") : ""}
    </th>
  );

  const openRate = totals.emailsSent > 0 ? totals.emailsOpened / totals.emailsSent : 0;
  const replyRate = totals.emailsSent > 0 ? totals.emailsReplied / totals.emailsSent : 0;
  // NB: pas de % d'acceptation affiché — le dénominateur « invitations envoyées »
  // n'est pas exposé au top-level de l'API lemlist v2 (`perChannel.linkedin.sent`
  // compte les **messages chat**, pas les **invitations**). À recomposer en
  // sommant `steps[?].invited` si on veut un vrai taux (à faire en V2).

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        <Kpi label="Emails envoyés" value={formatNumber(totals.emailsSent)} />
        <Kpi label="Ouvertures" value={formatNumber(totals.emailsOpened)} sub={formatPercentage(openRate)} />
        <Kpi label="Réponses" value={formatNumber(totals.emailsReplied)} sub={formatPercentage(replyRate)} />
        <Kpi
          label="Messages LinkedIn"
          value={formatNumber(totals.linkedinSent)}
          sub="chat (hors invits)"
        />
        <Kpi label="Invits acceptées" value={formatNumber(totals.linkedinAccepted)} />
        <Kpi
          label="Intéressés / Répondus / RDV"
          value={`${totals.mqlCount} / ${totals.sqlCount} / ${totals.dealCount}`}
          sub="source : lemlist (proxy)"
        />
      </div>

      {/* Activity chart */}
      <div className="card-elev p-4">
        <h3 className="text-sm font-semibold mb-3">Activité quotidienne (90j)</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.dailyActivity}>
              <defs>
                <linearGradient id="sentG" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="repliedG" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.5} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis
                dataKey="date"
                tickFormatter={(d) => formatShortDate(String(d ?? ""))}
                tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 11 }}
                axisLine={false}
              />
              <YAxis tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 11 }} axisLine={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#11141d",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 6,
                  fontSize: 12,
                }}
                labelFormatter={(v) => (typeof v === "string" ? formatShortDate(v) : String(v ?? ""))}
              />
              <Area
                type="monotone"
                dataKey="emailsSent"
                stroke="#3b82f6"
                fill="url(#sentG)"
                name="Envoyés"
              />
              <Area
                type="monotone"
                dataKey="emailsReplied"
                stroke="#10b981"
                fill="url(#repliedG)"
                name="Réponses"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Campaigns table */}
      <div className="card-elev p-4">
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <h3 className="text-sm font-semibold">
            Campagnes lemlist{" "}
            <span className="muted font-normal text-xs">
              ({rows.length}
              {hiddenCount > 0 && ` · ${hiddenCount} sans envoi masquées`})
            </span>
          </h3>
          <div className="flex items-center gap-1 text-[11px]">
            <span className="muted mr-1">Afficher :</span>
            {(
              [
                { id: "active", label: "Actives (avec envois)" },
                { id: "all", label: "Toutes" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                onClick={() => setTableFilter(opt.id)}
                className={`px-3 py-1 rounded ${
                  tableFilter === opt.id
                    ? "bg-white/10 text-white"
                    : "bg-transparent muted hover:bg-white/5 hover:text-white"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs muted border-b border-white/10">
              <tr>
                <th className="px-3 py-2 text-left">Campagne</th>
                <th className="px-3 py-2 text-left">Statut</th>
                {header("emailsSent", "Envoyés")}
                {header("openRate", "Ouverture")}
                {header("replyRate", "Réponse")}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-white/5 hover:bg-white/[0.02]">
                  <td className="px-3 py-2 max-w-[420px]">
                    <div className="truncate" title={r.name}>
                      {r.name}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.emailsSent > 0 ? formatNumber(r.emailsSent) : <span className="muted">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <RateCell rate={r.openRate} count={r.emailsOpened} hasBase={r.emailsSent > 0} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <RateCell rate={r.replyRate} count={r.emailsReplied} hasBase={r.emailsSent > 0} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && (
            <div className="text-sm muted text-center py-6">
              Aucune campagne dans ce filtre.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const isActive = status === "running" || status === "ACTIVE";
  return (
    <span
      className={`px-2 py-0.5 rounded text-[10px] inline-block ${
        isActive ? "bg-emerald-500/20 text-emerald-300" : "bg-white/10 muted"
      }`}
    >
      {isActive ? "active" : status}
    </span>
  );
}

function RateCell({
  rate,
  count,
  hasBase,
}: {
  rate: number;
  count: number;
  hasBase: boolean;
}) {
  if (!hasBase) return <span className="muted">—</span>;
  return (
    <div className="inline-flex flex-col items-end gap-0">
      <span className="tabular-nums font-medium">{formatPercentage(rate)}</span>
      <span className="text-[10px] muted tabular-nums">{formatNumber(count)}</span>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card-elev p-3">
      <div className="text-[10px] muted uppercase tracking-wider">{label}</div>
      <div className="text-base font-semibold mt-1">{value}</div>
      {sub && <div className="text-[10px] muted mt-0.5">{sub}</div>}
    </div>
  );
}
