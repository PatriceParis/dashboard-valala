"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DailyAnalytics } from "@/lib/types";
import { formatNumber, formatShortDate } from "@/lib/utils";

interface PerformanceChartProps {
  dailyAnalytics: DailyAnalytics[];
  start: string;
  end: string;
}

export function PerformanceChart({ dailyAnalytics, start, end }: PerformanceChartProps) {
  const data = useMemo(() => {
    const byDate = new Map<string, { impressions: number; clicks: number }>();
    for (const d of dailyAnalytics) {
      if (d.date < start || d.date > end) continue;
      const cur = byDate.get(d.date) ?? { impressions: 0, clicks: 0 };
      cur.impressions += d.impressions;
      cur.clicks += d.clicks;
      byDate.set(d.date, cur);
    }
    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, ...v }));
  }, [dailyAnalytics, start, end]);

  if (data.length === 0) {
    return (
      <div className="card p-6 muted text-sm">
        Aucune donnée sur cette période.
      </div>
    );
  }

  return (
    <div className="card p-4">
      <h3 className="text-sm uppercase tracking-wider muted mb-3">Performance — impressions & clics</h3>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="impGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6f7bff" stopOpacity={0.5} />
                <stop offset="95%" stopColor="#6f7bff" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="clkGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#34d399" stopOpacity={0.5} />
                <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2333" />
            <XAxis
              dataKey="date"
              stroke="#8a8fa3"
              fontSize={11}
              tickFormatter={(v) => formatShortDate(v as string)}
            />
            <YAxis
              yAxisId="left"
              stroke="#8a8fa3"
              fontSize={11}
              tickFormatter={(v) => formatNumber(Number(v))}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              stroke="#8a8fa3"
              fontSize={11}
              tickFormatter={(v) => formatNumber(Number(v))}
            />
            <Tooltip
              contentStyle={{
                background: "#11141d",
                border: "1px solid #1f2333",
                borderRadius: 8,
                fontSize: 12,
              }}
              labelFormatter={(v) => formatShortDate(v as string)}
              formatter={(v, name) => {
                const num = typeof v === "number" ? v : Number(v);
                const label = name === "impressions" ? "Impressions" : "Clics";
                return [formatNumber(num), label];
              }}
            />
            <Area
              yAxisId="left"
              type="monotone"
              dataKey="impressions"
              stroke="#6f7bff"
              fill="url(#impGrad)"
              strokeWidth={2}
            />
            <Area
              yAxisId="right"
              type="monotone"
              dataKey="clicks"
              stroke="#34d399"
              fill="url(#clkGrad)"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
