"use client";

import { KPI_CONFIG } from "@/lib/constants";
import type { ComputedKPIsWithDelta } from "@/lib/types";
import { KpiCard } from "./kpi-card";

interface KpiGridProps {
  kpis: ComputedKPIsWithDelta;
  currency: string;
}

export function KpiGrid({ kpis, currency }: KpiGridProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
      {KPI_CONFIG.map((k) => {
        const entry = kpis[k.key];
        return (
          <KpiCard
            key={k.key}
            label={k.label}
            value={entry.current}
            deltaPct={entry.deltaPct}
            format={k.format}
            currency={currency}
            inverseDelta={k.inverseDelta}
          />
        );
      })}
    </div>
  );
}
