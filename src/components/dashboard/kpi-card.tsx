"use client";

import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import type { KPIFormat } from "@/lib/constants";
import {
  formatCurrency,
  formatNumber,
  formatPercentage,
} from "@/lib/utils";

interface KpiCardProps {
  label: string;
  value: number;
  deltaPct: number | null;
  format: KPIFormat;
  currency?: string;
  inverseDelta?: boolean;
}

function formatValue(value: number, format: KPIFormat, currency: string): string {
  switch (format) {
    case "currency":
      return formatCurrency(value, currency);
    case "percentage":
      return formatPercentage(value);
    case "number":
    default:
      return formatNumber(value);
  }
}

export function KpiCard({
  label,
  value,
  deltaPct,
  format,
  currency = "EUR",
  inverseDelta,
}: KpiCardProps) {
  const display = formatValue(value, format, currency);

  let deltaColor = "muted";
  let DeltaIcon = Minus;
  let deltaText = "—";

  if (deltaPct !== null && Number.isFinite(deltaPct)) {
    const up = deltaPct > 0;
    const positive = inverseDelta ? !up : up;
    DeltaIcon = up ? ArrowUp : ArrowDown;
    deltaColor = positive ? "text-emerald-400" : "text-rose-400";
    deltaText = `${up ? "+" : ""}${(deltaPct * 100).toFixed(1)}%`;
  }

  return (
    <div className="card p-4 flex flex-col gap-2">
      <span className="text-xs uppercase tracking-wider muted">{label}</span>
      <span className="text-2xl font-semibold">{display}</span>
      <span className={`inline-flex items-center gap-1 text-xs ${deltaColor}`}>
        <DeltaIcon className="h-3 w-3" />
        <span>{deltaText}</span>
        <span className="muted ml-1">vs période précédente</span>
      </span>
    </div>
  );
}
