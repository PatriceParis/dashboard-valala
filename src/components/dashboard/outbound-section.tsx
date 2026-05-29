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

type SortKey =
  | "emailsSent"
  | "emailsOpened"
  | "emailsReplied"
  | "linkedinSent"
  | "linkedinAccepted"
  | "mqlCount"
  | "sqlCount"
  | "dealCount";

/**
 * Outbound — lemlist KPIs + chart d'activité + tableau campagnes
 * (cf. skill § Périmètre / 2. Outbound, guide multi-source).
 */
export function OutboundSection({ data }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("emailsSent");
  const [sortAsc, setSortAsc] = useState(false);

  if (!data || data.campaigns.length === 0) {
    return (
      <div className="card-elev p-6 text-sm">
        <h3 className="text-base font-semibold mb-2">Outbound</h3>
        <p className="muted">
          Aucune donnée lemlist trouvée. Configurer{" "}
          <code className="text-xs">LEMLIST_API_KEY</code> dans les env vars Vercel
          (Project Settings → Environment Variables) puis relancer un déploiement.
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

  const rows = useMemo(() => {
    return [...data.campaigns].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      return sortAsc ? av - bv : bv - av;
    });
  }, [data.campaigns, sortKey, sortAsc]);

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
  const acceptRate =
    totals.linkedinSent > 0 ? totals.linkedinAccepted / totals.linkedinSent : 0;

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        <Kpi label="Emails envoyés" value={formatNumber(totals.emailsSent)} />
        <Kpi label="Ouvertures" value={formatNumber(totals.emailsOpened)} sub={formatPercentage(openRate)} />
        <Kpi label="Réponses" value={formatNumber(totals.emailsReplied)} sub={formatPercentage(replyRate)} />
        <Kpi label="Invits LinkedIn" value={formatNumber(totals.linkedinSent)} />
        <Kpi label="Acceptées" value={formatNumber(totals.linkedinAccepted)} sub={formatPercentage(acceptRate)} />
        <Kpi label="Leads" value={formatNumber(totals.leadsTotal)} />
        <Kpi label="MQL / SQL / Deal" value={`${totals.mqlCount} / ${totals.sqlCount} / ${totals.dealCount}`} />
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
        <h3 className="text-sm font-semibold mb-3">
          Campagnes lemlist <span className="muted font-normal text-xs">({rows.length})</span>
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs muted">
              <tr>
                <th className="px-3 py-2 text-left">Campagne</th>
                <th className="px-3 py-2 text-left">Statut</th>
                {header("emailsSent", "Envoyés")}
                {header("emailsOpened", "Ouverts")}
                {header("emailsReplied", "Réponses")}
                {header("linkedinSent", "LI envoyés")}
                {header("linkedinAccepted", "LI acceptés")}
                {header("mqlCount", "MQL")}
                {header("sqlCount", "SQL")}
                {header("dealCount", "Deal")}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-white/5">
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="px-3 py-2 text-xs">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] ${
                        r.status === "running" || r.status === "ACTIVE"
                          ? "bg-emerald-500/20 text-emerald-300"
                          : "bg-white/10 muted"
                      }`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">{formatNumber(r.emailsSent)}</td>
                  <td className="px-3 py-2 text-right">{formatNumber(r.emailsOpened)}</td>
                  <td className="px-3 py-2 text-right">{formatNumber(r.emailsReplied)}</td>
                  <td className="px-3 py-2 text-right">{formatNumber(r.linkedinSent)}</td>
                  <td className="px-3 py-2 text-right">{formatNumber(r.linkedinAccepted)}</td>
                  <td className="px-3 py-2 text-right">{formatNumber(r.mqlCount)}</td>
                  <td className="px-3 py-2 text-right">{formatNumber(r.sqlCount)}</td>
                  <td className="px-3 py-2 text-right">{formatNumber(r.dealCount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
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
