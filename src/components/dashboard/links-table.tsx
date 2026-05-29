"use client";

import { useMemo } from "react";
import type { Creative } from "@/lib/types";

interface Props {
  creatives: Creative[];
  visibleCampaignIds: Set<string>;
}

/**
 * Links table — flat list of ad URLs (TLA, videos, lead gen forms),
 * groupé par campagne, avec accès direct aux posts LinkedIn (quand résolvables)
 * et statut TLA (auteur identifié ou non).
 */
export function LinksTable({ creatives, visibleCampaignIds }: Props) {
  const rows = useMemo(() => {
    return creatives
      .filter(
        (c) => visibleCampaignIds.size === 0 || visibleCampaignIds.has(c.campaignId),
      )
      .map((c) => {
        const reference = c.reference ?? "";
        const isShare = reference.startsWith("urn:li:share:");
        const isUgc = reference.startsWith("urn:li:ugcPost:");
        const kind = isShare || isUgc ? "TLA / Sponsored Update" : c.type ?? "—";
        return {
          id: c.id,
          campaignName: c.campaignName ?? `Campagne ${c.campaignId}`,
          campaignGroupName: c.campaignGroupName ?? "—",
          kind,
          authorName: c.authorName,
          postUrl: c.postUrl,
          reference,
          status: c.status,
        };
      });
  }, [creatives, visibleCampaignIds]);

  if (rows.length === 0) {
    return (
      <div className="card-elev p-6 text-sm muted text-center">
        Aucune créative pour ce filtre.
      </div>
    );
  }

  return (
    <div className="card-elev p-4">
      <h3 className="text-sm font-semibold mb-3">
        Liens Ads <span className="muted font-normal text-xs">({rows.length})</span>
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs muted">
            <tr>
              <th className="px-3 py-2 text-left">Campagne</th>
              <th className="px-3 py-2 text-left">Groupe</th>
              <th className="px-3 py-2 text-left">Type</th>
              <th className="px-3 py-2 text-left">Auteur (TLA)</th>
              <th className="px-3 py-2 text-left">Lien</th>
              <th className="px-3 py-2 text-left">Statut</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-white/5 align-top">
                <td className="px-3 py-2">{r.campaignName}</td>
                <td className="px-3 py-2 text-xs muted">{r.campaignGroupName}</td>
                <td className="px-3 py-2 text-xs">{r.kind}</td>
                <td className="px-3 py-2 text-xs">
                  {r.authorName ?? <span className="muted">non résolu</span>}
                </td>
                <td className="px-3 py-2 text-xs">
                  {r.postUrl ? (
                    <a
                      href={r.postUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      Ouvrir
                    </a>
                  ) : r.reference ? (
                    <span className="muted" title={r.reference}>
                      {r.reference.slice(0, 40)}…
                    </span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] ${
                      r.status === "ACTIVE"
                        ? "bg-emerald-500/20 text-emerald-300"
                        : "bg-white/10 muted"
                    }`}
                  >
                    {r.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
