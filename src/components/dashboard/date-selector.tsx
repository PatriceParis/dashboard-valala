"use client";

interface DateSelectorProps {
  start: string;
  end: string;
  min: string;
  max: string;
  onChange: (next: { start: string; end: string }) => void;
}

export function DateSelector({ start, end, min, max, onChange }: DateSelectorProps) {
  return (
    <div className="card-elev px-3 py-2 flex flex-wrap items-center gap-3 text-sm">
      <span className="muted text-xs uppercase tracking-wider">Période</span>
      <label className="flex items-center gap-2">
        <span className="muted">Du</span>
        <input
          type="date"
          value={start}
          min={min}
          max={end}
          onChange={(e) => onChange({ start: e.target.value, end })}
          className="bg-transparent border border-[color:var(--border)] rounded px-2 py-1 text-xs"
        />
      </label>
      <label className="flex items-center gap-2">
        <span className="muted">Au</span>
        <input
          type="date"
          value={end}
          min={start}
          max={max}
          onChange={(e) => onChange({ start, end: e.target.value })}
          className="bg-transparent border border-[color:var(--border)] rounded px-2 py-1 text-xs"
        />
      </label>
    </div>
  );
}
