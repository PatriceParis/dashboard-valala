"use client";

import { useMemo, useState } from "react";
import type { CompanyAnalytics } from "@/lib/types";
import { formatCurrency, formatNumber, formatPercentage } from "@/lib/utils";

interface Props {
  windows: CompanyAnalytics[];
  currency: string;
}

type Window = "7d" | "30d" | "90d";
type SortKey = "impressions" | "clicks" | "ctr" | "spend";

/**
 * Companies reached — table from MEMBER_COMPANY pivot.
 * 3 time windows (7 / 30 / 90 jours). Selectable + sortable.
 */
export function CompaniesTable({ windows, currency }: Props) {
  const [win, setWin] = useState<Window>("30d");
  const [sortKey, setSortKey] = useState<SortKey>("impressions");
  const [sortAsc, setSortAsc] = useState(false);

  const current = useMemo(
    () => windows.find((w) => w.window === win) ?? { window: win, entries: [] },
    [windows, win],
  );

  const rows = useMemo(() => {
    return current.entries
      .map((e) => ({
        ...e,
        ctr: e.impressions > 0 ? e.clicks / e.impressions : 0,
      }))
      .sort((a, b) => {
        const av = a[sortKey];
        const bv = b[sortKey];
        return sortAsc ? av - bv : bv - av;
      });
  }, [current, sortKey, sortAsc]);

  const setSort = (k: SortKey) => {
    if (k === sortKey) setSortAsc((v) => !v);
    else {
      setSortKey(k);
      setSortAsc(false);
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
    <div className="card-elev p-4">
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <h3 className="text-sm font-semibold">
          Entreprises atteintes <span className="muted font-normal text-xs">({rows.length})</span>
        </h3>
        <div className="flex items-center gap-1 text-xs">
          {(["7d", "30d", "90d"] as const).map((w) => (
            <button
              key={w}
              onClick={() => setWin(w)}
              className={`px-3 py-1 rounded ${
                win === w ? "bg-white/10" : "bg-transparent hover:bg-white/5"
              }`}
            >
              {w === "7d" ? "7 j" : w === "30d" ? "30 j" : "90 j"}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="text-sm muted text-center py-6">
          Aucune entreprise sur cette fenêtre.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs muted">
              <tr>
                <th className="px-3 py-2 text-left">#</th>
                <th className="px-3 py-2 text-left">Entreprise</th>
                {header("impressions", "Impressions")}
                {header("clicks", "Clics")}
                {header("ctr", "CTR")}
                {header("spend", "Dépense")}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 200).map((r, i) => (
                <tr key={r.orgId} className="border-t border-white/5">
                  <td className="px-3 py-2 text-xs muted">{i + 1}</td>
                  <td className="px-3 py-2">
                    {r.vanityName ? (
                      <a
                        href={`https://www.linkedin.com/company/${r.vanityName}`}
                        target="_blank"
                        rel="noreferrer"
                        className="underline-offset-2 hover:underline"
                      >
                        {r.name}
                      </a>
                    ) : (
                      r.name
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">{formatNumber(r.impressions)}</td>
                  <td className="px-3 py-2 text-right">{formatNumber(r.clicks)}</td>
                  <td className="px-3 py-2 text-right">{formatPercentage(r.ctr)}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(r.spend, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 200 && (
            <div className="text-xs muted mt-3 text-center">
              {rows.length - 200} entreprises supplémentaires non affichées (limit 200).
            </div>
          )}
        </div>
      )}
    </div>
  );
}
